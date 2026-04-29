/**
 * SuccessFactors Instance Explorer Core Type Definitions
 *
 * Central type contracts for the SuccessFactors architectural graph.
 * All engines, core modules, and the server import from here.
 */

// ─── Node & Edge Type Literals ───────────────────────────────────────────────

export type NodeType = 'MDF_OBJECT' | 'BUSINESS_RULE' | 'RBP_ROLE' | 'ODATA_ENTITY';

export type EdgeType = 'ASSOCIATION' | 'TRIGGERED_BY' | 'MODIFIES' | 'EXPOSES';

export type RuleBindingType = 'SAVE' | 'VALIDATE' | 'INITIALIZE' | 'POST_SAVE' | 'INSERT' | 'DELETE' | 'FIELD_RULE';

export type ObjectClass = 'FOUNDATION' | 'GENERIC' | 'MDF';

export type ObjectTechnology = 'MDF' | 'LEGACY';

export type ModuleSource = 'direct' | 'category' | 'heuristic' | 'propagated' | 'default';

export type ModuleFamily =
  | 'EC' | 'ECP' | 'RCM' | 'ONB' | 'PM/GM' | 'SD'
  | 'LMS' | 'COMP' | 'JPB' | 'PLT' | 'STE' | 'TIH'
  | 'WFA' | 'Unclassified';

export type ModuleGroup =
  | 'Core HR & Payroll'
  | 'Talent Acquisition'
  | 'Talent Management'
  | 'Platform'
  | 'Analytics & Shared Services'
  | 'Unclassified'
  | 'Unknown';

// ─── Field / Attribute Types ─────────────────────────────────────────────────

export interface FieldDefinition {
  name: string;
  type: string;
  required: boolean;
  visibility: string;
  label: string;
}

export interface DataModelField {
  id: string;
  label: string;
  visibility?: string;
  required?: boolean;
  maxLength?: string;
  type?: string;
}

export interface CorporateDataModel {
  sourceId: string;
  sourceFile: string;
  fieldCount: number;
  fields: DataModelField[];
}

export interface CountryOverride {
  countryCode: string;
  sourceId?: string;
  fieldCount: number;
  fields: DataModelField[];
}

// ─── Module Classification ───────────────────────────────────────────────────

export interface ModuleCandidate {
  moduleFamily: string;
  moduleLabel: string;
}

export interface ModuleClassification extends ModuleCandidate {
  moduleSource: ModuleSource;
  moduleConfidence: number;
  moduleEvidence: string[];
}

// ─── Node Metadata ───────────────────────────────────────────────────────────

/** Base properties shared by all node types. */
interface NodeBase {
  id: string;
  type: NodeType;
  label: string;
  secondaryTypes?: string[];
  odataExposed?: boolean;

  // Module classification (set by ModuleClassifier)
  moduleFamily?: string;
  moduleLabel?: string;
  moduleSource?: ModuleSource;
  moduleConfidence?: number;
  moduleEvidence?: string[];
  subModule?: string;
  moduleGroup?: string;
  searchText?: string;

  // Array merge fields
  tags?: string[];
  searchKeywords?: string[];
}

/** MDF_OBJECT node metadata. */
export interface MdfObjectNode extends NodeBase {
  type: 'MDF_OBJECT';
  description?: string;
  category?: string;
  apiVisibility?: string;
  attributes?: FieldDefinition[];

  // Security (from RbpEngine)
  isSecured?: boolean;
  /** True when this MDF node was created only to anchor RBP JSON v2 permission rows (no object-definition row). */
  rbpJsonPermissionSurface?: boolean;
  permissionCategory?: string;
  roleAccessCount?: number;
  mdfPermissionObjectCount?: number;
  mdfPermissionCategories?: string[];
  systemPermissionCategories?: string[];

  // Taxonomy (from DataModelEngine)
  objectClass?: ObjectClass;
  objectTechnology?: ObjectTechnology;
  objectClassSource?: string;
  foundationFramework?: string;
  foundationGroup?: string;
  dataModelSources?: string[];
  dataModelAliases?: string[];
  corporateDataModel?: CorporateDataModel | null;
  countryOverrides?: CountryOverride[];
}

/** BUSINESS_RULE node metadata. */
export interface BusinessRuleNode extends NodeBase {
  type: 'BUSINESS_RULE';
  description?: string;
  ruleType?: string;
  scenarioCode?: string;
  baseObjectAlias?: string;
  baseObject?: string;
  resolvedBaseObject?: string;
  resolvedBaseObjectStrategy?: string;
  unresolvedBaseObject?: string;
  body?: string;
  modifiesFields?: string[];

  // From RulesAssignmentEngine
  assignmentInfo?: {
    assignmentText: string;
    effectiveDate: string | null;
    status: string | null;
    assignedScenario: string | null;
    sourceFile: string;
  };
  assignmentStatus?: string;
}

/** RBP_ROLE node metadata. */
export interface RbpRoleNode extends NodeBase {
  type: 'RBP_ROLE';
  targetPopulation?: string;
  grantedPopulation?: string;
  includeSelf?: string;
  accessUserStatus?: string;
  excludeByPerson?: string;
  excludeByUser?: string;
  memberCount?: string;
  roleSource?: string;
  mdfPermissionObjectCount?: number;
  mdfPermissionCategories?: string[];
  systemPermissionCount?: number;
  systemPermissionCategories?: string[];
  // client-2 / RBP JSON v2 fields
  userType?: string;
  status?: string;
  excludeLoginUser?: string;
  criteriaObjectName?: string;
  criteria?: string;
}

/** ODATA_ENTITY node metadata. */
export interface ODataEntityNode extends NodeBase {
  type: 'ODATA_ENTITY';
  creatable?: string | boolean;
  updatable?: string | boolean;
  deletable?: string | boolean;
  upsertable?: string | boolean;
  odataSetName?: string;
  matchedMdfObjectId?: string | null;
  matchStrategy?: string;
  matchConfidence?: number;
  matchCandidates?: Array<{ id: string; score: number; strategy: string }>;
}

/** Union of all typed node variants. */
export type SFNode = MdfObjectNode | BusinessRuleNode | RbpRoleNode | ODataEntityNode;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type DistributivePartial<T> = T extends unknown ? Partial<T> : never;

/** Partial metadata for addNode — allows any node property. */
export type NodeMetadata = DistributivePartial<DistributiveOmit<SFNode, 'id' | 'type'>>;

// ─── Edge Metadata ───────────────────────────────────────────────────────────

interface EdgeBase {
  from: string;
  to: string;
  type: EdgeType;
  id?: string;
  edgeSubtype?: string;
}

export interface AssociationEdge extends EdgeBase {
  type: 'ASSOCIATION';
  label?: string;
  multiplicity?: string;
  associationKind?: string;
  sourceFieldId?: string;
  destinationFieldId?: string;
  visibility?: string;
}

export interface TriggeredByEdge extends EdgeBase {
  type: 'TRIGGERED_BY';
  ruleBindingType?: RuleBindingType;
  fieldNames?: string[];
}

export interface ModifiesEdge extends EdgeBase {
  type: 'MODIFIES';
  context?: string;
  baseObjectAlias?: string;
  resolvedBy?: string;
}

export interface ExposesEdge extends EdgeBase {
  type: 'EXPOSES';
  exposureSource?: string;
  matchConfidence?: number;
}

export type SFEdge = AssociationEdge | TriggeredByEdge | ModifiesEdge | ExposesEdge;

export type EdgeMetadata = DistributivePartial<DistributiveOmit<SFEdge, 'from' | 'to' | 'type'>>;

// ─── Permission Summaries (stored in graph.meta) ─────────────────────────────

export interface FieldItem {
  objectHint: string;
  fieldName: string;
  actions: string[];
  actionTypes: string[];
  category: string;
}

export interface PopulationAssignment {
  id: string;
  name: string;
  population: string;
}

export interface RoleObjectPermission {
  roleId: string;
  objectId: string;
  permissions: string[];
  categories: string[];
  structures: string[];
  fieldOverrides: string[];
  searchText: string;
  fieldItems?: FieldItem[];
  fieldItemCount?: number;
  actionTypesRollup?: string[];
  populationAssignments?: PopulationAssignment[];
}

export interface RoleSystemPermission {
  roleId: string;
  permission: string;
  categories: string[];
  searchText: string;
}

// ─── Graph Meta ──────────────────────────────────────────────────────────────

export interface EngineDiagnostics {
  [engineName: string]: Record<string, unknown>;
}

export interface GraphDiagnostics {
  unresolvedRuleBaseObjects: Array<{
    ruleId: string;
    label: string;
    baseObjectAlias: string;
  }>;
  engines: EngineDiagnostics;
  /**
   * Structured ingest log emitted by the routing layer + every engine.
   * Populated by `runPipeline` from the `IngestLogBuilder` it threads through
   * `EngineOptions.ingestLog`. Persisted by the server to
   * `<projectDir>/ingest-log.json` for the UI Export-Log buttons.
   */
  ingestLog?: import('./ingest/IngestLog.js').IngestLog;
}

export interface GraphMeta {
  roleObjectPermissions: RoleObjectPermission[];
  roleSystemPermissions: RoleSystemPermission[];
  dataModels: Record<string, unknown> | null;
  workflow: Record<string, unknown> | null;
  diagnostics: GraphDiagnostics;
}

// ─── Engine Options ──────────────────────────────────────────────────────────

export interface EngineOptions {
  // MdfEngine
  objectDefsDir?: string | null;

  // RuleEngine
  rulesPath?: string | null;

  // RbpEngine
  rbpPrimaryRoles?: string | null;
  rbpLegacyRoles?: string | null;
  rbpRoleObjectPermissions?: string | null;
  rbpRoleSystemPermissions?: string | null;
  rbpSecurity?: string | null;

  // RbpJsonEngine
  rbpRolePermissionJsonDir?: string | null;

  // ODataEngine
  odataXml?: string | null;

  // DataModelEngine
  foundationReference?: string | null;
  corporateDataModel?: string | null;
  countrySpecificModels?: string[];
  successionDm?: string | null;
  countrySuccessionModels?: string[];

  // WorkflowEngine
  filePath?: string | null;

  // RulesAssignmentEngine
  rulesExportCsv?: string | null;

  // Client profile (optional — enables per-client overrides in engines)
  clientSlug?: string;

  /**
   * Shared ingest diagnostic builder. When present, engines + the routing layer
   * emit structured issues that surface in the per-section Export-Log download.
   * `runPipeline` always provides one — engines may treat the field as optional
   * for callers that bypass the pipeline.
   */
  ingestLog?: import('./ingest/IngestLog.js').IngestLogBuilder;
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

export interface PipelineOptions extends EngineOptions {
  onProgress?: (step: string, message: string) => void;
  onTiming?: (timing: PipelineTiming) => void;
  enableTiming?: boolean;
}

export interface PipelineTiming {
  step: string;
  message: string;
  durationMs: number;
}

export interface PipelineResult {
  graph: import('./core/GraphSchema.js').SFGraph;
  timings: PipelineTiming[];
  nodeCount: number;
  edgeCount: number;
}

// ─── Renderable Data ─────────────────────────────────────────────────────────

export interface RenderableData {
  nodes: SFNode[];
  edges: (SFEdge & { id: string })[];
  diagnostics: {
    totalNodes: number;
    totalEdges: number;
    renderableEdges: number;
    droppedEdgesCount: number;
    droppedEdges: SFEdge[];
  };
}

// ─── CSV Streaming ───────────────────────────────────────────────────────────

/**
 * Optional reporter signature used by `streamCsv` when a row level issue is
 * encountered. Passed through to the `ingestLog` builder by callers that
 * thread it. `section` is omitted because it is supplied by the caller.
 */
export type StreamCsvIssueReport = (issue: {
  severity: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  file?: string;
  line?: number;
  hint?: string;
  data?: Record<string, unknown>;
}) => void;

export interface StreamCsvOptions {
  /** Skip the second row (the SF "label row" that follows the header). Defaults true. */
  skipLabelRow?: boolean;
  /**
   * Skip a leading metadata/comment line above the header.
   * - `true` → use the default heuristic (`detectLeadingMetadataLine`).
   * - `RegExp` → match the first line; skip if it matches.
   * - `false` / `undefined` → never skip.
   */
  skipLeadingMetadata?: boolean | RegExp;
  /** Called once per row that fails to parse (csv-parser error). Streaming continues. */
  onMalformedRow?: (rowIx: number, raw: string) => void;
  /** Called for non-fatal events (`csv.empty`, `csv.metadataLine.skipped`, …). */
  onIssue?: StreamCsvIssueReport;
}
