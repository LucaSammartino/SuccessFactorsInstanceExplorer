import fs from 'fs-extra';
import readline from 'node:readline';
import csv from 'csv-parser';
import type { StreamCsvIssueReport, StreamCsvOptions } from '../types.js';
import type { IngestLogBuilder, IngestSection } from '../ingest/IngestLog.js';

/**
 * Remove null/undefined/empty-string values from a plain object.
 * Shared across all ingestion engines.
 */
export function compact<T extends Record<string, unknown>>(object: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== '')
  ) as Partial<T>;
}

/**
 * Async path-existence check (thin wrapper around fs-extra pathExists).
 * Prefer over fs.existsSync in async engine methods.
 */
export const existsAsync = (p: string): Promise<boolean> =>
  p ? fs.pathExists(p) : Promise.resolve(false);

/**
 * Resolve engine file/dir path from pipeline options.
 * - `undefined` → use bundled sample/default path (local runs without explicit ingest paths).
 * - `null` or `''` → no path (ingest explicitly has no file — never fall back to samples).
 */
export function resolveEngineDataPath(
  value: string | null | undefined,
  defaultPath: string
): string {
  if (value === null || value === '') return '';
  if (value === undefined) return defaultPath;
  return value;
}

/** True when the caller omitted the option (as opposed to passing null to disable). */
export function isEngineOptionUnset(value: string | null | undefined): boolean {
  return value === undefined;
}

/**
 * Stable string key for deduping compound identifiers.
 */
export const compositeKey = (...parts: string[]): string => parts.join('|||');

/**
 * Reporter compatible with `streamCsv`'s `onIssue` option. It supplies the
 * engine-specific ingest-log envelope while preserving caller-provided details.
 */
export function makeEngineIssueReporter(
  ingestLog: IngestLogBuilder | undefined,
  section: IngestSection,
  engine: string,
  defaultFile?: string
): StreamCsvIssueReport | undefined {
  if (!ingestLog) return undefined;
  return issue => {
    ingestLog.add({
      section,
      engine,
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
      file: issue.file ?? defaultFile,
      line: issue.line,
      hint: issue.hint,
      data: issue.data
    });
  };
}

/**
 * Default heuristic for detecting a leading metadata/comment row above the real CSV header.
 * Both VariantNested and VariantFlat export business-rules-assignment CSVs whose first line reads:
 *   "The rule assignment information list contains all data effective as of: 04/19/2026."
 * Falls back to "long prose without commas in the first 30 chars" so future variants are
 * still caught. Returns true when the line should be skipped.
 */
export function isLeadingMetadataLine(line: string): boolean {
  const normalized = `${line || ''}`.replace(/^﻿/, '').trim();
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  if (lower.includes('the rule')) return true;
  if (lower.startsWith('# ') || lower.startsWith('// ')) return true;
  return normalized.length > 60 && !normalized.slice(0, 30).includes(',');
}

/**
 * Peek the first non-empty line of a file and decide whether it is a metadata/comment line
 * preceding the real CSV header. Pass a `RegExp` to override the default heuristic.
 */
export async function detectLeadingMetadataLine(
  filePath: string,
  matcher: RegExp | ((line: string) => boolean) = isLeadingMetadataLine
): Promise<boolean> {
  if (!(await existsAsync(filePath))) return false;

  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const test = typeof matcher === 'function' ? matcher : (s: string) => matcher.test(s);
      return test(line);
    }
    return false;
  } finally {
    rl.close();
    input.destroy();
  }
}

/**
 * Shared CSV streaming utility.
 *
 * Reads a CSV file row-by-row and calls `onRow` for each data row.
 *
 * Hardened in 2026-04 to tolerate the messy real-world shapes seen in
 * VariantNested + VariantFlat exports:
 *  - Optional skip of the SF "label row" (the second row that follows the header).
 *  - Optional skip of a leading metadata/comment line above the header
 *    (e.g. business rules assignment exports).
 *  - BOM stripping on cell values (csv-parser already handles header BOM).
 *  - Blank-row tolerance — rows where every cell is empty are dropped silently.
 *  - Empty-file detection — emits a `csv.empty` issue when no data rows arrive.
 *  - Row-level parse error recovery via `onMalformedRow`.
 */
export async function streamCsv<TRow extends Record<string, string> = Record<string, string>>(
  filePath: string,
  onRow: (row: TRow) => void,
  options: StreamCsvOptions = {}
): Promise<void> {
  const skipSecondRow = options.skipLabelRow !== false;
  const fileBasename = filePath ? filePath.split(/[\\/]/).pop() : undefined;

  let skipLines = 0;
  if (options.skipLeadingMetadata) {
    const matcher =
      typeof options.skipLeadingMetadata === 'object' && options.skipLeadingMetadata instanceof RegExp
        ? options.skipLeadingMetadata
        : isLeadingMetadataLine;
    if (await detectLeadingMetadataLine(filePath, matcher)) {
      skipLines = 1;
      options.onIssue?.({
        severity: 'info',
        code: 'csv.metadataLine.skipped',
        message: `Skipped leading metadata/comment line in ${fileBasename ?? filePath}.`,
        file: fileBasename
      });
    }
  }

  return new Promise((resolve, reject) => {
    let skipLabelRow = skipSecondRow;
    let dataRowsEmitted = 0;
    let rowIx = 0;
    const stream = fs.createReadStream(filePath);

    const parserOpts: { skipLines?: number; mapHeaders: ({ header }: { header: string }) => string } = {
      mapHeaders: ({ header }: { header: string }) => `${header || ''}`.replace(/^﻿/, '').trim()
    };
    if (skipLines > 0) parserOpts.skipLines = skipLines;

    stream
      .pipe(csv(parserOpts))
      .on('data', (row: Record<string, string>) => {
        rowIx += 1;

        if (skipLabelRow) {
          skipLabelRow = false;
          // Some SF exports include a second "label row" after the header.
          // Detect it by checking if the first cell looks like English prose.
          const firstVal = Object.values(row)[0] || '';
          if (/^[A-Z][a-z]/.test(firstVal) && firstVal.includes(' ') && firstVal.length > 30) {
            return; // skip label row
          }
        }

        // Strip BOM that may leak into the first cell on some Windows-exported files.
        for (const key of Object.keys(row)) {
          const value = row[key];
          if (typeof value === 'string' && value.charCodeAt(0) === 0xfeff) {
            row[key] = value.slice(1);
          }
        }

        // Skip rows where every value is empty/whitespace-only.
        const allBlank = Object.values(row).every(value => `${value || ''}`.trim() === '');
        if (allBlank) return;

        dataRowsEmitted += 1;
        try {
          onRow(row as TRow);
        } catch (err) {
          options.onMalformedRow?.(rowIx, JSON.stringify(row));
          options.onIssue?.({
            severity: 'warn',
            code: 'csv.row.handlerError',
            message: `Row handler failed at row ${rowIx} in ${fileBasename ?? filePath}: ${(err as Error).message}`,
            file: fileBasename,
            line: rowIx
          });
        }
      })
      .on('end', () => {
        if (dataRowsEmitted === 0) {
          options.onIssue?.({
            severity: 'warn',
            code: 'csv.empty',
            message: `CSV ${fileBasename ?? filePath} contained no data rows after the header.`,
            file: fileBasename,
            hint: 'Confirm the export was downloaded successfully and that the table actually has rows.'
          });
        }
        resolve();
      })
      .on('error', (err: Error) => {
        options.onIssue?.({
          severity: 'error',
          code: 'csv.parse.failed',
          message: `csv-parser error in ${fileBasename ?? filePath}: ${err.message}`,
          file: fileBasename
        });
        reject(err);
      });
    stream.on('error', reject);
  });
}

/**
 * Pick the first column whose name matches one of the given candidates,
 * tolerant of casing + surrounding whitespace. Useful when SuccessFactors
 * exports vary between `Role Name` / `role_name` / `roleName` etc.
 */
export function pickColumn<T extends Record<string, unknown>>(
  row: T,
  candidates: string[]
): string | null {
  if (!row) return null;
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const norm = candidate.trim().toLowerCase();
    const found = keys.find(k => k.trim().toLowerCase() === norm);
    if (found) {
      const value = `${row[found] ?? ''}`.trim();
      if (value) return value;
    }
  }
  return null;
}
