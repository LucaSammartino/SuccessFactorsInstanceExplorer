import fs from 'fs-extra';
import { parseRow } from './mergeWorkflowCsvs.js';

/**
 * Heuristic: SuccessFactors workflow exports (Workflow / WFInfo-style) use externalCode
 * plus step/approver columns. Business rules assignment CSVs typically do not.
 */
export async function looksLikeWorkflowExportCsv(filePath: string): Promise<boolean> {
  if (!(await fs.pathExists(filePath))) return false;
  const raw = await fs.readFile(filePath, 'utf8');
  const firstLine = raw.split(/\r?\n/).find(l => l.trim()) ?? '';
  if (!firstLine) return false;
  const headers = parseRow(firstLine.replace(/^\uFEFF/, '')).map(h => h.trim().toLowerCase());
  const hasExternal = headers.some(h => h === 'externalcode' || h.endsWith('.externalcode'));
  const hasWorkflowShape = headers.some(h =>
    h.includes('wfconfigstep') ||
      h.includes('wfstepapprover') ||
      h.includes('wfconfigcontributor') ||
      h.includes('wfconfigcc')
  );
  return hasExternal && hasWorkflowShape;
}
