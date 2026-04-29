export type ProfileSlug = 'first-example' | 'client-2' | string;

export interface WorkflowInputs {
  combined?: string;
  split?: {
    workflow?: string;
    dynamicRole?: string;
    ccRole?: string;
    contributor?: string;
  };
}

export interface RbpInputs {
  primaryRoles?: string;
  legacyRoles?: string;
  roleObjectPermissions?: string;
  roleSystemPermissions?: string;
  rolePermissionJsonDir?: string;
  rolePermissionJsonSchema?: 'v1' | 'v2';
  security?: string;
}

export interface DataModelInputs {
  odataXml?: string;
  corporate?: string;
  country?: string[];
  succession?: string;
  countrySuccession?: string[];
  foundationMarkdown?: string;
}

export interface IngestProfile {
  slug: ProfileSlug;
  displayName: string;
  sourceRoot: string;
  mdf: { objectDefsDir: string | null; rulesCsvInsideObjectDefs: boolean };
  rules: { exportCsv?: string };
  dataModel: DataModelInputs;
  rbp: RbpInputs;
  workflow: WorkflowInputs;
  clientOverrides?: { slug: string };
}

export interface DetectIssue {
  /** Stable dotted token (e.g. `detect.rbpJson.parseError`). */
  code: string;
  /** Human-readable explanation of what the probe could not do. */
  message: string;
  /** Basename of the file the probe was attempting to read, when applicable. */
  file?: string;
}

export type DetectIssueReporter = (issue: DetectIssue) => void;

export interface ProfileDetector {
  slug: ProfileSlug;
  displayName: string;
  probe: (
    root: string,
    onIssue?: DetectIssueReporter
  ) => Promise<{ confidence: number; evidence: string[] }>;
}
