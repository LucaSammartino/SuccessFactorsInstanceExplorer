import fs from 'fs-extra';
import path from 'node:path';
import csv from 'csv-parser';
import type { SFGraph } from '../core/GraphSchema.js';
import type { BusinessRuleNode, EngineOptions } from '../types.js';
import type { IngestLogBuilder } from '../ingest/IngestLog.js';
import { compact, compositeKey, detectLeadingMetadataLine, isLeadingMetadataLine, makeEngineIssueReporter } from './utils.js';
import { getClientProfile } from '../clients/index.js';

/**
 * Rules Assignment Engine
 *
 * Reads the "jobResponse*.csv" exported from SAP SuccessFactors
 * Configure Business Rules -> Export rules including assignment information.
 *
 * It cross-references that CSV with rule nodes already in the graph
 * (populated from Rule.csv inside the Object Definitions zip) and attaches
 * assignment info to each matched node.
 *
 * Join strategy (in order of preference):
 *   1. row[codeCol] === node.id   (exact rule code match)
 *   2. row[nameCol].toLowerCase() === node.label.toLowerCase()  (name fallback)
 */

type RuleExportCsvRow = Record<string, string>;

export class RulesAssignmentEngine {
  graph: SFGraph;
  filePath: string | null;
  ruleLinkIndex: Set<string>;
  baseObjectOverrides: Record<string, string>;
  ingestLog?: IngestLogBuilder;
  private idLowerToCanonical = new Map<string, string>();
  private labelLowerToId = new Map<string, string>();

  constructor(graph: SFGraph, options: EngineOptions = {}) {
    this.graph = graph;
    this.filePath = options.rulesExportCsv || null;
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
      ...getClientProfile(options.clientSlug)?.ruleBaseObjectOverrides
    };
  }

  /** Mutates the shared graph with business-rule assignment metadata and assignment-derived fallback nodes. */
  async run(): Promise<void> {
    if (!this.filePath) return;
    if (!(await fs.pathExists(this.filePath))) {
      console.warn(`[RulesAssignment] File not found: ${this.filePath}`);
      makeEngineIssueReporter(this.ingestLog, 'rulesAssignment', 'RulesAssignmentEngine')?.({
        severity: 'warn',
        code: 'rules.assignment.missing',
        message: `Rules assignment CSV not found at ${this.filePath}.`
      });
      return;
    }

    console.log('[RulesAssignment] Starting cross-reference...');
    const baseName = path.basename(this.filePath);
    const reportIssue = makeEngineIssueReporter(
      this.ingestLog,
      'rulesAssignment',
      'RulesAssignmentEngine',
      baseName
    );

    const rows = await this.readCsv(this.filePath, baseName);
    if (rows.length === 0) {
      console.warn('[RulesAssignment] No rows found in file.');
      reportIssue?.({
        severity: 'warn',
        code: 'csv.empty',
        message: `${baseName} contained no data rows after the header.`
      });
      return;
    }

    const keys = Object.keys(rows[0]);
    const codeCol = this.detectColumn(keys, ['code', 'Rule Code', 'ruleCode', 'RuleCode', 'rule_code', 'Rule ID']);
    const nameCol = this.detectColumn(keys, ['name', 'Rule Name', 'ruleName', 'RuleName', 'rule_name']);
    const assignmentCol = this.detectColumn(keys, ['assignment', 'Assignment', 'AssignmentInformation', 'assignment_information', 'assignmentInfo']);
    const dateCol = this.detectColumn(keys, ['effectiveStartDate', 'Effective Start Date', 'effectiveDate', 'startDate', 'Start Date']);
    const statusCol = this.detectColumn(keys, ['status', 'Status', 'ruleStatus']);
    const scenarioCodeCol = this.detectColumn(keys, ['scenarioCode', 'Scenario Code']);
    const scenarioNameCol = this.detectColumn(keys, ['scenario', 'Scenario']);
    const baseObjectCol = this.detectColumn(keys, ['baseObject', 'Base Object']);
    const ruleTypeCol = this.detectColumn(keys, ['ruleType', 'Rule Type', 'ruleTypeCode', 'Rule Type Code']);
    const descriptionCol = this.detectColumn(keys, ['description', 'Description']);

    // Detect source format by column signature
    const isBusinessRulesFormat = keys.some(k => k.trim() === 'Rule ID');

    console.log(`[RulesAssignment] Detected columns - code: ${codeCol || 'none'}, name: ${nameCol || 'none'}, assignment: ${assignmentCol || 'none'}`);

    this.rebuildBaseObjectLookupIndexes();

    const ruleNodesByName = new Map<string, BusinessRuleNode>();
    this.graph.nodes.forEach((node, id) => {
      if (node.type !== 'BUSINESS_RULE') return;
      const labelKey = (node.label || id).toLowerCase().trim();
      if (!ruleNodesByName.has(labelKey)) ruleNodesByName.set(labelKey, node);
    });

    let matched = 0;
    let unmatched = 0;
    let created = 0;
    let resolvedBaseObjects = 0;

    for (const row of rows) {
      const code = codeCol ? (row[codeCol] || '').trim() : '';
      const name = nameCol ? (row[nameCol] || '').trim() : '';
      const assignmentText = assignmentCol ? (row[assignmentCol] || '').trim() : '';
      const effectiveDate = dateCol ? (row[dateCol] || '').trim() : '';
      const status = statusCol ? (row[statusCol] || '').trim() : '';
      const scenarioCode = scenarioCodeCol ? (row[scenarioCodeCol] || '').trim() : '';
      const assignedScenario = scenarioNameCol ? (row[scenarioNameCol] || '').trim() : '';
      const baseObjectAlias = baseObjectCol ? (row[baseObjectCol] || '').trim() : '';
      const ruleType = ruleTypeCol ? (row[ruleTypeCol] || '').trim() : '';
      const description = descriptionCol ? (row[descriptionCol] || '').trim() : '';
      const fallbackId = code || name;

      let node: BusinessRuleNode | null =
        code && this.graph.nodes.get(code)?.type === 'BUSINESS_RULE'
          ? this.graph.nodes.get(code) as BusinessRuleNode
          : null;

      if (!node && name) {
        node = ruleNodesByName.get(name.toLowerCase()) || null;
      }

      if (!node && fallbackId) {
        const createdNode = this.graph.addNode(fallbackId, 'BUSINESS_RULE', compact({
          label: name || fallbackId,
          description,
          ruleType,
          scenarioCode: scenarioCode || assignedScenario || undefined,
          baseObjectAlias: baseObjectAlias || undefined
        }));
        node = createdNode?.type === 'BUSINESS_RULE' ? createdNode : null;
        if (node) created += 1;
      } else if (node) {
        const updatedNode = this.graph.addNode(node.id, 'BUSINESS_RULE', compact({
          label: name || node.label || node.id,
          description,
          ruleType,
          scenarioCode: scenarioCode || assignedScenario || undefined,
          baseObjectAlias: baseObjectAlias || undefined
        }));
        node = updatedNode?.type === 'BUSINESS_RULE' ? updatedNode : null;
      }

      if (!node) {
        unmatched += 1;
        continue;
      }

      const labelKey = (node.label || node.id).toLowerCase().trim();
      if (labelKey && !ruleNodesByName.has(labelKey)) ruleNodesByName.set(labelKey, node);
      const idKey = node.id.toLowerCase().trim();
      if (idKey && !ruleNodesByName.has(idKey)) ruleNodesByName.set(idKey, node);

      if (baseObjectAlias && !node.resolvedBaseObject && !node.baseObject) {
        const resolution = this.resolveBaseObject(baseObjectAlias);
        if (resolution) {
          const updatedNode = this.graph.addNode(node.id, 'BUSINESS_RULE', {
            baseObject: resolution.id,
            resolvedBaseObject: resolution.id,
            resolvedBaseObjectStrategy: resolution.strategy,
            baseObjectAlias
          });
          node = updatedNode?.type === 'BUSINESS_RULE' ? updatedNode : node;
          this.linkResolvedBaseObject(resolution.id, node.id, baseObjectAlias, resolution.strategy);
          resolvedBaseObjects += 1;
        } else if (!node.unresolvedBaseObject) {
          const updatedNode = this.graph.addNode(node.id, 'BUSINESS_RULE', {
            unresolvedBaseObject: baseObjectAlias,
            baseObjectAlias
          });
          node = updatedNode?.type === 'BUSINESS_RULE' ? updatedNode : node;
          this.recordUnresolvedBaseObject(node.id, node.label || node.id, baseObjectAlias);
        }
      }

      node.assignmentInfo = {
        assignmentText: assignmentText || 'No assignment text available.',
        effectiveDate: effectiveDate || null,
        status: status || null,
        assignedScenario: assignedScenario || null,
        sourceFile: isBusinessRulesFormat ? 'businessrulesassignments.csv' : 'jobResponse CSV'
      };

      if (status) node.assignmentStatus = status;

      matched += 1;
    }

    console.log(`[RulesAssignment] Matched ${matched} rules, ${unmatched} unmatched, created ${created} nodes.`);
    console.log('[RulesAssignment] Cross-reference complete.');
    this.graph.addEngineDiagnostic?.('rulesAssignment', { matched, unmatched, created, resolvedBaseObjects });

    if (matched > 0 || created > 0) {
      reportIssue?.({
        severity: 'info',
        code: 'rules.assignment.summary',
        message: `Cross-referenced ${matched} rule(s); created ${created} new rule node(s); ${unmatched} row(s) could not be matched.`,
        data: { matched, unmatched, created, resolvedBaseObjects }
      });
    }
    if (unmatched > 0) {
      reportIssue?.({
        severity: 'warn',
        code: 'rules.assignment.unmatched',
        message: `${unmatched} assignment row(s) could not be matched to any rule.`,
        data: { unmatched },
        hint: 'These rows were ignored. Confirm the rule names/codes in the assignment CSV match the catalog export.'
      });
    }
  }

  detectColumn(keys: string[], candidates: string[]): string | null {
    for (const candidate of candidates) {
      const found = keys.find(key => key.trim() === candidate || key.trim().toLowerCase() === candidate.toLowerCase());
      if (found) return found;
    }
    return null;
  }

  async readCsv(filePath: string, baseName: string): Promise<RuleExportCsvRow[]> {
    const skip = await detectLeadingMetadataLine(filePath);
    if (skip) {
      makeEngineIssueReporter(this.ingestLog, 'rulesAssignment', 'RulesAssignmentEngine', baseName)?.({
        severity: 'info',
        code: 'csv.metadataLine.skipped',
        message: `Skipped leading metadata/comment line in ${baseName}.`
      });
    }

    return new Promise((resolve, reject) => {
      const rows: RuleExportCsvRow[] = [];
      let checkedLabelRow = false;

      fs.createReadStream(filePath)
        .pipe(csv(skip ? { skipLines: 1 } : {}))
        .on('data', (row: RuleExportCsvRow) => {
          if (!checkedLabelRow) {
            checkedLabelRow = true;
            const values = Object.values(row);
            const firstVal = `${values[0] || ''}`;

            const hasCodeLikeValue = values.some(value => {
              const text = `${value || ''}`.trim();
              return /^[0-9a-f]{8}-[0-9a-f]{4}/.test(text) || /^[A-Z0-9][A-Z0-9_.-]{1,39}$/i.test(text);
            });

            if (
              !hasCodeLikeValue &&
              /^[A-Z][a-z]/.test(firstVal) &&
              firstVal.includes(' ') &&
              firstVal.length > 30
            ) {
              return;
            }
          }
          rows.push(row);
        })
        .on('end', () => resolve(rows))
        .on('error', reject);
    });
  }

  /**
   * @deprecated Internal heuristic moved to `isLeadingMetadataLine` in `src/engines/utils.ts`.
   * Kept here as a thin re-export so any external caller that still pokes at the engine keeps working.
   */
  isMetadataLine(line: string): boolean {
    return isLeadingMetadataLine(line);
  }

  private rebuildBaseObjectLookupIndexes(): void {
    this.idLowerToCanonical.clear();
    this.labelLowerToId.clear();
    for (const node of this.graph.nodes.values()) {
      const idLower = node.id.toLowerCase();
      if (!this.idLowerToCanonical.has(idLower)) this.idLowerToCanonical.set(idLower, node.id);
      const labelLower = `${node.label || ''}`.trim().toLowerCase();
      if (labelLower && !this.labelLowerToId.has(labelLower)) this.labelLowerToId.set(labelLower, node.id);
    }
  }

  private resolveBaseObject(alias: string): { id: string; strategy: string } | null {
    const cleanAlias = `${alias || ''}`.trim();
    if (!cleanAlias) return null;

    const overrideTarget = this.baseObjectOverrides[cleanAlias];
    if (overrideTarget && this.graph.nodes.has(overrideTarget)) {
      return { id: overrideTarget, strategy: 'override' };
    }

    const exactId = this.graph.nodes.has(cleanAlias) ? cleanAlias : null;
    if (exactId) return { id: exactId, strategy: 'exact-id' };

    const caseInsensitiveId = this.idLowerToCanonical.get(cleanAlias.toLowerCase()) ?? null;
    if (caseInsensitiveId) return { id: caseInsensitiveId, strategy: 'case-insensitive-id' };

    const exactLabel = this.labelLowerToId.get(cleanAlias.toLowerCase()) ?? null;
    if (exactLabel) return { id: exactLabel, strategy: 'exact-label' };

    const strippedAlias = cleanAlias.replace(/(Model|Bean)$/i, '');
    if (strippedAlias && strippedAlias !== cleanAlias) {
      if (this.graph.nodes.has(strippedAlias)) {
        return { id: strippedAlias, strategy: 'stripped-suffix-id' };
      }
      const strippedInsensitive = this.idLowerToCanonical.get(strippedAlias.toLowerCase()) ?? null;
      if (strippedInsensitive) {
        return { id: strippedInsensitive, strategy: 'stripped-suffix-case-insensitive-id' };
      }
      const strippedLabel = this.labelLowerToId.get(strippedAlias.toLowerCase()) ?? null;
      if (strippedLabel) {
        return { id: strippedLabel, strategy: 'stripped-suffix-label' };
      }
    }

    return null;
  }

  private linkResolvedBaseObject(objectId: string, ruleId: string, baseObjectAlias: string, strategy: string): void {
    const key = compositeKey(objectId, ruleId);
    if (this.ruleLinkIndex.has(key)) return;
    this.ruleLinkIndex.add(key);

    this.graph.addEdge(objectId, ruleId, 'MODIFIES', compact({
      context: 'Base Object',
      baseObjectAlias,
      resolvedBy: strategy
    }));
  }

  private recordUnresolvedBaseObject(ruleId: string, label: string, baseObjectAlias: string): void {
    const diagnostics = this.graph.meta.diagnostics?.unresolvedRuleBaseObjects;
    if (!Array.isArray(diagnostics)) return;

    const alreadyTracked = diagnostics.some(entry => entry.ruleId === ruleId && entry.baseObjectAlias === baseObjectAlias);
    if (!alreadyTracked) diagnostics.push({ ruleId, label, baseObjectAlias });
  }
}
