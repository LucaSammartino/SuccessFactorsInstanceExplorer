import fs from 'fs-extra';
import path from 'node:path';
import readline from 'node:readline';
import type { SFGraph } from '../core/GraphSchema.js';
import type { EngineOptions } from '../types.js';
import type { IngestLogBuilder } from '../ingest/IngestLog.js';
import { compareUtf16 } from '../core/deterministicSort.js';
import { makeEngineIssueReporter, resolveEngineDataPath } from './utils.js';

const DEFAULT_WORKFLOW_PATH = './sample-data/SSFFRealinstancefiles/WorkflowsData/WFInfo.csv';

type WorkflowActor = Record<string, string>;
type WorkflowDynamicAssignment = Record<string, string>;

const DYNAMIC_PREFIX = 'dynamicRoleAssignment.';
/** Column index + output key; avoids Map lookup per dynamic cell per row. */
type WorkflowDynamicColumn = { shortKey: string; index: number };

type WorkflowColumnIx = {
  externalCode: Array<number | undefined>;
  name: number | undefined;
  wfConfigStep: number | undefined;
  wfStepApprover_approverType: number | undefined;
  wfStepApprover_approverRole: number | undefined;
  wfStepApprover_actionType: number | undefined;
  wfStepApprover_skipType: number | undefined;
  baseObjectType: number | undefined;
  baseObjectType2: number | undefined;
  wfConfigContributor_actorType: number | undefined;
  wfConfigContributor_actorRole: number | undefined;
  wfConfigContributor_context: number | undefined;
  wfConfigContributor_respectRBP: number | undefined;
  wfConfigContributor_relationshipToApprover: number | undefined;
  wfConfigCC_actorType: number | undefined;
  wfConfigCC_actorRole: number | undefined;
  wfConfigCC_context: number | undefined;
  wfConfigCC_respectRBP: number | undefined;
  wfConfigCC_relationshipToApprover: number | undefined;
  wfConfigCC_emailConfiguration: number | undefined;
  wfStepApprover_context: number | undefined;
  wfStepApprover_respectRBP: number | undefined;
  wfStepApprover_relationshipToApprover: number | undefined;
  wfStepApprover_emailConfiguration: number | undefined;
  is_delegate_supported: number | undefined;
  future_dated_alternate_workflow: number | undefined;
  is_cc_link_to_approval_page: number | undefined;
};

type WorkflowStep = {
  stepNumber: string;
  approvers: WorkflowActor[];
  contributors: WorkflowActor[];
  ccActors: WorkflowActor[];
  dynamicAssignments: WorkflowDynamicAssignment[];
  baseObjectTypes: string[];
};

type WorkflowSummaryEntry = {
  code: string;
  name: string;
  rowCount: number;
  stepCount: number;
  approverTypes: string[];
  approverRoles: string[];
  actionTypes: string[];
  skipTypes: string[];
  baseObjectTypes: string[];
  hasDynamicAssignment: boolean;
  hasContributors: boolean;
  hasCcActors: boolean;
  delegateSupported: boolean;
  futureDatedAlternateWorkflow: boolean;
  ccLinkToApprovalPage: boolean;
  respectRbp: boolean;
  steps: WorkflowStep[];
};

type WorkflowSummaryResult = {
  summary: {
    present: boolean;
    filePath: string;
    fileSizeBytes?: number;
    physicalLineCount?: number;
    recordCount?: number;
    columnCount?: number;
    workflowCount?: number;
    duplicateHeaders?: Array<{ name: string; count: number }>;
    uniqueApproverTypeCount?: number;
    uniqueApproverRoleCount?: number;
    uniqueActionTypeCount?: number;
    uniqueSkipTypeCount?: number;
    uniqueBaseObjectTypeCount?: number;
  };
  stats?: ReturnType<typeof buildWorkflowStats>;
  diagnostics: Record<string, unknown>;
  workflows?: WorkflowSummaryEntry[];
};

type WorkflowStepBucket = {
  stepNumber: string;
  approvers: Map<string, WorkflowActor>;
  contributors: Map<string, WorkflowActor>;
  ccActors: Map<string, WorkflowActor>;
  dynamicAssignments: Map<string, WorkflowDynamicAssignment>;
  baseObjectTypes: Set<string>;
};

type WorkflowBucket = {
  code: string;
  name: string;
  rowCount: number;
  stepNumbers: Set<string>;
  approverTypes: Set<string>;
  approverRoles: Set<string>;
  actionTypes: Set<string>;
  skipTypes: Set<string>;
  baseObjectTypes: Set<string>;
  hasDynamicAssignment: boolean;
  hasContributors: boolean;
  hasCcActors: boolean;
  delegateSupportedCount: number;
  futureDatedCount: number;
  ccLinkCount: number;
  respectRbpCount: number;
  steps: Map<string, WorkflowStepBucket>;
};

type DuplicateHeaderEntry = { name: string; count: number };

type MissingSignals = {
  missingWorkflowCodeRows: number;
  missingStepNumberRows: number;
  missingApproverTypeRows: number;
};

function firstNonEmptyCells(fields: string[], indices: Array<number | undefined>): string {
  for (const i of indices) {
    if (i === undefined) continue;
    const v = fields[i];
    if (!v) continue;
    const t = v.trim();
    if (t) return t;
  }
  return '';
}

function truthyFlagCell(fields: string[], idx: number | undefined): boolean {
  if (idx === undefined) return false;
  const v = fields[idx];
  if (!v) return false;
  const normalized = v.trim().toUpperCase();
  return normalized === 'T' || normalized === 'TRUE' || normalized === 'YES';
}

function compactActorFields(fields: string[], pairs: Array<[string, number | undefined]>): WorkflowActor | null {
  const out: WorkflowActor = {};
  let n = 0;
  for (const [key, idx] of pairs) {
    if (idx === undefined) continue;
    const v = fields[idx];
    if (!v) continue;
    const t = v.trim();
    if (!t) continue;
    out[key] = t;
    n++;
  }
  return n > 0 ? out : null;
}

type ActorMixed = { key: string; idx?: number; literal?: string };

function buildActorMixed(fields: string[], spec: ActorMixed[]): WorkflowActor | null {
  const out: WorkflowActor = {};
  let n = 0;
  for (const { key, idx, literal } of spec) {
    if (literal !== undefined) {
      if (!literal) continue;
      out[key] = literal;
      n++;
      continue;
    }
    if (idx === undefined) continue;
    const v = fields[idx];
    if (!v) continue;
    const t = v.trim();
    if (!t) continue;
    out[key] = t;
    n++;
  }
  return n > 0 ? out : null;
}

function buildWorkflowColumnIx(fieldIndex: Record<string, number>): WorkflowColumnIx {
  const p = (name: string): number | undefined => fieldIndex[name];
  return {
    externalCode: [p('externalCode'), p('externalCode__2'), p('externalCode__3'), p('externalCode__4')],
    name: p('name'),
    wfConfigStep: p('wfConfigStep.step-num'),
    wfStepApprover_approverType: p('wfStepApprover.approverType'),
    wfStepApprover_approverRole: p('wfStepApprover.approverRole'),
    wfStepApprover_actionType: p('wfStepApprover.actionType'),
    wfStepApprover_skipType: p('wfStepApprover.skipType'),
    baseObjectType: p('baseObjectType'),
    baseObjectType2: p('baseObjectType__2'),
    wfConfigContributor_actorType: p('wfConfigContributor.actorType'),
    wfConfigContributor_actorRole: p('wfConfigContributor.actorRole'),
    wfConfigContributor_context: p('wfConfigContributor.context'),
    wfConfigContributor_respectRBP: p('wfConfigContributor.respectRBP'),
    wfConfigContributor_relationshipToApprover: p('wfConfigContributor.relationshipToApprover'),
    wfConfigCC_actorType: p('wfConfigCC.actorType'),
    wfConfigCC_actorRole: p('wfConfigCC.actorRole'),
    wfConfigCC_context: p('wfConfigCC.context'),
    wfConfigCC_respectRBP: p('wfConfigCC.respectRBP'),
    wfConfigCC_relationshipToApprover: p('wfConfigCC.relationshipToApprover'),
    wfConfigCC_emailConfiguration: p('wfConfigCC.emailConfiguration'),
    wfStepApprover_context: p('wfStepApprover.context'),
    wfStepApprover_respectRBP: p('wfStepApprover.respectRBP'),
    wfStepApprover_relationshipToApprover: p('wfStepApprover.relationshipToApprover'),
    wfStepApprover_emailConfiguration: p('wfStepApprover.emailConfiguration'),
    is_delegate_supported: p('is_delegate_supported'),
    future_dated_alternate_workflow: p('future_dated_alternate_workflow'),
    is_cc_link_to_approval_page: p('is_cc_link_to_approval_page')
  };
}

export class WorkflowEngine {
  graph: SFGraph;
  filePath: string;
  ingestLog?: IngestLogBuilder;

  constructor(graph: SFGraph, options: EngineOptions = {}) {
    this.graph = graph;
    this.filePath = resolveEngineDataPath(options.filePath, DEFAULT_WORKFLOW_PATH);
    this.ingestLog = options.ingestLog;
  }

  /** Mutates the shared graph metadata with workflow topology and workflow-to-object relationships. */
  async run(): Promise<void> {
    if (!this.filePath) {
      this.graph.meta.workflow = {
        summary: {
          present: false,
          filePath: ''
        },
        diagnostics: {
          status: 'missing',
          notes: ['No workflow CSV provided.']
        }
      };
      makeEngineIssueReporter(this.ingestLog, 'workflow', 'WorkflowEngine')?.({
        severity: 'info',
        code: 'workflow.csv.missing',
        message: 'No workflow CSV provided — skipping workflow processing.'
      });
      return;
    }

    const resolvedPath = path.resolve(this.filePath);
    const stat = await fs.stat(resolvedPath).catch(() => null);
    if (!stat?.isFile()) {
      this.graph.meta.workflow = {
        summary: {
          present: false,
          filePath: path.basename(resolvedPath)
        },
        diagnostics: {
          status: 'missing',
          notes: stat ? ['Workflow export path is not a file.'] : ['Workflow export file not found.']
        }
      };
      makeEngineIssueReporter(this.ingestLog, 'workflow', 'WorkflowEngine')?.({
        severity: 'info',
        code: 'workflow.csv.missing',
        message: 'No workflow CSV provided — skipping workflow processing.'
      });
      return;
    }

    const baseName = path.basename(resolvedPath);
    const reportIssue = makeEngineIssueReporter(this.ingestLog, 'workflow', 'WorkflowEngine', baseName);
    const summary = await summarizeWorkflowCsv(resolvedPath, baseName);
    this.graph.meta.workflow = summary as unknown as Record<string, unknown>;

    const recordCount = summary.summary.recordCount ?? 0;
    if (recordCount === 0) {
      reportIssue?.({
        severity: 'warn',
        code: 'workflow.csv.empty',
        message: `Workflow CSV ${baseName} contained no data rows after the header.`,
        hint: 'Re-export the workflow report from the SuccessFactors Report Center.'
      });
    } else {
      reportIssue?.({
        severity: 'info',
        code: 'workflow.csv.summary',
        message: `Workflow CSV processed: ${recordCount} row(s), ${summary.summary.workflowCount ?? 0} workflow(s).`,
        data: {
          recordCount,
          workflowCount: summary.summary.workflowCount,
          columnCount: summary.summary.columnCount
        }
      });
    }

    const dups = summary.summary.duplicateHeaders ?? [];
    if (dups.length > 0) {
      reportIssue?.({
        severity: 'info',
        code: 'workflow.csv.duplicateHeaders',
        message: `Workflow CSV ${baseName} has duplicated header columns: ${dups.map(d => `${d.name} (×${d.count})`).join(', ')}.`,
        data: { duplicates: dups }
      });
    }
  }
}

async function summarizeWorkflowCsv(filePath: string, fileLabel: string): Promise<WorkflowSummaryResult> {
  const duplicateHeaders: DuplicateHeaderEntry[] = [];
  const workflowMap = new Map<string, WorkflowBucket>();
  const uniqueApproverTypes = new Set<string>();
  const uniqueApproverRoles = new Set<string>();
  const uniqueActionTypes = new Set<string>();
  const uniqueSkipTypes = new Set<string>();
  const uniqueBaseObjectTypes = new Set<string>();
  const missingSignals: MissingSignals = {
    missingWorkflowCodeRows: 0,
    missingStepNumberRows: 0,
    missingApproverTypeRows: 0
  };

  const fileStat = await fs.stat(filePath);
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let rawHeaders: string[] = [];
  let normalizedHeaders: string[] = [];
  /** Only `dynamicRoleAssignment.*` columns — index + short key (no Map lookup per cell). */
  let dynamicColumns: WorkflowDynamicColumn[] = [];
  const fieldIndex: Record<string, number> = {};
  let ix!: WorkflowColumnIx;
  let physicalLineCount = 0;
  let recordCount = 0;
  const incompleteLines: string[] = [];

  const processFields = (fields: string[]): void => {
    const workflowCode = firstNonEmptyCells(fields, ix.externalCode);
    const workflowName = firstNonEmptyCells(fields, [ix.name]) || workflowCode || 'Unnamed Workflow';
    const stepNumber = firstNonEmptyCells(fields, [ix.wfConfigStep]);
    const approverType = firstNonEmptyCells(fields, [ix.wfStepApprover_approverType]);
    const approverRole = firstNonEmptyCells(fields, [ix.wfStepApprover_approverRole]);
    const actionType = firstNonEmptyCells(fields, [ix.wfStepApprover_actionType]);
    const skipType = firstNonEmptyCells(fields, [ix.wfStepApprover_skipType]);
    const primaryBaseObjectType = firstNonEmptyCells(fields, [ix.baseObjectType]);
    const secondaryBaseObjectType = firstNonEmptyCells(fields, [ix.baseObjectType2]);
    const contributor = compactActorFields(fields, [
      ['actorType', ix.wfConfigContributor_actorType],
      ['actorRole', ix.wfConfigContributor_actorRole],
      ['context', ix.wfConfigContributor_context],
      ['respectRBP', ix.wfConfigContributor_respectRBP],
      ['relationshipToApprover', ix.wfConfigContributor_relationshipToApprover]
    ]);
    const ccActor = compactActorFields(fields, [
      ['actorType', ix.wfConfigCC_actorType],
      ['actorRole', ix.wfConfigCC_actorRole],
      ['context', ix.wfConfigCC_context],
      ['respectRBP', ix.wfConfigCC_respectRBP],
      ['relationshipToApprover', ix.wfConfigCC_relationshipToApprover],
      ['emailConfiguration', ix.wfConfigCC_emailConfiguration]
    ]);
    const approver = buildActorMixed(fields, [
      { key: 'actorType', literal: approverType },
      { key: 'actorRole', literal: approverRole },
      { key: 'context', idx: ix.wfStepApprover_context },
      { key: 'actionType', literal: actionType },
      { key: 'skipType', literal: skipType },
      { key: 'respectRBP', idx: ix.wfStepApprover_respectRBP },
      { key: 'relationshipToApprover', idx: ix.wfStepApprover_relationshipToApprover },
      { key: 'emailConfiguration', idx: ix.wfStepApprover_emailConfiguration }
    ]);
    const dynamicAssignment = compactDynamicAssignment(dynamicColumns, fields);

    if (!workflowCode) missingSignals.missingWorkflowCodeRows += 1;
    if (!stepNumber) missingSignals.missingStepNumberRows += 1;
    if (!approverType) missingSignals.missingApproverTypeRows += 1;

    if (approverType) uniqueApproverTypes.add(approverType);
    if (approverRole) uniqueApproverRoles.add(approverRole);
    if (actionType) uniqueActionTypes.add(actionType);
    if (skipType) uniqueSkipTypes.add(skipType);
    if (primaryBaseObjectType) uniqueBaseObjectTypes.add(primaryBaseObjectType);
    if (secondaryBaseObjectType) uniqueBaseObjectTypes.add(secondaryBaseObjectType);

    if (!workflowCode) {
      return;
    }

    let workflow = workflowMap.get(workflowCode);
    if (!workflow) {
      workflow = createWorkflowBucket(workflowCode, workflowName);
      workflowMap.set(workflowCode, workflow);
    }

    workflow.rowCount += 1;
    if (workflow.name === workflow.code && workflowName) workflow.name = workflowName;
    if (stepNumber) workflow.stepNumbers.add(stepNumber);
    if (approverType) workflow.approverTypes.add(approverType);
    if (approverRole) workflow.approverRoles.add(approverRole);
    if (actionType) workflow.actionTypes.add(actionType);
    if (skipType) workflow.skipTypes.add(skipType);
    if (primaryBaseObjectType) workflow.baseObjectTypes.add(primaryBaseObjectType);
    if (secondaryBaseObjectType) workflow.baseObjectTypes.add(secondaryBaseObjectType);
    if (truthyFlagCell(fields, ix.is_delegate_supported)) workflow.delegateSupportedCount += 1;
    if (truthyFlagCell(fields, ix.future_dated_alternate_workflow)) workflow.futureDatedCount += 1;
    if (truthyFlagCell(fields, ix.is_cc_link_to_approval_page)) workflow.ccLinkCount += 1;
    if (truthyFlagCell(fields, ix.wfStepApprover_respectRBP)) workflow.respectRbpCount += 1;
    if (contributor) workflow.hasContributors = true;
    if (ccActor) workflow.hasCcActors = true;
    if (dynamicAssignment) workflow.hasDynamicAssignment = true;

    const stepKey = stepNumber || 'Unspecified';
    const step = ensureWorkflowStep(workflow, stepKey);
    if (approver) mergeIntoSet(step.approvers, approver);
    if (contributor) mergeIntoSet(step.contributors, contributor);
    if (ccActor) mergeIntoSet(step.ccActors, ccActor);
    if (dynamicAssignment) mergeIntoSet(step.dynamicAssignments, dynamicAssignment);
    if (primaryBaseObjectType) step.baseObjectTypes.add(primaryBaseObjectType);
    if (secondaryBaseObjectType) step.baseObjectTypes.add(secondaryBaseObjectType);
  };

  for await (const line of rl) {
    physicalLineCount += 1;
    incompleteLines.push(line);
    const combined = incompleteLines.join('\n');

    if (!isCompleteCsvRecord(combined)) {
      continue;
    }

    const fields = parseCsvRecord(combined);
    incompleteLines.length = 0;

    if (rawHeaders.length === 0) {
      rawHeaders = fields;
      const headerInfo = normalizeHeaders(rawHeaders);
      normalizedHeaders = headerInfo.headers;
      duplicateHeaders.push(...headerInfo.duplicates);
      for (let hi = 0; hi < normalizedHeaders.length; hi++) {
        fieldIndex[normalizedHeaders[hi]] = hi;
      }
      ix = buildWorkflowColumnIx(fieldIndex);
      dynamicColumns = [];
      for (let hi = 0; hi < normalizedHeaders.length; hi++) {
        const h = normalizedHeaders[hi];
        if (!h.startsWith(DYNAMIC_PREFIX)) continue;
        dynamicColumns.push({ shortKey: h.slice(DYNAMIC_PREFIX.length), index: hi });
      }
      continue;
    }

    recordCount += 1;
    processFields(fields);
  }

  if (incompleteLines.length > 0 && rawHeaders.length > 0) {
    recordCount += 1;
    processFields(parseCsvRecord(incompleteLines.join('\n')));
  }

  const workflows: WorkflowSummaryEntry[] = Array.from(workflowMap.values())
    .sort((left, right) => {
      return right.stepNumbers.size - left.stepNumbers.size ||
        right.rowCount - left.rowCount ||
        compareUtf16(left.name, right.name);
    })
    .map(workflow => ({
      code: workflow.code,
      name: workflow.name,
      rowCount: workflow.rowCount,
      stepCount: workflow.stepNumbers.size,
      approverTypes: Array.from(workflow.approverTypes).sort(),
      approverRoles: Array.from(workflow.approverRoles).sort().slice(0, 12),
      actionTypes: Array.from(workflow.actionTypes).sort(),
      skipTypes: Array.from(workflow.skipTypes).sort(),
      baseObjectTypes: Array.from(workflow.baseObjectTypes).sort(),
      hasDynamicAssignment: workflow.hasDynamicAssignment,
      hasContributors: workflow.hasContributors,
      hasCcActors: workflow.hasCcActors,
      delegateSupported: workflow.delegateSupportedCount > 0,
      futureDatedAlternateWorkflow: workflow.futureDatedCount > 0,
      ccLinkToApprovalPage: workflow.ccLinkCount > 0,
      respectRbp: workflow.respectRbpCount > 0,
      steps: Array.from(workflow.steps.values())
        .sort((left, right) => compareStepNumbers(left.stepNumber, right.stepNumber))
        .map(step => ({
          stepNumber: step.stepNumber,
          approvers: Array.from(step.approvers.values()),
          contributors: Array.from(step.contributors.values()),
          ccActors: Array.from(step.ccActors.values()),
          dynamicAssignments: Array.from(step.dynamicAssignments.values()),
          baseObjectTypes: Array.from(step.baseObjectTypes).sort()
        }))
    }));

  const workflowStats = buildWorkflowStats(workflows, missingSignals);

  return {
    summary: {
      present: true,
      filePath: fileLabel,
      fileSizeBytes: fileStat.size,
      physicalLineCount,
      recordCount,
      columnCount: rawHeaders.length,
      workflowCount: workflowMap.size,
      duplicateHeaders,
      uniqueApproverTypeCount: uniqueApproverTypes.size,
      uniqueApproverRoleCount: uniqueApproverRoles.size,
      uniqueActionTypeCount: uniqueActionTypes.size,
      uniqueSkipTypeCount: uniqueSkipTypes.size,
      uniqueBaseObjectTypeCount: uniqueBaseObjectTypes.size
    },
    stats: workflowStats,
    diagnostics: {
      status: 'normalized',
      parseStrategy: 'custom csv parser with duplicate-header aliasing and multiline record support',
      representableCapabilities: [
        'workflow identity from repeated workflow codes',
        'ordered workflow steps when wfConfigStep.step-num is present',
        'approver actor type and role summaries',
        'skip and action behavior summaries',
        'delegate, CC, contributor, and dynamic-assignment presence flags',
        'base object type hints when populated'
      ],
      missingDataRisks: [
        'duplicate headers make naive CSV import unreliable',
        'documentation cross-check is still required before treating every column as semantically complete',
        'base object type appears in multiple header positions and may represent different contexts',
        'this export does not by itself prove trigger conditions, routing branches, or linkage to every upstream business rule'
      ],
      trustedFields: [
        'workflow code and name',
        'step number',
        'approver type and role',
        'action type and skip type',
        'respectRBP',
        'delegate support',
        'contributor and CC actor presence',
        'dynamic assignment presence'
      ],
      ambiguousFields: [
        'baseObjectType when multiple baseObjectType columns disagree',
        'exact upstream trigger source for each workflow',
        'branching semantics beyond row-level step order',
        'whether every repeated row represents a distinct approver path or duplicated export grain'
      ],
      recommendedAdditionalInputs: [
        'workflow implementation documentation or export dictionary for WFInfo.csv',
        'authoritative mapping from workflow definitions to MDF objects or triggering scenarios',
        'documentation for branching, escalation, reminder, and alternate-workflow semantics',
        'any separate export that captures workflow-to-rule or workflow-to-event bindings'
      ],
      incompleteSignals: missingSignals
    },
    workflows
  };
}

function createWorkflowBucket(code: string, name: string): WorkflowBucket {
  return {
    code,
    name,
    rowCount: 0,
    stepNumbers: new Set<string>(),
    approverTypes: new Set<string>(),
    approverRoles: new Set<string>(),
    actionTypes: new Set<string>(),
    skipTypes: new Set<string>(),
    baseObjectTypes: new Set<string>(),
    hasDynamicAssignment: false,
    hasContributors: false,
    hasCcActors: false,
    delegateSupportedCount: 0,
    futureDatedCount: 0,
    ccLinkCount: 0,
    respectRbpCount: 0,
    steps: new Map<string, WorkflowStepBucket>()
  };
}

function normalizeHeaders(headers: string[]): { headers: string[]; duplicates: DuplicateHeaderEntry[] } {
  const seen = new Map<string, number>();
  const duplicates: DuplicateHeaderEntry[] = [];

  const normalized = headers.map(header => {
    const cleanHeader = `${header || ''}`.trim();
    const currentCount = (seen.get(cleanHeader) || 0) + 1;
    seen.set(cleanHeader, currentCount);

    if (currentCount > 1) {
      duplicates.push({ name: cleanHeader, count: currentCount });
      return `${cleanHeader}__${currentCount}`;
    }

    return cleanHeader;
  });

  return {
    headers: normalized,
    duplicates: summarizeDuplicateHeaders(duplicates)
  };
}

function summarizeDuplicateHeaders(entries: DuplicateHeaderEntry[]): DuplicateHeaderEntry[] {
  const byName = new Map<string, number>();
  entries.forEach(entry => {
    const current = byName.get(entry.name) || 1;
    byName.set(entry.name, Math.max(current, entry.count));
  });
  return Array.from(byName.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || compareUtf16(left.name, right.name));
}

function isCompleteCsvRecord(record: string): boolean {
  let inQuotes = false;

  for (let index = 0; index < record.length; index += 1) {
    const char = record[index];
    if (char !== '"') continue;

    const nextChar = record[index + 1];
    if (inQuotes && nextChar === '"') {
      index += 1;
      continue;
    }

    inQuotes = !inQuotes;
  }

  return !inQuotes;
}

function parseCsvRecord(record: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < record.length; index += 1) {
    const char = record[index];

    if (char === '"') {
      const nextChar = record[index + 1];
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function ensureWorkflowStep(workflow: WorkflowBucket, stepNumber: string): WorkflowStepBucket {
  if (!workflow.steps.has(stepNumber)) {
    workflow.steps.set(stepNumber, {
      stepNumber,
      approvers: new Map<string, WorkflowActor>(),
      contributors: new Map<string, WorkflowActor>(),
      ccActors: new Map<string, WorkflowActor>(),
      dynamicAssignments: new Map<string, WorkflowDynamicAssignment>(),
      baseObjectTypes: new Set<string>()
    });
  }

  return workflow.steps.get(stepNumber)!;
}

function compactDynamicAssignment(cols: WorkflowDynamicColumn[], fields: string[]): WorkflowDynamicAssignment | null {
  let out: WorkflowDynamicAssignment | null = null;
  for (const { shortKey, index } of cols) {
    const raw = fields[index];
    if (!raw) continue;
    const value = raw.trim();
    if (!value) continue;
    if (!out) out = {};
    out[shortKey] = value;
  }
  return out;
}

/** Canonical dedupe key (sorted keys) so equivalent maps merge regardless of insertion order. */
function stableRecordDedupeKey(record: Record<string, string>): string {
  const keys = Object.keys(record).sort();
  let out = '';
  for (const k of keys) {
    const v = record[k];
    if (!v) continue;
    out += '\x1e' + k + '\x1f' + v;
  }
  return out;
}

function mergeIntoSet<T extends Record<string, string>>(map: Map<string, T>, value: T): void {
  const key = stableRecordDedupeKey(value);
  if (!map.has(key)) map.set(key, value);
}

function compareStepNumbers(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const leftValid = Number.isFinite(leftNumber);
  const rightValid = Number.isFinite(rightNumber);

  if (leftValid && rightValid) return leftNumber - rightNumber;
  if (leftValid) return -1;
  if (rightValid) return 1;
  return compareUtf16(`${left}`, `${right}`);
}

function buildWorkflowStats(workflows: WorkflowSummaryEntry[], missingSignals: MissingSignals) {
  const byBaseObjectType: Record<string, number> = {};
  const byApproverType: Record<string, number> = {};
  let totalSteps = 0;
  let maxStepCount = 0;
  let workflowsWithDynamicAssignment = 0;
  let workflowsWithDelegation = 0;
  let workflowsWithContributors = 0;
  let workflowsWithCcActors = 0;

  workflows.forEach(workflow => {
    totalSteps += workflow.stepCount;
    maxStepCount = Math.max(maxStepCount, workflow.stepCount);
    if (workflow.hasDynamicAssignment) workflowsWithDynamicAssignment += 1;
    if (workflow.delegateSupported) workflowsWithDelegation += 1;
    if (workflow.hasContributors) workflowsWithContributors += 1;
    if (workflow.hasCcActors) workflowsWithCcActors += 1;

    workflow.baseObjectTypes.forEach(type => {
      byBaseObjectType[type] = (byBaseObjectType[type] || 0) + 1;
    });

    workflow.approverTypes.forEach(type => {
      byApproverType[type] = (byApproverType[type] || 0) + 1;
    });
  });

  return {
    averageStepCount: workflows.length > 0 ? Number((totalSteps / workflows.length).toFixed(1)) : 0,
    maxStepCount,
    workflowsWithDynamicAssignment,
    workflowsWithDelegation,
    workflowsWithContributors,
    workflowsWithCcActors,
    missingWorkflowCodeRows: missingSignals.missingWorkflowCodeRows,
    missingStepNumberRows: missingSignals.missingStepNumberRows,
    missingApproverTypeRows: missingSignals.missingApproverTypeRows,
    byBaseObjectType,
    byApproverType
  };
}
