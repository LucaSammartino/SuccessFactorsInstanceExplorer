import { open } from 'node:fs/promises';
import path from 'node:path';
import { compareUtf16 } from '../core/deterministicSort.js';
import type { WorkflowSplitPaths } from './mergeWorkflowCsvs.js';

export type MulterFileLike = { originalname: string; path: string };

const normAlnum = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

export type ClassifiedWorkflowUploads = WorkflowSplitPaths & {
  wfInfo?: string;
  /** Primary Workflow / Workflows / WFInfo-style tables (split bundle primaries only; ordered at ingest). */
  workflowPaths: string[];
};

function isWfInfoFile(f: MulterFileLike): boolean {
  const lower = f.originalname.toLowerCase();
  const compact = normAlnum(f.originalname);
  return compact === 'wfinfocsv' || lower.includes('wfinfo');
}

function isContributorFile(f: MulterFileLike): boolean {
  const lower = f.originalname.toLowerCase();
  return lower.endsWith('.csv') && lower.includes('contributor');
}

function isCcRoleFile(f: MulterFileLike): boolean {
  if (isContributorFile(f)) return false;
  const lower = f.originalname.toLowerCase().replace(/\s/g, '');
  const compact = normAlnum(f.originalname);
  return (
    lower === 'workflowccrole.csv' ||
    compact === 'workflowccrolecsv' ||
    compact.startsWith('workflowccrole')
  );
}

function isDynamicRoleFile(f: MulterFileLike): boolean {
  const lower = f.originalname.toLowerCase();
  const compact = normAlnum(f.originalname);
  return (
    lower === 'dynamic role.csv' ||
    compact === 'dynamicrolecsv' ||
    (compact.includes('dynamicrole') && lower.endsWith('.csv'))
  );
}

function isExactWorkflowTableName(f: MulterFileLike): boolean {
  const lower = f.originalname.toLowerCase();
  return lower === 'workflow.csv' || lower === 'workflows.csv';
}

function isLooseWorkflowTableCandidate(f: MulterFileLike): boolean {
  const lower = f.originalname.toLowerCase();
  if (!lower.endsWith('.csv')) return false;
  if (lower.includes('contributor')) return false;
  if (lower.includes('ccrole') || lower.includes('cc-role')) return false;
  return lower.includes('workflow');
}

/** Primary approver-step table signal in export header (case-insensitive). */
const WF_PRIMARY_HEADER_SIGNAL = 'wfstepapprover.approvertype';

async function readCsvFirstLine(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(buf, 0, 65536, 0);
    const text = buf.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '');
    const line = /^[^\r\n]*/.exec(text);
    return (line ? line[0] : '').trim();
  } finally {
    await handle.close();
  }
}

/** Prefer `Workflow.csv` / `Workflows*.csv` over other `*workflow*` names when headers tie. */
function filenamePrimaryTier(basename: string): number {
  const lower = basename.toLowerCase();
  if (lower === 'workflow.csv' || lower === 'workflows.csv') return 0;
  if (lower.startsWith('workflows')) return 1;
  if (lower.startsWith('workflow')) return 2;
  return 3;
}

/**
 * Put the true approver-step export first so concat uses the correct header and other primaries append.
 */
export async function orderWorkflowPrimaryPaths(filePaths: string[]): Promise<string[]> {
  if (filePaths.length <= 1) return [...filePaths];

  const scored = await Promise.all(
    filePaths.map(async p => {
      let header = '';
      try {
        header = await readCsvFirstLine(p);
      } catch {
        header = '';
      }
      const hasApprover = header.toLowerCase().includes(WF_PRIMARY_HEADER_SIGNAL);
      const base = path.basename(p);
      return { p, hasApprover, tier: filenamePrimaryTier(base), base };
    })
  );

  scored.sort((a, b) => {
    if (a.hasApprover !== b.hasApprover) return a.hasApprover ? -1 : 1;
    if (a.tier !== b.tier) return a.tier - b.tier;
    return compareUtf16(a.base, b.base);
  });

  return scored.map(s => s.p);
}

/**
 * Classify SuccessFactors workflow CSV uploads (split bundle, combined WFInfo, or one/many primary tables).
 */
export function classifyWorkflowUploadFiles(files: MulterFileLike[]): ClassifiedWorkflowUploads {
  const workflowPaths: string[] = [];
  const pathSeen = new Set<string>();
  const pushPrimary = (p: string) => {
    if (!pathSeen.has(p)) {
      pathSeen.add(p);
      workflowPaths.push(p);
    }
  };

  let ccRole: string | undefined;
  let dynamicRole: string | undefined;
  let contributor: string | undefined;
  let wfInfo: string | undefined;
  const looseWorkflowNameMatches: MulterFileLike[] = [];
  const assignedPaths = new Set<string>();

  for (const f of files) {
    if (isWfInfoFile(f)) {
      if (!wfInfo) wfInfo = f.path;
      assignedPaths.add(f.path);
      continue;
    }
    if (isContributorFile(f)) {
      if (!contributor) contributor = f.path;
      assignedPaths.add(f.path);
      continue;
    }
    if (isCcRoleFile(f)) {
      if (!ccRole) ccRole = f.path;
      assignedPaths.add(f.path);
      continue;
    }
    if (isDynamicRoleFile(f)) {
      if (!dynamicRole) dynamicRole = f.path;
      assignedPaths.add(f.path);
      continue;
    }
    if (isExactWorkflowTableName(f)) {
      pushPrimary(f.path);
      assignedPaths.add(f.path);
      continue;
    }
    if (isLooseWorkflowTableCandidate(f)) {
      looseWorkflowNameMatches.push(f);
      assignedPaths.add(f.path);
    }
  }

  const rankedLoose = [...looseWorkflowNameMatches].sort((a, b) =>
    normAlnum(a.originalname).localeCompare(normAlnum(b.originalname))
  );
  for (const f of rankedLoose) {
    pushPrimary(f.path);
  }

  // Any remaining CSVs in this upload field are treated as primary tables when nothing else matched
  // (e.g. "MyExport.csv" with no "workflow" in the filename).
  if (workflowPaths.length === 0 && !wfInfo) {
    const salvage = files
      .filter(f => {
        if (!f.originalname.toLowerCase().endsWith('.csv')) return false;
        if (assignedPaths.has(f.path)) return false;
        return (
          !isCcRoleFile(f) &&
          !isDynamicRoleFile(f) &&
          !isWfInfoFile(f) &&
          !isContributorFile(f)
        );
      })
      .sort((a, b) => normAlnum(a.originalname).localeCompare(normAlnum(b.originalname)));
    for (const f of salvage) {
      pushPrimary(f.path);
    }
  }

  const workflow = workflowPaths[0];
  return { workflow, ccRole, dynamicRole, contributor, wfInfo, workflowPaths };
}

/**
 * Best workflow CSV path for WorkflowEngine: merged output, WFInfo export, or primary Workflow table.
 */
export function pickResolvedWorkflowPath(opts: {
  mergedPath: string | null;
  wfInfoPath: string | null;
  primaryWorkflowPath: string | null;
  looseWorkflowCsv: string | null;
  prevMerged: string | null;
  prevLoose: string | null;
}): string | null {
  return (
    opts.mergedPath ||
    opts.wfInfoPath ||
    opts.primaryWorkflowPath ||
    opts.looseWorkflowCsv ||
    opts.prevMerged ||
    opts.prevLoose ||
    null
  );
}

export function workflowMergedOutPath(extractDir: string): string {
  return path.join(extractDir, 'workflow-merged.csv');
}
