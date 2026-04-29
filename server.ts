import express from 'express';
import type { Response } from 'express';
import multer from 'multer';
import AdmZip from 'adm-zip';
import fs from 'fs-extra';
import type { Stats } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { SFGraph } from './src/core/GraphSchema.js';
import { ArchitecturalStats } from './src/core/ArchitecturalStats.js';
import { buildDashboardExport } from './src/core/DashboardExporter.js';
import { runPipeline } from './src/pipeline.js';
import type { PipelineOptions } from './src/types.js';
import { concatCompatibleWorkflowCsvs, mergeWorkflowBundle } from './src/ingest/mergeWorkflowCsvs.js';
import {
  classifyWorkflowUploadFiles,
  orderWorkflowPrimaryPaths,
  pickResolvedWorkflowPath,
  workflowMergedOutPath
} from './src/ingest/resolveWorkflowUploads.js';
import { detectProfile } from './src/ingest/detect.js';
import { INGEST_MULTIPART_FIELDS } from './src/ingest/ingestMultipartFields.js';
import { looksLikeWorkflowExportCsv } from './src/ingest/sniffMisplacedWorkflowCsv.js';
import { IngestLogBuilder } from './src/ingest/IngestLog.js';
import { routeRbpUploads } from './src/ingest/rbpRouter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// When running compiled output from `dist-runtime/`, `__dirname` points at that folder.
// The UI lives at the repo root (`ui/`), so resolve it relative to the repo root.
const REPO_ROOT = path.basename(__dirname) === 'dist-runtime' ? path.dirname(__dirname) : __dirname;
const UI_DIST = path.join(REPO_ROOT, 'ui', 'dist');
const UI_DEV = path.join(REPO_ROOT, 'ui');
// Project workspaces default to `<repo>/projects/` (gitignored). Override with the
// `SUCCESSFACTORS_INSTANCE_EXPLORER_PROJECTS_DIR` env var or `init({ projectsDir })`.
const DEFAULT_PROJECTS_DIR = path.join(REPO_ROOT, 'projects');

const IS_TEST_ENV = Boolean(
  process.env.VITEST || process.env.VITEST_WORKER_ID || process.env.NODE_ENV === 'test'
);
const UI_DIST_INDEX = path.join(UI_DIST, 'index.html');

/**
 * Browsers cannot execute TypeScript; serving ui/ makes index.html load main.ts, which Express
 * may type as video/mp2t. Only ui/dist (Vite output) is safe for production static hosting.
 */
async function ensureUiDistForStaticHosting(): Promise<void> {
  if (process.env.SUCCESSFACTORS_INSTANCE_EXPLORER_SKIP_UI_BUILD === '1' || IS_TEST_ENV) return;
  if (await fs.pathExists(UI_DIST_INDEX)) return;
  console.warn('[server] ui/dist missing — running npm --prefix ui run build …');
  execSync('npm --prefix ui run build', {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: process.env
  });
  if (!(await fs.pathExists(UI_DIST_INDEX))) {
    throw new Error(
      'ui/dist/index.html still missing after vite build. Run: npm --prefix ui run build'
    );
  }
}

/** Default project workspaces (UUID folders with meta.json, data.json, uploads, …). */
function resolveDefaultProjectsDir(): string {
  return DEFAULT_PROJECTS_DIR;
}

// Default: <repo>/projects (override with SUCCESSFACTORS_INSTANCE_EXPLORER_PROJECTS_DIR or init({ projectsDir })).
let projectsDir = resolveDefaultProjectsDir();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidProjectId(id: string | undefined): boolean {
  return typeof id === 'string' && UUID_RE.test(id);
}

/**
 * Resolve `candidatePath` and assert it stays inside `allowedDir`. Returns the
 * resolved absolute path, throws if the candidate escapes (zip-slip / symlink
 * traversal defense). Use before res.sendFile or fs operations that take any
 * path component derived from request input.
 */
function assertPathInside(allowedDir: string, candidatePath: string): string {
  const resolvedAllowed = path.resolve(allowedDir);
  const resolvedCandidate = path.resolve(candidatePath);
  if (
    resolvedCandidate !== resolvedAllowed &&
    !resolvedCandidate.startsWith(resolvedAllowed + path.sep)
  ) {
    throw new Error(`Path escape: ${candidatePath} is not inside ${allowedDir}`);
  }
  return resolvedCandidate;
}

/**
 * Validate every entry in a zip stays within `targetDir` and reject obvious zip
 * bombs (huge total expansion or absurd compression ratios) before extracting.
 * `adm-zip` ships with internal zip-slip protection but it has been bypassed by
 * past CVEs, so this is a belt-and-braces guard.
 */
const MAX_TOTAL_UNCOMPRESSED_BYTES = 500 * 1024 * 1024; // 500 MB
const MAX_ENTRY_COMPRESSION_RATIO = 100;
function safeExtractZip(zip: AdmZip, targetDir: string): void {
  const resolvedTarget = path.resolve(targetDir);
  let totalUncompressed = 0;
  for (const entry of zip.getEntries()) {
    const resolvedEntry = path.resolve(targetDir, entry.entryName);
    if (
      resolvedEntry !== resolvedTarget &&
      !resolvedEntry.startsWith(resolvedTarget + path.sep)
    ) {
      throw new Error(`Zip entry escapes target directory: ${entry.entryName}`);
    }
    const uncompressed = Number(entry.header?.size ?? 0);
    const compressed = Number(entry.header?.compressedSize ?? 0);
    totalUncompressed += uncompressed;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error(
        `Zip rejected: total uncompressed size exceeds ${MAX_TOTAL_UNCOMPRESSED_BYTES} bytes`
      );
    }
    if (
      compressed > 0 &&
      uncompressed / compressed > MAX_ENTRY_COMPRESSION_RATIO
    ) {
      throw new Error(
        `Zip rejected: entry "${entry.entryName}" has suspicious compression ratio (${Math.round(uncompressed / compressed)}x)`
      );
    }
  }
  zip.extractAllTo(targetDir, true);
}

/**
 * Reduce a multipart upload's filename to a safe basename. Strips path
 * components, control characters, and anything outside `[A-Za-z0-9._-]`. We
 * accept the original name from an untrusted browser request, so this runs
 * before the name is ever used to build a filesystem path.
 */
function sanitizeUploadFilename(name: string): string {
  const cleaned = path
    .basename(String(name || ''))
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+/, '_');
  return cleaned.length > 0 ? cleaned : 'upload';
}

const app = express();
app.use(express.json());

type StaticHandler = (req: express.Request, res: express.Response, next: express.NextFunction) => void;
let _staticHandler: StaticHandler | null = null;
app.use((req, res, next) => (_staticHandler ? _staticHandler(req, res, next) : next()));

type MulterFieldFile = { path: string; originalname: string };
type MulterFiles = Record<string, MulterFieldFile[] | undefined>;
type UploadRequest = express.Request & { files?: MulterFiles; uploadTempDir?: string };

function multerUploadErrorPayload(err: unknown): { message: string; field?: string; code?: string } {
  if (err instanceof Error) {
    const e = err as Error & { field?: string; code?: string };
    return { message: e.message, field: e.field, code: e.code };
  }
  return { message: String(err) };
}

/** Accept legacy/virtual `rulesExport` multipart name (HTML input) by folding into rulesExportCsv / rulesExportZip. */
function normalizeVirtualIngestFiles(files: MulterFiles): void {
  const rulesExport = files.rulesExport?.[0];
  if (!rulesExport) return;
  const lower = rulesExport.originalname.toLowerCase();
  if (lower.endsWith('.zip')) {
    if (!files.rulesExportZip?.length) files.rulesExportZip = [rulesExport];
  } else if (!files.rulesExportCsv?.length) {
    files.rulesExportCsv = [rulesExport];
  }
}

function getUploadTempDir(req: UploadRequest): string {
  if (!req.uploadTempDir) {
    const id = typeof req.params.id === 'string' ? req.params.id : req.params.id?.[0] ?? 'unknown-project';
    req.uploadTempDir = path.join(projectsDir, id, '.incoming', randomUUID());
  }
  return req.uploadTempDir;
}

async function cleanupUploadTempDir(req: UploadRequest): Promise<void> {
  const dir = req.uploadTempDir;
  req.uploadTempDir = undefined;
  if (!dir) return;
  await fs.remove(dir).catch(() => {
    /* best-effort cleanup */
  });
}

async function persistUploadedFiles(files: MulterFiles, uploadsDir: string): Promise<void> {
  await fs.ensureDir(uploadsDir);
  for (const fieldFiles of Object.values(files)) {
    for (const file of fieldFiles || []) {
      const src = path.resolve(file.path);
      const dest = path.join(uploadsDir, file.originalname);
      if (src === path.resolve(dest)) continue;
      try {
        await fs.copy(src, dest, { overwrite: true });
      } catch (err) {
        const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined;
        // Windows can keep a read-handle open when the user re-uploads directly from this
        // project's `uploads/` folder. In that case we can still process the temp copy for the
        // current request and keep the previous persisted file for later reuse.
        if ((code === 'EBUSY' || code === 'EPERM') && (await fs.pathExists(dest))) {
          console.warn('[Ingest] Skipping persisted overwrite for locked upload:', file.originalname);
          continue;
        }
        throw err;
      }
    }
  }
}

/**
 * Classify uploads from the merged Data Model dropzone into Corporate (CDM) vs.
 * Country-Specific (CSF) buckets. Reads the first ~4KB of each XML to look for
 * the document root; falls back to filename hints when content is ambiguous.
 *
 * Returns `{ corporate, country }` plus a `decisions` audit trail for the
 * IngestLog so the consultant sees how each file was classified.
 */
type DataModelClassification = {
  corporate: string | null;
  country: string[];
  decisions: Array<{
    file: string;
    bucket: 'corporate' | 'country';
    reason: 'content-sniff' | 'filename-hint' | 'fallback-corporate-first';
  }>;
};

/** Read up to `byteLimit` bytes from the start of `filePath` as a UTF-8 string. Used for content-sniffing without loading whole files. */
async function readFileHead(filePath: string, byteLimit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    const stream = fs.createReadStream(filePath, { start: 0, end: Math.max(0, byteLimit - 1) });
    stream.on('data', (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      chunks.push(buf);
      received += buf.length;
      if (received >= byteLimit) stream.destroy();
    });
    stream.on('close', () => resolve(Buffer.concat(chunks).slice(0, byteLimit).toString('utf8')));
    stream.on('error', reject);
  });
}

async function classifyDataModelXmls(uploads: MulterFieldFile[] | undefined): Promise<DataModelClassification> {
  const result: DataModelClassification = { corporate: null, country: [], decisions: [] };
  if (!uploads || uploads.length === 0) return result;

  for (const file of uploads) {
    const lower = file.originalname.toLowerCase();
    let bucket: DataModelClassification['decisions'][number]['bucket'] | null = null;
    let reason: DataModelClassification['decisions'][number]['reason'] = 'content-sniff';

    // 1. Content sniff — first 4KB usually contains the root element.
    try {
      const head = (await readFileHead(file.path, 4096)).toLowerCase();
      if (/<country-region-data-model|<country-specific|csf-data-model/.test(head)) {
        bucket = 'country';
      } else if (/<corporate-data-model|<data-model[^>]/.test(head)) {
        bucket = 'corporate';
      }
    } catch {
      // Sniff failure → fall through to filename hint.
    }

    // 2. Filename hint fallback.
    if (!bucket) {
      reason = 'filename-hint';
      if (
        lower.includes('csf') ||
        lower.includes('country-specific') ||
        lower.includes('countryspecific') ||
        lower.includes('country_specific') ||
        lower.includes('country-region')
      ) {
        bucket = 'country';
      } else if (lower.includes('cdm') || lower.includes('corporate')) {
        bucket = 'corporate';
      }
    }

    // 3. Fallback: first unknown XML becomes corporate; rest become country.
    if (!bucket) {
      reason = 'fallback-corporate-first';
      bucket = result.corporate ? 'country' : 'corporate';
    }

    if (bucket === 'country') {
      result.country.push(file.path);
    } else if (!result.corporate) {
      result.corporate = file.path;
    } else {
      // Multiple CDM-like uploads: keep the first as corporate, route extras as country fallback.
      result.country.push(file.path);
    }
    result.decisions.push({ file: file.originalname, bucket, reason });
  }

  return result;
}

/**
 * Sweep `.incoming/` subdirs left behind by ingest requests that were aborted
 * (browser tab closed, network drop). Multer's per-request cleanup is best-effort,
 * so we also clean on startup. Only directories older than 1 hour are removed,
 * to avoid racing concurrent ingests during normal operation.
 */
async function cleanupOrphanedIncomingDirs(): Promise<void> {
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const cutoff = Date.now() - ONE_HOUR_MS;
  let projectEntries: { name: string; isDirectory: () => boolean }[];
  try {
    projectEntries = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return; // projectsDir doesn't exist yet — nothing to sweep.
  }
  for (const proj of projectEntries) {
    if (!proj.isDirectory()) continue;
    const incomingRoot = path.join(projectsDir, proj.name, '.incoming');
    if (!(await fs.pathExists(incomingRoot))) continue;
    let incomingEntries;
    try {
      incomingEntries = await fs.readdir(incomingRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dir of incomingEntries) {
      if (!dir.isDirectory()) continue;
      const fullPath = path.join(incomingRoot, dir.name);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.mtimeMs < cutoff) {
          await fs.remove(fullPath);
        }
      } catch {
        /* best-effort */
      }
    }
  }
}

/**
 * Must be called before the server handles requests.
 */
export async function init(opts: { projectsDir?: string } = {}): Promise<void> {
  if (opts.projectsDir) projectsDir = path.resolve(opts.projectsDir);
  else if (process.env.SUCCESSFACTORS_INSTANCE_EXPLORER_PROJECTS_DIR)
    projectsDir = path.resolve(process.env.SUCCESSFACTORS_INSTANCE_EXPLORER_PROJECTS_DIR);
  await fs.ensureDir(projectsDir);
  await cleanupOrphanedIncomingDirs();
  await ensureUiDistForStaticHosting();
  const haveDist = await fs.pathExists(UI_DIST_INDEX);
  const staticDir = haveDist ? UI_DIST : UI_DEV;
  if (!haveDist && !IS_TEST_ENV && process.env.SUCCESSFACTORS_INSTANCE_EXPLORER_SKIP_UI_BUILD !== '1') {
    throw new Error('ui/dist is required to serve the UI; vite build did not produce index.html');
  }
  _staticHandler = express.static(staticDir);
}

const storage = multer.diskStorage({
  destination: async (req, _file, cb) => {
    try {
      const dir = getUploadTempDir(req as UploadRequest);
      await fs.ensureDir(dir);
      cb(null, dir);
    } catch (err) {
      cb(err as Error, '');
    }
  },
  filename: (_req, file, cb) => {
    // Overwrite originalname with a sanitized basename so every downstream
    // path.join(...) using `file.originalname` is safe by construction.
    file.originalname = sanitizeUploadFilename(file.originalname);
    cb(null, file.originalname);
  }
});
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } });

type ProjectMetaRecord = {
  id: string;
  name?: string;
  createdAt?: string;
  lastProcessed?: string | null;
  stats?: Record<string, number>;
  profileSlug?: string | null;
};

async function listProjects(): Promise<ProjectMetaRecord[]> {
  await fs.ensureDir(projectsDir);
  const entries = await fs.readdir(projectsDir, { withFileTypes: true });
  const projects: ProjectMetaRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(projectsDir, entry.name, 'meta.json');
    if (!(await fs.pathExists(metaPath))) continue;
    const meta = await fs.readJson(metaPath);
    projects.push({ id: entry.name, ...meta });
  }
  return projects.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

async function getProject(id: string): Promise<ProjectMetaRecord | null> {
  const metaPath = path.join(projectsDir, id, 'meta.json');
  if (!(await fs.pathExists(metaPath))) return null;
  const meta = await fs.readJson(metaPath);
  return { id, ...meta };
}

function sendEvent(res: Response, data: unknown): void {
  // SSE uses Node's ServerResponse#write; Express Response is compatible at runtime.
  (res as NodeJS.WritableStream & Response).write(`data: ${JSON.stringify(data)}\n\n`);
}

app.get('/api/projects', async (_req, res) => {
  try {
    const projects = await listProjects();
    res.json(projects);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/projects', async (req, res) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }
    const id = randomUUID();
    const projectDir = path.join(projectsDir, id);
    await fs.ensureDir(projectDir);
    const meta = { name: name.trim(), createdAt: new Date().toISOString(), lastProcessed: null, profileSlug: null };
    await fs.writeJson(path.join(projectDir, 'meta.json'), meta, { spaces: 2 });
    res.status(201).json({ id, ...meta });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.delete('/api/projects/:id', async (req, res) => {
  if (!isValidProjectId(req.params.id)) return res.status(400).json({ error: 'Invalid project id' });
  const projectDir = path.join(projectsDir, req.params.id);
  if (!(await fs.pathExists(projectDir))) return res.status(404).json({ error: 'Not found' });
  await fs.remove(projectDir);
  res.status(204).end();
});

app.patch('/api/projects/:id', async (req, res) => {
  if (!isValidProjectId(req.params.id)) return res.status(400).json({ error: 'Invalid project id' });
  const projectDir = path.join(projectsDir, req.params.id);
  if (!(await fs.pathExists(projectDir))) return res.status(404).json({ error: 'Not found' });
  const { name } = req.body as { name?: string };
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name is required' });
  }
  const metaPath = path.join(projectDir, 'meta.json');
  const meta = await fs.readJson(metaPath);
  meta.name = name.trim();
  await fs.writeJson(metaPath, meta, { spaces: 2 });
  res.json({ id: req.params.id, ...meta });
});

app.get('/api/projects/:id/data', async (req, res) => {
  if (!isValidProjectId(req.params.id)) return res.status(400).json({ error: 'Invalid project id' });
  const dataPath = path.join(projectsDir, req.params.id, 'data.json');
  if (!(await fs.pathExists(dataPath))) {
    return res.status(404).json({ error: 'Project not yet processed. Please ingest files first.' });
  }
  let resolved: string;
  try {
    resolved = assertPathInside(projectsDir, dataPath);
  } catch {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.sendFile(resolved);
});

app.get('/api/projects/:id/ingest-log', async (req, res) => {
  if (!isValidProjectId(req.params.id)) return res.status(400).json({ error: 'Invalid project id' });
  const logPath = path.join(projectsDir, req.params.id, 'ingest-log.json');
  if (!(await fs.pathExists(logPath))) {
    return res.status(404).json({ error: 'No ingest log yet. Run an ingest first.' });
  }
  let resolved: string;
  try {
    resolved = assertPathInside(projectsDir, logPath);
  } catch {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.sendFile(resolved);
});

app.get('/api/projects/:baseId/compare/:targetId', async (req, res) => {
  const baseId = req.params.baseId;
  const targetId = req.params.targetId;
  if (!isValidProjectId(baseId) || !isValidProjectId(targetId)) return res.status(400).json({ error: 'Invalid project id' });
  if (baseId === targetId) return res.status(400).json({ error: 'Cannot compare a project to itself' });

  const baseProject = await getProject(baseId);
  const targetProject = await getProject(targetId);
  if (!baseProject || !targetProject) return res.status(404).json({ error: 'Project not found' });

  const basePath = path.join(projectsDir, baseId, 'data.json');
  const targetPath = path.join(projectsDir, targetId, 'data.json');
  if (!(await fs.pathExists(basePath)) || !(await fs.pathExists(targetPath))) {
    return res.status(404).json({ error: 'Project data.json missing' });
  }

  try {
    const start = Date.now();
    const { buildCompareResult } = await import('./src/core/CompareEnricher.js');
    const baseExport = await fs.readJson(basePath);
    const targetExport = await fs.readJson(targetPath);
    
    const result = buildCompareResult(baseExport, targetExport, baseProject, targetProject);
    const ms = Date.now() - start;
    console.log('[compare] %s vs %s took %dms', baseId, targetId, ms);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/projects/:baseId/compare/:targetId/report.md', async (req, res) => {
  const baseId = req.params.baseId;
  const targetId = req.params.targetId;
  if (!isValidProjectId(baseId) || !isValidProjectId(targetId)) return res.status(400).json({ error: 'Invalid project id' });
  if (baseId === targetId) return res.status(400).json({ error: 'Cannot compare a project to itself' });

  const baseProject = await getProject(baseId);
  const targetProject = await getProject(targetId);
  if (!baseProject || !targetProject) return res.status(404).json({ error: 'Project not found' });

  const basePath = path.join(projectsDir, baseId, 'data.json');
  const targetPath = path.join(projectsDir, targetId, 'data.json');
  if (!(await fs.pathExists(basePath)) || !(await fs.pathExists(targetPath))) {
    return res.status(404).json({ error: 'Project data.json missing' });
  }

  try {
    const { buildCompareResult } = await import('./src/core/CompareEnricher.js');
    const { formatCompareMarkdown } = await import('./src/core/CompareReport.js');
    const baseExport = await fs.readJson(basePath);
    const targetExport = await fs.readJson(targetPath);
    
    const result = buildCompareResult(baseExport, targetExport, baseProject, targetProject);
    const md = formatCompareMarkdown(result);
    res.setHeader('Content-Disposition', 'inline; filename="compare-report.md"');
    res.type('text/markdown; charset=utf-8').send(md);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/projects/:baseId/compare/:targetId/report.csv', async (req, res) => {
  const baseId = req.params.baseId;
  const targetId = req.params.targetId;
  if (!isValidProjectId(baseId) || !isValidProjectId(targetId)) return res.status(400).json({ error: 'Invalid project id' });
  if (baseId === targetId) return res.status(400).json({ error: 'Cannot compare a project to itself' });

  const baseProject = await getProject(baseId);
  const targetProject = await getProject(targetId);
  if (!baseProject || !targetProject) return res.status(404).json({ error: 'Project not found' });

  const basePath = path.join(projectsDir, baseId, 'data.json');
  const targetPath = path.join(projectsDir, targetId, 'data.json');
  if (!(await fs.pathExists(basePath)) || !(await fs.pathExists(targetPath))) {
    return res.status(404).json({ error: 'Project data.json missing' });
  }

  try {
    const { buildCompareResult } = await import('./src/core/CompareEnricher.js');
    const { formatCompareCsv } = await import('./src/core/CompareReport.js');
    const baseExport = await fs.readJson(basePath);
    const targetExport = await fs.readJson(targetPath);
    
    const result = buildCompareResult(baseExport, targetExport, baseProject, targetProject);
    const csv = formatCompareCsv(result);
    res.setHeader('Content-Disposition', 'attachment; filename="compare.csv"');
    res.type('text/csv; charset=utf-8').send(csv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/projects/:baseId/compare/:targetId/nodes/:nodeId', async (req, res) => {
  const baseId = req.params.baseId;
  const targetId = req.params.targetId;
  const nodeId = req.params.nodeId;
  
  if (!isValidProjectId(baseId) || !isValidProjectId(targetId)) return res.status(400).json({ error: 'Invalid project id' });
  if (baseId === targetId) return res.status(400).json({ error: 'Cannot compare a project to itself' });

  const basePath = path.join(projectsDir, baseId, 'data.json');
  const targetPath = path.join(projectsDir, targetId, 'data.json');
  if (!(await fs.pathExists(basePath)) || !(await fs.pathExists(targetPath))) {
    return res.status(404).json({ error: 'Project data.json missing' });
  }

  try {
    const baseExport = await fs.readJson(basePath);
    const targetExport = await fs.readJson(targetPath);

    const baseNodes = Array.isArray(baseExport.graph?.nodes) ? baseExport.graph.nodes : [];
    const targetNodes = Array.isArray(targetExport.graph?.nodes) ? targetExport.graph.nodes : [];

    const baseNode = baseNodes.find((n: any) => n.id === nodeId) || null;
    const targetNode = targetNodes.find((n: any) => n.id === nodeId) || null;

    res.json({ base: baseNode, target: targetNode });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post(
  '/api/projects/:id/ingest/detect',
  (req, res, next) => {
    upload.fields([...INGEST_MULTIPART_FIELDS])(req, res, (err: unknown) => {
      if (err) {
        const payload = multerUploadErrorPayload(err);
        console.error('[Detect] Upload receive error:', payload);
        if (!res.headersSent) {
          return res.status(400).json({ error: payload.message, field: payload.field, code: payload.code });
        }
      }
      next();
    });
  },
  async (req, res) => {
  const paramId = typeof req.params.id === 'string' ? req.params.id : req.params.id?.[0];
  if (!isValidProjectId(paramId)) return res.status(400).json({ error: 'Invalid project id' });
  const projectId = paramId!;
  const projectDir = path.join(projectsDir, projectId);
  if (!(await fs.pathExists(projectDir))) return res.status(404).json({ error: 'Project not found' });

  const tmpDir = path.join(projectDir, 'extracted', `detect-${Date.now()}`);
  try {
    const files = (req as UploadRequest).files || {};
    normalizeVirtualIngestFiles(files);
    await fs.ensureDir(tmpDir);

    // Extract object-defs zip if provided
    if (files.objectDefsZip?.[0]) {
      const zip = new AdmZip(files.objectDefsZip[0].path);
      safeExtractZip(zip, tmpDir);
    }

    // Also copy any loose files that serve as signals
    for (const fieldFiles of Object.values(files)) {
      for (const f of (fieldFiles as Express.Multer.File[])) {
        const dest = path.join(tmpDir, f.originalname);
        if (!(await fs.pathExists(dest))) await fs.copy(f.path, dest);
      }
    }

    // Also materialise RBP JSON bundle for v2 detection
    const rbpJsonFiles = [...(files.rbpJsonBundle || []), ...(files.rbpFiles || []).filter(
      f => f.originalname.toLowerCase().endsWith('.json')
    )];
    if (rbpJsonFiles.length > 0) {
      const rbpDir = path.join(tmpDir, 'rbp-json-bundle');
      await fs.ensureDir(rbpDir);
      for (const f of rbpJsonFiles) {
        await fs.copy(f.path, path.join(rbpDir, f.originalname));
      }
    }

    const result = await detectProfile(tmpDir);
    const slug = result?.slug ?? null;
    const evidence = result?.evidence ?? [];
    const displayName = result?.displayName ?? 'Unknown';
    res.json({ slug, displayName, evidence, unknown: !slug });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  } finally {
    fs.remove(tmpDir).catch(() => { /* best-effort cleanup */ });
    await cleanupUploadTempDir(req as UploadRequest);
  }
  }
);

type ObjectDefsPreparation = {
  objectDefsDir: string | null;
};

async function prepareObjectDefs(params: {
  files: MulterFiles;
  extractDir: string;
  ingestLog: IngestLogBuilder;
  res: Response;
}): Promise<ObjectDefsPreparation> {
  const { files, extractDir, ingestLog, res } = params;
  let objectDefsDir: string | null = null;
  if (!files.objectDefsZip?.[0]) return { objectDefsDir };

  const zipPath = files.objectDefsZip[0].path;
  const zipBasename = path.basename(zipPath);
  sendEvent(res, { type: 'progress', step: 'extract', message: 'Extracting Object Definitions zip…' });
  const zip = new AdmZip(zipPath);
  const objectDefsExtract = path.join(extractDir, 'object-defs');
  await fs.ensureDir(objectDefsExtract);
  safeExtractZip(zip, objectDefsExtract);
  objectDefsDir = objectDefsExtract + path.sep;
  const entryCount = zip.getEntries().length;
  sendEvent(res, {
    type: 'progress',
    step: 'extract',
    message: `Extracted ${entryCount} files from zip`
  });
  ingestLog.acceptFile('objectDefs', zipBasename);
  ingestLog.add({
    section: 'objectDefs',
    severity: 'info',
    code: 'objectDefs.zip.extracted',
    message: `Extracted ${entryCount} entries from ${zipBasename}.`,
    file: zipBasename,
    data: { entryCount }
  });

  return { objectDefsDir };
}

type DataModelPreparation = {
  odataXml: string | null;
  corporateDm: string | null;
  countryDms: string[];
  successionDm: string | null;
  countrySuccessionModels: string[];
};

async function prepareDataModelFiles(
  files: MulterFiles,
  ingestLog: IngestLogBuilder
): Promise<DataModelPreparation> {
  const odataXml = files.odataXml?.[0]?.path || null;
  if (odataXml) ingestLog.acceptFile('odata', files.odataXml![0].originalname);

  const dmClassification = await classifyDataModelXmls(files.dataModelXmls);
  const corporateDm = dmClassification.corporate;
  const countryDms = [...dmClassification.country];
  for (const decision of dmClassification.decisions) {
    ingestLog.acceptFile('dataModel', decision.file);
    ingestLog.add({
      section: 'dataModel',
      severity: 'info',
      code: `dataModel.classified.${decision.bucket}`,
      message: `Routed ${decision.file} as ${decision.bucket} data model (${decision.reason}).`,
      file: decision.file,
      data: { reason: decision.reason }
    });
  }

  let successionDmThisIngest: string | null = null;
  for (const f of files.successionDm || []) {
    const n = f.originalname.toLowerCase();
    if (
      n.includes('csf') ||
      n.includes('country-specific') ||
      n.includes('countryspecific') ||
      n.includes('country_specific')
    ) {
      countryDms.push(f.path);
    } else if (!successionDmThisIngest) {
      successionDmThisIngest = f.path;
    }
  }

  return {
    odataXml,
    corporateDm,
    countryDms,
    successionDm: successionDmThisIngest,
    countrySuccessionModels: (files.countrySuccessionDms || []).map(f => f.path)
  };
}

type RbpPreparation = {
  rbpJsonBundleDir: string | null;
  rbpPrimaryRoles: string | null;
  rbpLegacyRoles: string | null;
  rbpRoleObjectPerms: string | null;
  rbpRoleSystemPerms: string | null;
};

async function prepareRbpFiles(params: {
  files: MulterFiles;
  extractDir: string;
  ingestLog: IngestLogBuilder;
}): Promise<RbpPreparation> {
  const { files, extractDir, ingestLog } = params;
  const rbpRouting = await routeRbpUploads({
    files: files.rbpFiles || [],
    workspaceDir: extractDir,
    primaryRolesOverride: files.rbpRolesPermissionsCsv?.[0]?.path ?? null,
    jsonBundleOverride: files.rbpJsonBundle ?? [],
    log: ingestLog
  });

  return {
    rbpJsonBundleDir: rbpRouting.jsonDir,
    rbpPrimaryRoles: rbpRouting.csvPaths.primaryRoles,
    rbpLegacyRoles: rbpRouting.csvPaths.legacyRoles,
    rbpRoleObjectPerms: rbpRouting.csvPaths.roleObjectPermissions,
    rbpRoleSystemPerms: rbpRouting.csvPaths.roleSystemPermissions
  };
}

type WorkflowPreparation = {
  workflowCsvLoose: string | null;
  rulesExportCsvPath: string | null;
  businessRulesAssignmentsPath: string | null;
  misplacedWorkflowUploads: Array<{ path: string; originalname: string }>;
  classifiedWf: ReturnType<typeof classifyWorkflowUploadFiles>;
  wfInfoFromSplit: string | null;
  workflowPathsOrdered: string[];
  mergedWorkflowCsv: string | null;
};

async function prepareWorkflowFiles(params: {
  files: MulterFiles;
  extractDir: string;
  ingestLog: IngestLogBuilder;
  res: Response;
  rulesExportCsvPath: string | null;
  businessRulesAssignmentsPath: string | null;
}): Promise<WorkflowPreparation> {
  const { files, extractDir, ingestLog, res } = params;
  let rulesExportCsvPath = params.rulesExportCsvPath;
  let businessRulesAssignmentsPath = params.businessRulesAssignmentsPath;
  const workflowCsvLoose = files.workflowCsv?.[0]?.path || null;

  const misplacedWorkflowUploads: Array<{ path: string; originalname: string }> = [];
  if (businessRulesAssignmentsPath && (await looksLikeWorkflowExportCsv(businessRulesAssignmentsPath))) {
    sendEvent(res, {
      type: 'progress',
      step: 'routing',
      message:
        'Business rules assignments slot looks like a workflow export (column headers) — routing it to the workflow pipeline.'
    });
    misplacedWorkflowUploads.push({
      path: businessRulesAssignmentsPath,
      originalname: path.basename(businessRulesAssignmentsPath)
    });
    businessRulesAssignmentsPath = null;
  }
  if (rulesExportCsvPath && (await looksLikeWorkflowExportCsv(rulesExportCsvPath))) {
    sendEvent(res, {
      type: 'progress',
      step: 'routing',
      message:
        'Rules export CSV looks like a workflow table (column headers) — routing it to the workflow pipeline.'
    });
    misplacedWorkflowUploads.push({
      path: rulesExportCsvPath,
      originalname: path.basename(rulesExportCsvPath)
    });
    rulesExportCsvPath = null;
  }

  const workflowUploadFiles = [
    ...(files.workflowCsv || []),
    ...(files.workflowSplitCsvs || []),
    ...misplacedWorkflowUploads
  ];
  const classifiedWf = classifyWorkflowUploadFiles(workflowUploadFiles);
  const wfInfoFromSplit = classifiedWf.wfInfo || null;
  const workflowPathsOrdered = await orderWorkflowPrimaryPaths(classifiedWf.workflowPaths);

  let mergedWorkflowCsv: string | null = null;
  if (workflowPathsOrdered.length > 0) {
    sendEvent(res, {
      type: 'progress',
      step: 'merge',
      message: `Preparing workflow CSV (${workflowPathsOrdered.length} file(s), split bundle merge when CC role present)…`
    });
    const primaryPrepared = path.join(extractDir, 'workflow-primary-prepared.csv');
    await concatCompatibleWorkflowCsvs(workflowPathsOrdered, primaryPrepared);
    const mergedPath = workflowMergedOutPath(extractDir);
    const mergeResult = await mergeWorkflowBundle(
      {
        workflow: primaryPrepared,
        ccRole: classifiedWf.ccRole,
        dynamicRole: classifiedWf.dynamicRole,
        contributor: classifiedWf.contributor
      },
      mergedPath
    );
    mergedWorkflowCsv = mergeResult.path;
    const wfDiag = mergeResult.diagnostics;
    sendEvent(res, {
      type: 'progress',
      step: 'merge',
      message: `Workflow merge complete (${wfDiag.sources.map(s => `${s.role}: ${s.basename}`).join('; ')})${
        wfDiag.contributor
          ? ` — contributor: ${wfDiag.contributor.primaryRowsWithContributorData} primary rows enriched, ${wfDiag.contributor.rowsRead} contributor rows read${
              wfDiag.contributor.contributorKeysNeverMatched
                ? `, ${wfDiag.contributor.contributorKeysNeverMatched} contributor keys unmatched`
                : ''
            }`
          : ''
      }${
        wfDiag.dynamicRole
          ? ` — dynamic role file: ${wfDiag.dynamicRole.rowsRead} rows, ${wfDiag.dynamicRole.assignmentColumnCount} dynamicRoleAssignment columns (not merged into rows)`
          : ''
      }`
    });

    if (wfDiag.contributor && wfDiag.contributor.rowsRead === 0) {
      ingestLog.add({
        section: 'workflow',
        severity: 'warn',
        code: 'workflow.contributor.empty',
        message: 'Workflow Contributor CSV had no data rows after the header — contributor enrichment skipped.',
        file: classifiedWf.contributor ? path.basename(classifiedWf.contributor) : undefined,
        hint: 'This is normal if no workflows define contributors. Re-export with the Workflow Contributor table populated to enrich.'
      });
    } else if (wfDiag.contributor && wfDiag.contributor.contributorKeysNeverMatched > 0) {
      ingestLog.add({
        section: 'workflow',
        severity: 'info',
        code: 'workflow.contributor.unmatched',
        message: `${wfDiag.contributor.contributorKeysNeverMatched} contributor key(s) did not match any primary workflow row.`,
        data: {
          contributorKeysNeverMatched: wfDiag.contributor.contributorKeysNeverMatched,
          sampleUnmatchedKeys: wfDiag.contributor.sampleUnmatchedKeys
        }
      });
    }
    for (const source of wfDiag.sources) {
      ingestLog.acceptFile('workflow', source.basename);
    }
  }

  return {
    workflowCsvLoose,
    rulesExportCsvPath,
    businessRulesAssignmentsPath,
    misplacedWorkflowUploads,
    classifiedWf,
    wfInfoFromSplit,
    workflowPathsOrdered,
    mergedWorkflowCsv
  };
}

app.post(
  '/api/projects/:id/ingest',
  (req, res, next) => {
    upload.fields([...INGEST_MULTIPART_FIELDS])(req, res, (err: unknown) => {
      if (err) {
        const payload = multerUploadErrorPayload(err);
        console.error('[Ingest] Upload receive error:', payload);
        if (!res.headersSent) {
          return res.status(400).json({ error: payload.message, field: payload.field, code: payload.code });
        }
      }
      next();
    });
  },
  async (req, res) => {
  const paramId = typeof req.params.id === 'string' ? req.params.id : req.params.id?.[0];
  if (!isValidProjectId(paramId)) return res.status(400).json({ error: 'Invalid project id' });
  const projectId = paramId!;
  const projectDir = path.join(projectsDir, projectId);

  if (!(await fs.pathExists(projectDir))) {
    return res.status(404).json({ error: 'Project not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const ingestLog = new IngestLogBuilder();

  try {
    const files = (req as UploadRequest).files || {};
    normalizeVirtualIngestFiles(files);
    const uploadsDir = path.join(projectDir, 'uploads');
    const extractDir = path.join(projectDir, 'extracted');
    await persistUploadedFiles(files, uploadsDir);
    await fs.ensureDir(extractDir);

    sendEvent(res, { type: 'progress', step: 'start', message: 'Ingest started' });

    const { objectDefsDir } = await prepareObjectDefs({ files, extractDir, ingestLog, res });
    const {
      odataXml,
      corporateDm,
      countryDms,
      successionDm,
      countrySuccessionModels
    } = await prepareDataModelFiles(files, ingestLog);
    let rulesExportCsvPath = files.rulesExportCsv?.[0]?.path || null;
    let businessRulesAssignmentsPath = files.businessRulesAssignmentsCsv?.[0]?.path || null;

    // Extract rulesExportZip if provided
    let rulesExtractDir: string | null = null;
    if (files.rulesExportZip?.[0]) {
      const zipPath = files.rulesExportZip[0].path;
      sendEvent(res, { type: 'progress', step: 'extract', message: 'Extracting Rules Export zip…' });
      const zip = new AdmZip(zipPath);
      rulesExtractDir = path.join(extractDir, 'rules');
      await fs.ensureDir(rulesExtractDir);
      safeExtractZip(zip, rulesExtractDir);
    }

    const rbpPrepared = await prepareRbpFiles({ files, extractDir, ingestLog });
    const workflowPrepared = await prepareWorkflowFiles({
      files,
      extractDir,
      ingestLog,
      res,
      rulesExportCsvPath,
      businessRulesAssignmentsPath
    });
    ({
      rulesExportCsvPath,
      businessRulesAssignmentsPath
    } = workflowPrepared);

    const {
      rbpJsonBundleDir,
      rbpPrimaryRoles,
      rbpLegacyRoles,
      rbpRoleObjectPerms,
      rbpRoleSystemPerms
    } = rbpPrepared;
    const {
      workflowCsvLoose,
      misplacedWorkflowUploads,
      classifiedWf,
      wfInfoFromSplit,
      workflowPathsOrdered,
      mergedWorkflowCsv
    } = workflowPrepared;

    const prevUploads = await resolveExistingUploads(uploadsDir);

    const resolvedObjectDefsDir = objectDefsDir || prevUploads.objectDefsDir;
    const resolvedOdataXml = odataXml || prevUploads.odataXml;
    const resolvedCorporateDm = corporateDm || prevUploads.corporateDm;
    const resolvedCountryDms = countryDms.length ? countryDms : prevUploads.countryDms;
    const resolvedSuccessionDm = successionDm || prevUploads.successionDm;
    const resolvedCountrySuccessionModels = countrySuccessionModels.length ? countrySuccessionModels : prevUploads.countrySuccessionModels;

    /** Re-merge workflow CSVs already under `uploads/` when this request did not attach any (fixes `Workflows*.csv` only in uploads). */
    let reuseMergedWorkflowCsv: string | null = null;
    if (
      !mergedWorkflowCsv &&
      !wfInfoFromSplit &&
      classifiedWf.workflowPaths.length === 0 &&
      misplacedWorkflowUploads.length === 0
    ) {
      const split = prevUploads.workflowSplitCsvs;
      if (split.workflow && (await fs.pathExists(split.workflow))) {
        sendEvent(res, {
          type: 'progress',
          step: 'merge',
          message: 'Preparing workflow CSV from files already saved for this project…'
        });
        const ordered = await orderWorkflowPrimaryPaths([split.workflow]);
        const primaryPrepared = path.join(extractDir, 'workflow-primary-from-uploads.csv');
        await concatCompatibleWorkflowCsvs(ordered, primaryPrepared);
        const reuseMerge = await mergeWorkflowBundle(
          {
            workflow: primaryPrepared,
            ccRole: split.ccRole,
            dynamicRole: split.dynamicRole,
            contributor: split.contributor
          },
          workflowMergedOutPath(extractDir)
        );
        reuseMergedWorkflowCsv = reuseMerge.path;
        sendEvent(res, {
          type: 'progress',
          step: 'merge',
          message: `Workflow reuse merge: ${reuseMerge.diagnostics.sources.map(s => `${s.role}: ${s.basename}`).join('; ')}`
        });
      }
    }

    const resolvedWorkflowCsv = pickResolvedWorkflowPath({
      mergedPath: mergedWorkflowCsv || reuseMergedWorkflowCsv,
      wfInfoPath: wfInfoFromSplit,
      primaryWorkflowPath:
        workflowPathsOrdered.length === 1 && !mergedWorkflowCsv ? workflowPathsOrdered[0]! : null,
      looseWorkflowCsv: workflowCsvLoose,
      prevMerged: prevUploads.mergedWorkflowCsv,
      prevLoose: prevUploads.workflowCsv
    });

    const workflowTouchedThisIngest =
      Boolean(workflowCsvLoose) ||
      misplacedWorkflowUploads.length > 0 ||
      workflowPathsOrdered.length > 0 ||
      Boolean(wfInfoFromSplit);
    const workflowDataSource: 'ingest-upload' | 'reused-saved' | 'none' = !resolvedWorkflowCsv
      ? 'none'
      : workflowTouchedThisIngest
        ? 'ingest-upload'
        : 'reused-saved';
    if (workflowDataSource === 'reused-saved' && resolvedWorkflowCsv) {
      sendEvent(res, {
        type: 'progress',
        step: 'workflow',
        message: `Workflow definitions: reusing "${path.basename(resolvedWorkflowCsv)}" already stored for this project — upload a new WFInfo/workflow export on Import to replace.`
      });
    }

    const isRuleCatalogCsv = (p: string | null | undefined) =>
      !!p && path.basename(p).toLowerCase() === 'rule.csv';
    const isRulesAssignmentCsv = (p: string | null | undefined) =>
      !!p &&
      (isBusinessRulesAssignmentsFilename(path.basename(p).toLowerCase()) ||
        path.basename(p).toLowerCase().startsWith('jobresponse'));

    const currentRulesCatalogCsv =
      (rulesExtractDir ? findInDir(rulesExtractDir, 'Rule.csv') : null) ||
      (isRuleCatalogCsv(rulesExportCsvPath) ? rulesExportCsvPath : null);
    const persistedRulesCatalogCsv =
      findInDir(path.join(projectDir, 'extracted', 'rules'), 'Rule.csv') ||
      prevUploads.rulesCatalogCsv;
    const resolvedRulesCatalogCsv =
      currentRulesCatalogCsv ||
      persistedRulesCatalogCsv ||
      (resolvedObjectDefsDir ? findInDir(resolvedObjectDefsDir, 'Rule.csv') : null);

    const currentRulesAssignmentCsv =
      businessRulesAssignmentsPath ||
      (isRulesAssignmentCsv(rulesExportCsvPath) ? rulesExportCsvPath : null);
    const resolvedRulesAssignmentCsv =
      currentRulesAssignmentCsv ||
      prevUploads.businessRulesAssignmentsCsv ||
      prevUploads.rulesExportCsv;

    if (resolvedRulesCatalogCsv) {
      sendEvent(res, {
        type: 'progress',
        step: 'rules',
        message: `Rule catalog source: ${path.basename(resolvedRulesCatalogCsv)}`
      });
    }
    if (resolvedRulesAssignmentCsv) {
      sendEvent(res, {
        type: 'progress',
        step: 'assignment',
        message: `Rule assignment source: ${path.basename(resolvedRulesAssignmentCsv)}`
      });
    }

    const rbpCsvFromUploads: RbpCsvPickBag = {
      primary:
        rbpPrimaryRoles ||
        prevUploads.rbpPrimaryRoles ||
        findInDir(resolvedObjectDefsDir, 'RoleToRuleInformation.csv') ||
        findInDir(resolvedObjectDefsDir, 'RolesPermissions.csv'),
      objectPerms:
        rbpRoleObjectPerms ||
        prevUploads.rbpRoleObjectPermissions ||
        findInDir(resolvedObjectDefsDir, 'RoleToPermission.csv'),
      systemPerms:
        rbpRoleSystemPerms ||
        prevUploads.rbpRoleSystemPermissions ||
        findInDir(resolvedObjectDefsDir, 'RoleToMDFPermission.csv')
    };

    const resolvedRbpPermissionJsonDir =
      rbpJsonBundleDir ||
      prevUploads.rbpRolePermissionJsonDir ||
      null;

    for (const d of [rbpJsonBundleDir, prevUploads.rbpRolePermissionJsonDir, resolvedRbpPermissionJsonDir]) {
      await augmentRbpCsvFromRoleJsonDirectory(d, rbpCsvFromUploads);
    }

    const resolvedRbpPrimary = rbpCsvFromUploads.primary;
    const resolvedRbpObjectPerms = rbpCsvFromUploads.objectPerms;
    const resolvedRbpSystemPerms = rbpCsvFromUploads.systemPerms;
    const resolvedRbpLegacy =
      rbpLegacyRoles || prevUploads.rbpLegacyRoles || findInDir(resolvedObjectDefsDir, 'report_Roles_report_example.csv');

    if (!resolvedRbpPermissionJsonDir) {
      console.warn(
        '[Ingest] No per-role RBP JSON directory for project',
        projectId,
        '— granular permissions expect JSON v2 beside CSV or an rbp-json-bundle upload.'
      );
    }

    if (!resolvedObjectDefsDir) {
      ingestLog.add({
        section: 'objectDefs',
        severity: 'error',
        code: 'objectDefs.required.missing',
        message:
          'Object Definitions are required. Upload the standard .zip export from Admin Center → Import & Export Data → Export Data → Object Definition.'
      });
      await persistIngestLog(projectDir, ingestLog);
      sendEvent(res, {
        type: 'error',
        message:
          'Object Definitions are required: upload the standard .zip export from Admin Center → Import & Export Data → Export Data → Object Definition.'
      });
      res.end();
      return;
    }

    // Detect client profile slug against the full workspace so nested uploads,
    // extracted zips, and materialized JSON bundles all contribute evidence.
    const detected = await detectProfile(projectDir, {
      onIssue: issue =>
        ingestLog.add({
          section: 'objectDefs',
          severity: 'info',
          code: issue.code,
          message: issue.message,
          file: issue.file
        })
    });
    const clientSlug = detected?.slug ?? undefined;
    if (clientSlug) {
      sendEvent(res, { type: 'progress', step: 'detect', message: `Detected profile: ${clientSlug}` });
      ingestLog.setProfileSlug(clientSlug);
      ingestLog.add({
        section: 'objectDefs',
        severity: 'info',
        code: 'profile.detected',
        message: `Detected client profile: ${clientSlug}.`,
        data: { slug: clientSlug }
      });
    } else {
      ingestLog.add({
        section: 'objectDefs',
        severity: 'info',
        code: 'profile.unknown',
        message: 'No matching client profile — running with generic engine settings.'
      });
    }

    const engineOptions: PipelineOptions = {
      objectDefsDir: resolvedObjectDefsDir,
      odataXml: resolvedOdataXml,
      corporateDataModel: resolvedCorporateDm ?? undefined,
      countrySpecificModels: resolvedCountryDms,
      successionDm: resolvedSuccessionDm ?? undefined,
      countrySuccessionModels: resolvedCountrySuccessionModels,
      filePath: resolvedWorkflowCsv,
      rulesPath: resolvedRulesCatalogCsv,
      rbpPrimaryRoles: resolvedRbpPrimary,
      rbpLegacyRoles: resolvedRbpLegacy,
      rbpRoleObjectPermissions: resolvedRbpObjectPerms,
      rbpRoleSystemPermissions: resolvedRbpSystemPerms,
      rbpRolePermissionJsonDir: resolvedRbpPermissionJsonDir,
      rbpSecurity: resolvedObjectDefsDir
        ? findInDir(resolvedObjectDefsDir, 'Object Definition-Security.csv')
        : null,
      rulesExportCsv: resolvedRulesAssignmentCsv,
      clientSlug,
      ingestLog
    };

    const graph = new SFGraph();

    await runPipeline(graph, {
      ...engineOptions,
      onProgress: (step, message) => sendEvent(res, { type: 'progress', step, message })
    });

    sendEvent(res, { type: 'progress', step: 'export', message: 'Building dashboard export…' });
    const stats = new ArchitecturalStats(graph).calculate();
    const output = buildDashboardExport(graph, stats);
    const metaPath = path.join(projectDir, 'meta.json');
    const meta = await fs.readJson(metaPath);
    const workflowCount =
      (output as { workflow?: { summary?: { workflowCount?: number } } }).workflow?.summary?.workflowCount ?? 0;
    const outputWithBundle = {
      ...output,
      projectBundle: {
        projectId,
        projectName: typeof meta.name === 'string' ? meta.name : null,
        workflowDataSource,
        workflowFileBasename: resolvedWorkflowCsv ? path.basename(resolvedWorkflowCsv) : null
      }
    };
    await fs.writeJson(path.join(projectDir, 'data.json'), outputWithBundle, { spaces: 2 });

    meta.lastProcessed = new Date().toISOString();
    meta.profileSlug = clientSlug ?? meta.profileSlug ?? null;
    meta.stats = {
      mdfObjects: stats.instanceOverview?.mdfObjects || 0,
      businessRules: stats.instanceOverview?.businessRules || 0,
      rbpRoles: stats.instanceOverview?.rbpRoles || 0,
      odataEntities: stats.instanceOverview?.odataEntities || 0,
      workflows: workflowCount
    };
    await fs.writeJson(metaPath, meta, { spaces: 2 });

    await persistIngestLog(projectDir, ingestLog);

    sendEvent(res, { type: 'done', message: 'Ingest complete. Reload the project to see the updated graph.' });
  } catch (err) {
    console.error('[Server] Ingest error:', err);
    const message = err instanceof Error ? err.message : 'Ingest failed';
    ingestLog.add({
      section: 'objectDefs',
      severity: 'error',
      code: 'ingest.aborted',
      message: `Ingest aborted: ${message}`
    });
    await persistIngestLog(projectDir, ingestLog).catch(() => {/* best-effort */});
    sendEvent(res, { type: 'error', message });
  } finally {
    await cleanupUploadTempDir(req as UploadRequest);
  }

  res.end();
});

/**
 * Write the structured ingest diagnostics to `<projectDir>/ingest-log.json`.
 * Idempotent — overwrites any prior log so the latest run is what
 * `GET /api/projects/:id/ingest-log` returns. Best-effort: a write failure
 * is logged but does not fail the ingest.
 */
async function persistIngestLog(projectDir: string, builder: IngestLogBuilder): Promise<void> {
  try {
    const log = builder.build();
    await fs.writeJson(path.join(projectDir, 'ingest-log.json'), log, { spaces: 2 });
  } catch (err) {
    console.warn('[Ingest] Failed to persist ingest-log.json:', err);
  }
}

function findInDir(dir: string | null, filename: string): string | null {
  if (!dir) return null;
  const full = path.join(dir, filename);
  return fs.existsSync(full) ? full : null;
}

type RbpCsvPickBag = {
  primary: string | null;
  objectPerms: string | null;
  systemPerms: string | null;
};

/** Use RolesPermissions / RoleToPermission / … CSVs co-located with per-role JSON exports. */
async function augmentRbpCsvFromRoleJsonDirectory(
  dir: string | null | undefined,
  bag: RbpCsvPickBag
): Promise<void> {
  if (!dir || !(await fs.pathExists(dir))) return;
  const names = await fs.readdir(dir);
  const pick = (exactLower: string) => {
    const hit = names.find(f => f.toLowerCase() === exactLower);
    return hit ? path.join(dir, hit) : null;
  };
  if (!bag.primary) {
    bag.primary =
      pick('rolespermissions.csv') ||
      pick('roletoruleinformation.csv') ||
      pick('roles permissions.csv');
  }
  if (!bag.objectPerms) bag.objectPerms = pick('roletopermission.csv');
  if (!bag.systemPerms) bag.systemPerms = pick('roletomdfpermission.csv');
}

type ExistingUploads = {
  objectDefsDir: string | null;
  odataXml: string | null;
  corporateDm: string | null;
  countryDms: string[];
  successionDm: string | null;
  countrySuccessionModels: string[];
  workflowCsv: string | null;
  mergedWorkflowCsv: string | null;
  workflowSplitCsvs: { workflow?: string; dynamicRole?: string; ccRole?: string; contributor?: string };
  rulesCatalogCsv: string | null;
  rulesExportCsv: string | null;
  businessRulesAssignmentsCsv: string | null;
  rbpPrimaryRoles: string | null;
  rbpLegacyRoles: string | null;
  rbpRoleObjectPermissions: string | null;
  rbpRoleSystemPermissions: string | null;
  rbpRolePermissionJsonDir: string | null;
};

/**
 * CSV basenames treated as primary workflow / WFInfo-style tables when scanning `uploads/`.
 * Includes tenant-suffixed names like `Workflows*.csv` and split-bundle `Workflow.csv`.
 */
function isWorkflowPrimaryBasename(lower: string): boolean {
  if (!lower.endsWith('.csv') || lower.includes('contributor')) return false;
  const compact = lower.replace(/[^a-z0-9]/g, '');
  if (compact.startsWith('workflowccrole')) return false;
  if (compact.includes('dynamicrole')) return false;
  return (
    lower === 'workflow.csv' ||
    lower.startsWith('workflows') ||
    (lower.includes('workflow') && !compact.startsWith('workflowccrole'))
  );
}

/** Re-use from uploads/ when the basename matches common BRA export spellings. */
function isBusinessRulesAssignmentsFilename(lower: string): boolean {
  if (!lower.endsWith('.csv')) return false;
  const n = lower.replace(/\s/g, '');
  return (
    n === 'businessrulesassignments.csv' ||
    n === 'businessruleassignments.csv' ||
    n === 'businessrulesassignment.csv'
  );
}

async function resolveExistingUploads(uploadsDir: string): Promise<ExistingUploads> {
  const result: ExistingUploads = {
    objectDefsDir: null,
    odataXml: null,
    corporateDm: null,
    countryDms: [],
    successionDm: null,
    countrySuccessionModels: [],
    workflowCsv: null,
    mergedWorkflowCsv: null,
    workflowSplitCsvs: {},
    rulesCatalogCsv: null,
    rulesExportCsv: null,
    businessRulesAssignmentsCsv: null,
    rbpPrimaryRoles: null,
    rbpLegacyRoles: null,
    rbpRoleObjectPermissions: null,
    rbpRoleSystemPermissions: null,
    rbpRolePermissionJsonDir: null
  };

  if (!(await fs.pathExists(uploadsDir))) return result;

  const fileNames = await fs.readdir(uploadsDir);
  for (const f of fileNames) {
    const full = path.join(uploadsDir, f);
    const lower = f.toLowerCase();
    const stat = await fs.stat(full);
    if (stat.isDirectory()) {
      if (lower === 'roletopermissionjsons' && !result.rbpRolePermissionJsonDir) {
        result.rbpRolePermissionJsonDir = full;
      } else if (lower === 'rbp-json-bundle' && !result.rbpRolePermissionJsonDir) {
        result.rbpRolePermissionJsonDir = full;
      }
      continue;
    }
    if (lower.endsWith('.xml') && (lower.includes('odata') || lower.includes('metadata'))) result.odataXml = full;
    else if (lower.endsWith('.xml') && (lower.includes('cdm') || lower.includes('corporate'))) result.corporateDm = full;
    else if (lower.endsWith('.xml') && lower.includes('csf')) result.countryDms.push(full);
    else if (lower.endsWith('.xml') && (lower.includes('sdm') || lower.includes('succession'))) result.successionDm = full;
    else if (isWorkflowPrimaryBasename(lower)) {
      if (!result.workflowSplitCsvs.workflow) result.workflowSplitCsvs.workflow = full;
    } else if (
      lower === 'dynamic role.csv' ||
      (lower.endsWith('.csv') && lower.replace(/[^a-z0-9]/g, '').includes('dynamicrole'))
    ) {
      if (!result.workflowSplitCsvs.dynamicRole) result.workflowSplitCsvs.dynamicRole = full;
    } else if (
      lower === 'workflowccrole.csv' ||
      (lower.endsWith('.csv') &&
        lower.replace(/[^a-z0-9]/g, '').startsWith('workflowccrole') &&
        !lower.includes('contributor'))
    ) {
      if (!result.workflowSplitCsvs.ccRole) result.workflowSplitCsvs.ccRole = full;
    } else if (lower.endsWith('.csv') && lower.includes('contributor')) {
      if (!result.workflowSplitCsvs.contributor) result.workflowSplitCsvs.contributor = full;
    } else if (lower.endsWith('.csv') && (lower.includes('wfinfo') || lower.includes('wf-info'))) result.workflowCsv = full;
    else if (lower === 'workflow-merged.csv') result.mergedWorkflowCsv = full;
    else if (lower === 'rule.csv') result.rulesCatalogCsv = full;
    else if (lower.endsWith('.csv') && lower.includes('jobresponse')) result.rulesExportCsv = full;
    else if (isBusinessRulesAssignmentsFilename(lower)) result.businessRulesAssignmentsCsv = full;
    else if (lower === 'roletoruleinformation.csv') result.rbpPrimaryRoles = full;
    else if (lower === 'rolespermissions.csv') result.rbpPrimaryRoles = full;
    else if (lower === 'report_roles_report_example.csv') result.rbpLegacyRoles = full;
    else if (lower === 'roletopermission.csv') result.rbpRoleObjectPermissions = full;
    else if (lower === 'roletomdfpermission.csv') result.rbpRoleSystemPermissions = full;
  }

  // Heuristic: per-role RBP JSON export folders (e.g. `rbp-json-bundle/`) are not named RoleToPermissionJSONs.
  if (!result.rbpRolePermissionJsonDir) {
    for (const f of fileNames) {
      const full = path.join(uploadsDir, f);
      let dirStat: Stats;
      try {
        dirStat = await fs.stat(full);
      } catch {
        continue;
      }
      if (!dirStat.isDirectory()) continue;
      let inner: string[];
      try {
        inner = await fs.readdir(full);
      } catch {
        continue;
      }
      const jsonFiles = inner.filter(n => n.toLowerCase().endsWith('.json'));
      if (jsonFiles.length < 3) continue;
      const roleExportPattern = jsonFiles.filter(n => /^\d+_.+\.json$/i.test(n)).length;
      if (roleExportPattern >= 3 || (jsonFiles.length > 0 && roleExportPattern / jsonFiles.length >= 0.5)) {
        result.rbpRolePermissionJsonDir = full;
        break;
      }
    }
  }

  const projectDir = path.dirname(uploadsDir);
  const extractedObjectDefs = path.join(projectDir, 'extracted', 'object-defs');
  if (await fs.pathExists(extractedObjectDefs)) result.objectDefsDir = extractedObjectDefs + path.sep;

  const extractedMerged = path.join(projectDir, 'extracted', 'workflow-merged.csv');
  if (!result.mergedWorkflowCsv && (await fs.pathExists(extractedMerged))) {
    result.mergedWorkflowCsv = extractedMerged;
  }

  const extractedRbpBundle = path.join(projectDir, 'extracted', 'rbp-json-bundle');
  if (!result.rbpRolePermissionJsonDir && (await fs.pathExists(extractedRbpBundle))) {
    result.rbpRolePermissionJsonDir = extractedRbpBundle;
  }

  if (result.rbpRolePermissionJsonDir) {
    const coLocated: RbpCsvPickBag = {
      primary: result.rbpPrimaryRoles,
      objectPerms: result.rbpRoleObjectPermissions,
      systemPerms: result.rbpRoleSystemPermissions
    };
    await augmentRbpCsvFromRoleJsonDirectory(result.rbpRolePermissionJsonDir, coLocated);
    result.rbpPrimaryRoles = coLocated.primary;
    result.rbpRoleObjectPermissions = coLocated.objectPerms;
    result.rbpRoleSystemPermissions = coLocated.systemPerms;
  }

  return result;
}

export { app };

const PORT = process.env.PORT || 5174;
// Bind to loopback only by default. Set SUCCESSFACTORS_INSTANCE_EXPLORER_HOST=0.0.0.0 to expose on the LAN
// (only do this on a network you trust — the app has no auth).
const HOST = process.env.SUCCESSFACTORS_INSTANCE_EXPLORER_HOST || '127.0.0.1';
if (!IS_TEST_ENV && process.env.SUCCESSFACTORS_INSTANCE_EXPLORER_NO_LISTEN !== '1') {
  await init();
  app.listen(Number(PORT), HOST, () => {
    console.log(`[SuccessFactors Instance Explorer] Server running at http://${HOST}:${PORT}`);
    console.log(`[SuccessFactors Instance Explorer] Projects stored in: ${projectsDir}`);
  });
}
