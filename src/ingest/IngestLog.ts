/**
 * Structured ingest diagnostics emitted by every engine + the routing layer.
 *
 * The builder is created once per `runPipeline` invocation, threaded through
 * `EngineOptions.ingestLog`, then frozen into `graph.meta.diagnostics.ingestLog`.
 * The Express layer also persists the final log to `<projectDir>/ingest-log.json`
 * so the UI Export-Log buttons can re-fetch it via
 * `GET /api/projects/:id/ingest-log`.
 *
 * Design rules:
 *  - `file` always stores `path.basename(...)`. Never absolute paths
 *    (Windows path separators leak through golden snapshots otherwise).
 *  - Severity ordering is `info < warn < error` for UI sorting.
 *  - `code` is a stable dotted token — the UI groups + filters by it.
 */

export type IngestSeverity = 'info' | 'warn' | 'error';

export type IngestSection =
  | 'objectDefs'
  | 'rbp'
  | 'odata'
  | 'dataModel'
  | 'successionDm'
  | 'workflow'
  | 'rulesCatalog'
  | 'rulesAssignment';

export const INGEST_SECTIONS: readonly IngestSection[] = [
  'objectDefs',
  'rbp',
  'odata',
  'dataModel',
  'successionDm',
  'workflow',
  'rulesCatalog',
  'rulesAssignment'
] as const;

export interface IngestIssue {
  section: IngestSection;
  engine?: string;
  severity: IngestSeverity;
  code: string;
  message: string;
  /** Basename only — never absolute paths. */
  file?: string;
  line?: number;
  hint?: string;
  data?: Record<string, unknown>;
}

export interface IngestRejectedFile {
  file: string;
  reason: string;
}

export interface IngestLog {
  startedAt: string;
  finishedAt?: string;
  profileSlug: string | null;
  issues: IngestIssue[];
  filesAccepted: Record<IngestSection, string[]>;
  filesRejected: Record<IngestSection, IngestRejectedFile[]>;
}

function emptySectionMap<T>(seed: () => T): Record<IngestSection, T> {
  const out = {} as Record<IngestSection, T>;
  for (const section of INGEST_SECTIONS) out[section] = seed();
  return out;
}

export class IngestLogBuilder {
  private readonly startedAt: string;
  private profileSlug: string | null = null;
  private readonly issues: IngestIssue[] = [];
  private readonly filesAccepted: Record<IngestSection, string[]> = emptySectionMap(() => [] as string[]);
  private readonly filesRejected: Record<IngestSection, IngestRejectedFile[]> = emptySectionMap(
    () => [] as IngestRejectedFile[]
  );

  constructor() {
    this.startedAt = new Date().toISOString();
  }

  setProfileSlug(slug: string | null): void {
    this.profileSlug = slug;
  }

  add(issue: IngestIssue): void {
    this.issues.push({
      ...issue,
      file: issue.file ? basenameSafe(issue.file) : undefined
    });
  }

  acceptFile(section: IngestSection, fileOrPath: string): void {
    const base = basenameSafe(fileOrPath);
    if (!base) return;
    if (!this.filesAccepted[section].includes(base)) {
      this.filesAccepted[section].push(base);
    }
  }

  rejectFile(section: IngestSection, fileOrPath: string, reason: string): void {
    const base = basenameSafe(fileOrPath);
    if (!base) return;
    this.filesRejected[section].push({ file: base, reason });
  }

  /** Return a deep-copied snapshot suitable for JSON.stringify + persistence. */
  build(): IngestLog {
    return {
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      profileSlug: this.profileSlug,
      issues: this.issues.map(issue => ({ ...issue })),
      filesAccepted: cloneSectionMap(this.filesAccepted, list => [...list]),
      filesRejected: cloneSectionMap(this.filesRejected, list => list.map(entry => ({ ...entry })))
    };
  }
}

function cloneSectionMap<T>(
  source: Record<IngestSection, T>,
  cloneValue: (value: T) => T
): Record<IngestSection, T> {
  const out = {} as Record<IngestSection, T>;
  for (const section of INGEST_SECTIONS) out[section] = cloneValue(source[section]);
  return out;
}

/**
 * Strip directory components without depending on `path` (so the helper
 * works in browser tooling that consumes the same module).
 * Tolerates both POSIX and Windows separators.
 */
export function basenameSafe(value: string): string {
  if (!value) return '';
  const trimmed = `${value}`.replace(/[\\/]+$/, '');
  const sepIx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return sepIx >= 0 ? trimmed.slice(sepIx + 1) : trimmed;
}
