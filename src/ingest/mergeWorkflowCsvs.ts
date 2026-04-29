import fs from 'fs-extra';
import path from 'path';

export interface WorkflowSplitPaths {
  workflow?: string;
  dynamicRole?: string;
  ccRole?: string;
  /** WorkflowContributor*.csv — joined on externalCode + step when available. */
  contributor?: string;
}

export type WorkflowMergeDiagnostics = {
  sources: Array<{ role: string; basename: string }>;
  contributor?: {
    rowsRead: number;
    primaryRowsWithContributorData: number;
    contributorKeysNeverMatched: number;
    sampleUnmatchedKeys: string[];
    note?: string;
  };
  dynamicRole?: {
    rowsRead: number;
    assignmentColumnCount: number;
    note?: string;
  };
};

function basenameSafe(p: string): string {
  return path.basename(p);
}

function normH(s: string): string {
  return s.trim().toLowerCase().replace(/\s/g, '');
}

/** Step column on contributor export: prefer wfConfigStep.step-num, else PROCESSING_ORDER tied to contributor entity. */
function findContributorStepColumnIndex(headerCols: string[]): number {
  let i = headerCols.findIndex(h => normH(h) === 'wfconfigstep.step-num');
  if (i !== -1) return i;
  i = headerCols.findIndex(h => {
    const n = normH(h);
    return n.includes('processing_order') && n.includes('contributor');
  });
  if (i !== -1) return i;
  return headerCols.findIndex(h => normH(h).includes('processing_order'));
}

function mergeContribCell(into: Record<string, string>, header: string, value: string): void {
  const t = value.trim();
  if (!t) return;
  const prev = into[header] ?? '';
  if (!prev) into[header] = t;
  else if (prev !== t) into[header] = `${prev} | ${t}`;
}

function uniqueHeadersForAppend(
  rawHeaders: string[],
  usedLower: Set<string>
): { finals: string[]; rawToFinal: Map<string, string> } {
  const finals: string[] = [];
  const rawToFinal = new Map<string, string>();
  for (const h of rawHeaders) {
    let f = h;
    let low = f.toLowerCase();
    let n = 0;
    while (usedLower.has(low)) {
      n += 1;
      f = `${h}__contrib${n}`;
      low = f.toLowerCase();
    }
    usedLower.add(low);
    finals.push(f);
    rawToFinal.set(h, f);
  }
  return { finals, rawToFinal };
}

async function readDynamicRoleDiagnostics(dynamicRole: string | undefined): Promise<WorkflowMergeDiagnostics['dynamicRole'] | undefined> {
  if (!dynamicRole || !(await fs.pathExists(dynamicRole))) return undefined;
  const raw = await fs.readFile(dynamicRole, 'utf8');
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { rowsRead: 0, assignmentColumnCount: 0, note: 'empty file' };
  const headerCols = parseRow(lines[0]!.replace(/^\uFEFF/, ''));
  const dynCols = headerCols.filter(h => normH(h).includes('dynamicroleassignment') || normH(h).startsWith('dynamicroleassignment'));
  return {
    rowsRead: Math.max(0, lines.length - 1),
    assignmentColumnCount: dynCols.length,
    note:
      dynCols.length > 0
        ? 'Dynamic Role export detected; assignment columns are summarized here only (not merged into primary rows in this version).'
        : 'Dynamic Role export present; no dynamicRoleAssignment.* columns found in header.'
  };
}

/**
 * Merges split workflow bundle CSVs into one WFInfo-shaped table for WorkflowEngine.
 * - Primary: approver-step rows.
 * - CC role: columns appended; joined on externalCode (last row wins per code).
 * - Contributor: columns appended; joined on externalCode + wfConfigStep.step-num when present,
 *   else externalCode only, else PROCESSING_ORDER column on contributor file.
 * - Dynamic Role: diagnostics only (row/column counts); merge deferred.
 */
export async function mergeWorkflowBundle(
  inputs: WorkflowSplitPaths,
  outPath: string
): Promise<{ path: string; diagnostics: WorkflowMergeDiagnostics }> {
  const { workflow, ccRole, contributor, dynamicRole } = inputs;

  if (!workflow) throw new Error('mergeWorkflowBundle: workflow path is required');

  const diagnostics: WorkflowMergeDiagnostics = {
    sources: [{ role: 'primary', basename: basenameSafe(workflow) }]
  };

  const wfContent = await fs.readFile(workflow, 'utf8');
  const wfLines = wfContent.split(/\r?\n/);
  const wfHeader = normalizeCsvLine((wfLines[0] ?? '').replace(/^\uFEFF/, ''));
  const wfRows = wfLines.slice(1).filter(l => l.trim()).map(l => normalizeCsvLine(l));

  const ccMap = new Map<string, Record<string, string>>();
  let ccHeaders: string[] = [];
  if (ccRole && (await fs.pathExists(ccRole))) {
    diagnostics.sources.push({ role: 'ccRole', basename: basenameSafe(ccRole) });
    const ccContent = await fs.readFile(ccRole, 'utf8');
    const ccLines = ccContent.split('\n').filter(l => l.trim());
    if (ccLines.length > 1) {
      ccHeaders = parseRow(normalizeCsvLine(ccLines[0]!)).filter(h => h.toLowerCase() !== 'externalcode');
      for (const line of ccLines.slice(1)) {
        const cols = parseRow(line);
        const headerCols = parseRow(normalizeCsvLine(ccLines[0]!));
        const extCodeIdx = headerCols.findIndex(h => h.toLowerCase() === 'externalcode');
        if (extCodeIdx === -1) continue;
        const key = cols[extCodeIdx]?.trim();
        if (!key) continue;
        const row: Record<string, string> = {};
        for (let i = 0; i < headerCols.length; i++) {
          if (i !== extCodeIdx) row[headerCols[i]] = cols[i] ?? '';
        }
        ccMap.set(key, row);
      }
    }
  }

  let contribFinalHeaders: string[] = [];
  let contribRawHeaders: string[] = [];
  const contribMap = new Map<string, Record<string, string>>();
  let contribExtIdx = -1;
  let contribStepIdx = -1;

  if (contributor && (await fs.pathExists(contributor))) {
    diagnostics.sources.push({ role: 'contributor', basename: basenameSafe(contributor) });
    const cContent = await fs.readFile(contributor, 'utf8');
    const cLines = cContent.split('\n').filter(l => l.trim());
    const rowsRead = Math.max(0, cLines.length - 1);
    if (cLines.length > 1) {
      const headerCols = parseRow(cLines[0]!.replace(/^\uFEFF/, ''));
      contribExtIdx = headerCols.findIndex(h => h.toLowerCase() === 'externalcode');
      if (contribExtIdx === -1) {
        diagnostics.contributor = {
          rowsRead,
          primaryRowsWithContributorData: 0,
          contributorKeysNeverMatched: 0,
          sampleUnmatchedKeys: [],
          note: 'contributor CSV has no externalCode column — skipped'
        };
      } else {
      contribStepIdx = findContributorStepColumnIndex(headerCols);
      contribRawHeaders = headerCols.filter((_, i) => i !== contribExtIdx);
      for (const line of cLines.slice(1)) {
        const cols = parseRow(line);
        const ext = cols[contribExtIdx]?.trim() ?? '';
        if (!ext) continue;
        const step =
          contribStepIdx >= 0 ? (cols[contribStepIdx] ?? '').trim() : '';
        const key = step ? `${ext}\t${step}` : `${ext}\t`;
        const row: Record<string, string> = {};
        for (let i = 0; i < headerCols.length; i++) {
          if (i === contribExtIdx) continue;
          mergeContribCell(row, headerCols[i], cols[i] ?? '');
        }
        const prev = contribMap.get(key);
        if (prev) {
          for (const h of contribRawHeaders) {
            mergeContribCell(prev, h, row[h] ?? '');
          }
        } else {
          contribMap.set(key, row);
        }
      }

      const usedLower = new Set<string>(
        [...parseRow(wfHeader), ...ccHeaders].map(h => h.trim().toLowerCase())
      );
      const { finals } = uniqueHeadersForAppend(contribRawHeaders, usedLower);
      contribFinalHeaders = finals;
      }
    }
    if (!diagnostics.contributor) {
      diagnostics.contributor = {
        rowsRead,
        primaryRowsWithContributorData: 0,
        contributorKeysNeverMatched: 0,
        sampleUnmatchedKeys: []
      };
    }
  }

  const dyn = await readDynamicRoleDiagnostics(dynamicRole);
  if (dynamicRole && (await fs.pathExists(dynamicRole))) {
    diagnostics.sources.push({ role: 'dynamicRole', basename: basenameSafe(dynamicRole) });
  }
  if (dyn) diagnostics.dynamicRole = dyn;

  let mergedHeader = ccHeaders.length ? `${wfHeader},${ccHeaders.join(',')}` : wfHeader;
  if (contribFinalHeaders.length) {
    mergedHeader = `${mergedHeader},${contribFinalHeaders.join(',')}`;
  }

  const mergedRows: string[] = [mergedHeader];
  const wfHeaderCols = parseRow(wfHeader);
  const extCodeIdx = wfHeaderCols.findIndex(h => h.toLowerCase() === 'externalcode');
  const stepIdxPrimary = wfHeaderCols.findIndex(h => normH(h) === 'wfconfigstep.step-num');

  const contribHitKeys = new Set<string>();

  for (const row of wfRows) {
    const cols = parseRow(row);
    const ext = extCodeIdx >= 0 ? (cols[extCodeIdx]?.trim() ?? '') : '';
    const step = stepIdxPrimary >= 0 ? (cols[stepIdxPrimary]?.trim() ?? '') : '';

    let ccSuffix = '';
    if (ccHeaders.length) {
      const cc = ext ? ccMap.get(ext) : undefined;
      ccSuffix = ccHeaders.map(h => cc?.[h] ?? '').join(',');
    }

    let contribSuffix = '';
    if (contribFinalHeaders.length) {
      if (ext) {
        const tryKeys = step ? [`${ext}\t${step}`, `${ext}\t`] : [`${ext}\t`];
        let cr: Record<string, string> | undefined;
        for (const k of tryKeys) {
          cr = contribMap.get(k);
          if (cr) {
            contribHitKeys.add(k);
            break;
          }
        }
        const hasData = cr && Object.values(cr).some(v => v && String(v).trim());
        if (hasData && diagnostics.contributor) {
          diagnostics.contributor.primaryRowsWithContributorData += 1;
        }
        contribSuffix = contribRawHeaders.map(raw => (cr?.[raw] ?? '').trim()).join(',');
      } else {
        contribSuffix = contribRawHeaders.map(() => '').join(',');
      }
    }

    if (!ccHeaders.length && !contribFinalHeaders.length) {
      mergedRows.push(row);
      continue;
    }
    const pieces = [row];
    if (ccHeaders.length) pieces.push(ccSuffix);
    if (contribFinalHeaders.length) pieces.push(contribSuffix);
    mergedRows.push(pieces.join(','));
  }

  if (diagnostics.contributor && contribMap.size > 0) {
    const never = [...contribMap.keys()].filter(k => !contribHitKeys.has(k));
    diagnostics.contributor.contributorKeysNeverMatched = never.length;
    diagnostics.contributor.sampleUnmatchedKeys = never.slice(0, 12);
  }

  await fs.ensureDir(path.dirname(outPath));
  await fs.writeFile(
    outPath,
    mergedRows.map(r => r.replace(/\r/g, '')).join('\n'),
    'utf8'
  );
  return { path: outPath, diagnostics };
}

/** Strip UTF-8 BOM and CR characters for stable header/row comparison. */
function normalizeCsvLine(line: string): string {
  let s = line.replace(/\r/g, '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s;
}

export function parseRow(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

/**
 * Concatenate multiple workflow-shaped CSVs that share the same header row.
 * Rows are de-duplicated by exact line content (after CR/BOM normalization).
 * Files with a different header are skipped (logged to console).
 */
export async function concatCompatibleWorkflowCsvs(
  inputPaths: string[],
  outPath: string
): Promise<string> {
  if (inputPaths.length === 0) {
    throw new Error('concatCompatibleWorkflowCsvs: at least one input file is required');
  }

  if (inputPaths.length === 1) {
    const content = await fs.readFile(inputPaths[0]!, 'utf8');
    await fs.ensureDir(path.dirname(outPath));
    await fs.writeFile(outPath, content.replace(/^\uFEFF/, ''), 'utf8');
    return outPath;
  }

  const firstRaw = await fs.readFile(inputPaths[0]!, 'utf8');
  const firstLines = firstRaw.split(/\r?\n/);
  const header0 = normalizeCsvLine(firstLines[0] ?? '');
  if (!header0.trim()) {
    throw new Error(`concatCompatibleWorkflowCsvs: missing header in ${inputPaths[0]}`);
  }

  const merged: string[] = [header0];
  const seen = new Set<string>();

  const absorbFile = async (filePath: string, isFirst: boolean) => {
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return;
    const hdr = normalizeCsvLine(lines[0]!);
    if (!isFirst && hdr !== header0) {
      console.warn(
        `[mergeWorkflowCsvs] Skipping "${path.basename(filePath)}": header does not match primary workflow export.`
      );
      return;
    }
    const dataStart = isFirst ? 1 : 1;
    for (let i = dataStart; i < lines.length; i++) {
      const row = normalizeCsvLine(lines[i]!);
      if (!row.trim()) continue;
      if (seen.has(row)) continue;
      seen.add(row);
      merged.push(row);
    }
  };

  await absorbFile(inputPaths[0]!, true);
  for (let k = 1; k < inputPaths.length; k++) {
    await absorbFile(inputPaths[k]!, false);
  }

  await fs.ensureDir(path.dirname(outPath));
  await fs.writeFile(outPath, merged.join('\n'), 'utf8');
  return outPath;
}
