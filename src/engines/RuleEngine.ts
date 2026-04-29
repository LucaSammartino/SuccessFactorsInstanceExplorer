import path from 'node:path';
import type { SFGraph } from '../core/GraphSchema.js';
import type { BusinessRuleNode, EngineOptions } from '../types.js';
import type { IngestLogBuilder } from '../ingest/IngestLog.js';
import {
  compact,
  compositeKey,
  existsAsync,
  isEngineOptionUnset,
  makeEngineIssueReporter,
  resolveEngineDataPath,
  streamCsv
} from './utils.js';
import { getClientProfile } from '../clients/index.js';

/**
 * Rule Ingestion Engine
 *
 * Parses business rules, resolves base objects where possible, and keeps
 * unresolved aliases as diagnostics instead of dangling graph edges.
 */
const DEFAULT_RULE_PATH = 'sample-data/SSFFRealinstancefiles/Rules/Rule.csv';

type RuleCsvRow = Record<string, string>;

type BaseObjectResolution = {
  id: string;
  strategy: string;
};

export class RuleEngine {
  graph: SFGraph;
  filePath: string;
  _usingDefault: boolean;
  ruleLinkIndex: Set<string>;
  baseObjectOverrides: Record<string, string>;
  ingestLog?: IngestLogBuilder;
  private idLowerToCanonical = new Map<string, string>();
  private labelLowerToId = new Map<string, string>();

  constructor(graph: SFGraph, options: EngineOptions = {}) {
    this.graph = graph;
    this.filePath = resolveEngineDataPath(options.rulesPath, DEFAULT_RULE_PATH);
    this._usingDefault = isEngineOptionUnset(options.rulesPath);
    this.ruleLinkIndex = new Set();
    this.ingestLog = options.ingestLog;
    this.baseObjectOverrides = {
      jobInfo: 'JobInfo',
      jobInfoModel: 'JobInfo',
      personalInfo: 'PersonalInfo',
      personalInfoModel: 'PersonalInfo',
      homeAddressModel: 'HomeAddress',
      employmentInfo: 'EmploymentInfo',
      employmentInfoModel: 'EmploymentInfo',
      personInfo: 'PersonInfo',
      compInfo: 'CompInfo',
      compInfoModel: 'CompInfo',
      payComponentRecurring: 'PayComponentRecurring',
      payComponentRecurringModel: 'PayComponentRecurring',
      nationalIdCardModel: 'NationalIdCard',
      personRelationshipInfo: 'PersonRelationshipInfo',
      personRelationshipInfoModel: 'PersonRelationshipInfo',
      ONB2ProcessRuleModel: 'ONB2Process',
      ONB2ProcessTaskParticipantsRuleModel: 'ONB2Process',
      // Merge per-client overrides from ClientProfile
      ...getClientProfile(options.clientSlug)?.ruleBaseObjectOverrides
    };
  }

  /** Mutates the shared graph with business-rule nodes and rule metadata parsed from exported rule CSVs. */
  async run(): Promise<void> {
    console.log('[Rule Engine] Starting ingestion...');
    if (!(await existsAsync(this.filePath))) {
      if (this._usingDefault) console.log('[Rule Engine] skipping - no path configured');
      else {
        console.error(`[Rule Engine] File not found: ${this.filePath}`);
        makeEngineIssueReporter(this.ingestLog, 'rulesCatalog', 'RuleEngine')?.({
          severity: 'warn',
          code: 'rules.catalog.missing',
          message: `Rule catalog CSV not found at ${this.filePath}.`
        });
      }
      return;
    }

    this.rebuildBaseObjectLookupIndexes();
    const baseName = path.basename(this.filePath);
    const onIssue = makeEngineIssueReporter(this.ingestLog, 'rulesCatalog', 'RuleEngine', baseName);

    await streamCsv<RuleCsvRow>(this.filePath, (row) => {
      const ruleId = row.code;
      const baseObjectAlias = row.baseObject;
      const body = row.body || '';

      if (!ruleId) return;

      this.graph.addNode(ruleId, 'BUSINESS_RULE', compact({
        label: row.name || ruleId,
        description: row.description,
        ruleType: row.ruleType,
        scenarioCode: row.scenarioCode,
        baseObjectAlias,
        body: body || undefined
      }));
      this.indexNodeForBaseObjectResolution(ruleId, row.name || ruleId);

      if (!baseObjectAlias) return;

      const resolution = this.resolveBaseObject(baseObjectAlias);
      const ruleNode = this.graph.nodes.get(ruleId);
      if (!ruleNode || ruleNode.type !== 'BUSINESS_RULE') return;

      if (resolution) {
        ruleNode.baseObject = resolution.id;
        ruleNode.resolvedBaseObject = resolution.id;
        ruleNode.resolvedBaseObjectStrategy = resolution.strategy;
        this.linkResolvedBaseObject(resolution.id, ruleId, baseObjectAlias, resolution.strategy);
      } else {
        ruleNode.unresolvedBaseObject = baseObjectAlias;
        this.recordUnresolvedBaseObject(ruleId, ruleNode.label || ruleId, baseObjectAlias);
      }

      this.extractFieldModifications(ruleId, baseObjectAlias, body);
    }, { skipLeadingMetadata: true, onIssue });

    const unresolved = this.graph.meta.diagnostics.unresolvedRuleBaseObjects.length;
    const parsedRules = Array.from(this.graph.nodes.values()).filter(n => n.type === 'BUSINESS_RULE').length;
    this.graph.addEngineDiagnostic?.('rules', { parsedRules, unresolvedBaseObjects: unresolved });
    if (unresolved > 0) {
      makeEngineIssueReporter(this.ingestLog, 'rulesCatalog', 'RuleEngine')?.({
        severity: 'info',
        code: 'rules.baseObjects.unresolved',
        message: `${unresolved} business rule(s) reference base objects that could not be resolved.`,
        data: { count: unresolved }
      });
    }
    console.log('[Rule Engine] Ingestion complete.');
  }

  private rebuildBaseObjectLookupIndexes(): void {
    this.idLowerToCanonical.clear();
    this.labelLowerToId.clear();
    for (const node of this.graph.nodes.values()) {
      const id = node.id;
      const idLower = id.toLowerCase();
      if (!this.idLowerToCanonical.has(idLower)) this.idLowerToCanonical.set(idLower, id);
      const lab = `${node.label || ''}`.trim().toLowerCase();
      if (lab && !this.labelLowerToId.has(lab)) this.labelLowerToId.set(lab, id);
    }
  }

  /** New BUSINESS_RULE nodes must be visible to later rows (label / id resolution). */
  private indexNodeForBaseObjectResolution(nodeId: string, label: string): void {
    const idLower = nodeId.toLowerCase();
    if (!this.idLowerToCanonical.has(idLower)) this.idLowerToCanonical.set(idLower, nodeId);
    const lab = `${label || ''}`.trim().toLowerCase();
    if (lab && !this.labelLowerToId.has(lab)) this.labelLowerToId.set(lab, nodeId);
  }

  linkResolvedBaseObject(objectId: string, ruleId: string, baseObjectAlias: string, strategy: string): void {
    const key = compositeKey(objectId, ruleId);
    if (this.ruleLinkIndex.has(key)) return;
    this.ruleLinkIndex.add(key);

    this.graph.addEdge(objectId, ruleId, 'MODIFIES', compact({
      context: 'Base Object',
      baseObjectAlias,
      resolvedBy: strategy
    }));
  }

  resolveBaseObject(alias: string): BaseObjectResolution | null {
    const cleanAlias = `${alias || ''}`.trim();
    if (!cleanAlias) return null;

    const overrideTarget = this.baseObjectOverrides[cleanAlias];
    if (overrideTarget && this.graph.nodes.has(overrideTarget)) {
      return { id: overrideTarget, strategy: 'override' };
    }

    const exact = this.findById(cleanAlias);
    if (exact) return { id: exact, strategy: 'exact-id' };

    const caseInsensitiveId = this.findCaseInsensitiveId(cleanAlias);
    if (caseInsensitiveId) return { id: caseInsensitiveId, strategy: 'case-insensitive-id' };

    const exactLabel = this.findByExactLabel(cleanAlias);
    if (exactLabel) return { id: exactLabel, strategy: 'exact-label' };

    const strippedAlias = cleanAlias.replace(/(Model|Bean)$/i, '');
    if (strippedAlias && strippedAlias !== cleanAlias) {
      const strippedExact = this.findById(strippedAlias);
      if (strippedExact) return { id: strippedExact, strategy: 'stripped-suffix-id' };

      const strippedInsensitive = this.findCaseInsensitiveId(strippedAlias);
      if (strippedInsensitive) return { id: strippedInsensitive, strategy: 'stripped-suffix-case-insensitive-id' };

      const strippedLabel = this.findByExactLabel(strippedAlias);
      if (strippedLabel) return { id: strippedLabel, strategy: 'stripped-suffix-label' };
    }

    return null;
  }

  findById(id: string): string | null {
    return this.graph.nodes.has(id) ? id : null;
  }

  findCaseInsensitiveId(id: string): string | null {
    return this.idLowerToCanonical.get(id.toLowerCase()) ?? null;
  }

  findByExactLabel(label: string): string | null {
    return this.labelLowerToId.get(label.toLowerCase()) ?? null;
  }

  recordUnresolvedBaseObject(ruleId: string, label: string, baseObjectAlias: string): void {
    const diagnostics = this.graph.meta.diagnostics?.unresolvedRuleBaseObjects;
    if (!Array.isArray(diagnostics)) return;

    const alreadyTracked = diagnostics.some(entry => entry.ruleId === ruleId && entry.baseObjectAlias === baseObjectAlias);
    if (alreadyTracked) return;

    diagnostics.push({ ruleId, label, baseObjectAlias });
  }

  extractFieldModifications(ruleId: string, baseObjectAlias: string, body: string): void {
    const escapedBase = baseObjectAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escapedBase}\\.([a-zA-Z0-9_]+)\\s*=(?!=)`, 'g');

    const modifiedFields = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = regex.exec(body)) !== null) {
      modifiedFields.add(match[1]);
    }

    if (modifiedFields.size === 0) return;

    const ruleNode = this.graph.nodes.get(ruleId);
    if (!ruleNode || ruleNode.type !== 'BUSINESS_RULE') return;

    ruleNode.modifiesFields = Array.from(new Set([...(ruleNode.modifiesFields || []), ...modifiedFields])).sort();
  }
}
