import path from 'node:path';
import type { SFGraph } from '../core/GraphSchema.js';
import type { EngineOptions, FieldDefinition, RuleBindingType, TriggeredByEdge } from '../types.js';
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

/**
 * MDF Ingestion Engine
 *
 * Parses MDF objects, associations, and object-level rule bindings.
 */
const DEFAULT_MDF_BASE_PATH = 'sample-data/SSFFRealinstancefiles/Object Definitions/';

type MdfCsvRow = Record<string, string>;

type RuleBindingSource = {
  fileName: string;
  column: string;
  bindingType: RuleBindingType;
};

type ObjectFieldData = Pick<FieldDefinition, 'name'> & Partial<FieldDefinition>;

type RuleBindingMetadata = {
  fieldName?: string;
};

export class MdfEngine {
  graph: SFGraph;
  basePath: string;
  _usingDefault: boolean;
  ruleBindingIndex: Map<string, TriggeredByEdge>;
  ingestLog?: IngestLogBuilder;
  /** objectId -> field name -> index in node.attributes (avoids O(n) find per CSV row) */
  private fieldIndexByObject = new Map<string, Map<string, number>>();

  constructor(graph: SFGraph, options: EngineOptions = {}) {
    this.graph = graph;
    this.basePath = resolveEngineDataPath(options.objectDefsDir, DEFAULT_MDF_BASE_PATH);
    this._usingDefault = isEngineOptionUnset(options.objectDefsDir);
    this.ruleBindingIndex = new Map();
    this.ingestLog = options.ingestLog;
  }

  /** Mutates the shared graph with MDF objects, associations, and rule references from object-definition CSVs. */
  async run(): Promise<void> {
    console.log('[MDF Engine] Starting ingestion...');
    if (!(await existsAsync(this.basePath))) {
      if (this._usingDefault) console.log('[MDF Engine] skipping - no path configured');
      else {
        console.error(`[MDF Engine] Directory not found: ${this.basePath}`);
        makeEngineIssueReporter(this.ingestLog, 'objectDefs', 'MdfEngine')?.({
          severity: 'error',
          code: 'mdf.basePath.missing',
          message: `Object Definitions directory not found: ${this.basePath}.`
        });
      }
      return;
    }

    // Verify the required Object Definition.csv is present — emit explicit error otherwise
    // so the consultant immediately sees what's missing in the export log.
    const requiredFiles = ['Object Definition.csv'];
    for (const required of requiredFiles) {
      const fullPath = `${this.basePath}${required}`;
      if (!(await existsAsync(fullPath))) {
        makeEngineIssueReporter(this.ingestLog, 'objectDefs', 'MdfEngine', required)?.({
          severity: 'error',
          code: 'mdf.required.missing',
          message: `Required file ${required} is missing from the Object Definitions zip.`,
          hint: 'Re-export Object Definitions from Admin Center and ensure the standard CSV is included.'
        });
      }
    }

    await this.parseObjectDefinitions();
    await this.parseAssociations();
    await this.parseRuleBindings();

    this.graph.addEngineDiagnostic?.('mdf', {
      parsedObjects: this.graph.nodes.size,
      ruleBindingsIndexed: this.ruleBindingIndex.size
    });
    console.log('[MDF Engine] Ingestion complete.');
  }

  async parseObjectDefinitions(): Promise<void> {
    const filePath = `${this.basePath}Object Definition.csv`;
    if (!(await existsAsync(filePath))) return;
    const baseName = path.basename(filePath);

    await streamCsv<MdfCsvRow>(
      filePath,
      row => {
        const objectId = row.id;
        if (!objectId) return;

        this.graph.addNode(
          objectId,
          'MDF_OBJECT',
          compact({
            label: row['label.defaultValue'] || objectId,
            description: row['description.defaultValue'] || '',
            category: row.objectCategory,
            apiVisibility: row.apiVisibility
          })
        );

        const fieldName = row['fields.name'];
        if (!fieldName) return;

        this.addFieldToObject(
          objectId,
          compact({
            name: fieldName,
            type: row['fields.dataTypeStr'],
            required: row['fields.required'] === 'true',
            visibility: row['fields.visibility'],
            label: row['fields.label.defaultValue']
          }) as ObjectFieldData
        );
      },
      { skipLeadingMetadata: true, onIssue: makeEngineIssueReporter(this.ingestLog, 'objectDefs', 'MdfEngine', baseName) }
    );
  }

  addFieldToObject(objectId: string, fieldData: ObjectFieldData): void {
    const node = this.graph.nodes.get(objectId);
    if (!node || node.type !== 'MDF_OBJECT') return;

    if (!node.attributes) node.attributes = [];

    const fieldName = fieldData.name;
    if (!fieldName) {
      node.attributes.push(fieldData as FieldDefinition);
      return;
    }

    let byName = this.fieldIndexByObject.get(objectId);
    if (!byName) {
      byName = new Map();
      this.fieldIndexByObject.set(objectId, byName);
    }
    const existingIndex = byName.get(fieldName);
    if (existingIndex !== undefined) {
      Object.assign(node.attributes[existingIndex], fieldData);
      return;
    }

    byName.set(fieldName, node.attributes.length);
    node.attributes.push(fieldData as FieldDefinition);
  }

  async parseAssociations(): Promise<void> {
    const filePath = `${this.basePath}Object Definition-Associations.csv`;
    if (!(await existsAsync(filePath))) return;
    const baseName = path.basename(filePath);

    await streamCsv<MdfCsvRow>(
      filePath,
      row => {
        const srcId = row.id;
        const destId = row['associations.destObjectId'];
        if (!srcId || !destId) return;

        this.graph.addEdge(
          srcId,
          destId,
          'ASSOCIATION',
          compact({
            label: row['associations.name'],
            multiplicity: row['associations.multiplicity'],
            associationKind: row['associations.type'],
            sourceFieldId: row['associations.srcObjectFieldId'],
            destinationFieldId: row['associations.destObjectFieldId'],
            visibility: row['associations.visibility']
          })
        );
      },
      { skipLeadingMetadata: true, onIssue: makeEngineIssueReporter(this.ingestLog, 'objectDefs', 'MdfEngine', baseName) }
    );
  }

  async parseRuleBindings(): Promise<void> {
    const sources: RuleBindingSource[] = [
      { fileName: 'Object Rules-Save Rules.csv', column: 'ruleConfig.saveRules.code', bindingType: 'SAVE' },
      { fileName: 'Object Rules-Validate Rules.csv', column: 'ruleConfig.validateRules.code', bindingType: 'VALIDATE' },
      { fileName: 'Object Rules-Initialize Rules.csv', column: 'ruleConfig.initializeRules.code', bindingType: 'INITIALIZE' },
      { fileName: 'Object Rules-Post Save Rules.csv', column: 'ruleConfig.postSaveRules.code', bindingType: 'POST_SAVE' },
      { fileName: 'Object Rules-Insert Rules.csv', column: 'ruleConfig.insertRules.code', bindingType: 'INSERT' },
      { fileName: 'Object Rules-Delete Rules.csv', column: 'ruleConfig.deleteRules.code', bindingType: 'DELETE' }
    ];

    for (const source of sources) {
      const filePath = `${this.basePath}${source.fileName}`;
      if (!(await existsAsync(filePath))) continue;
      const baseName = path.basename(filePath);

      await streamCsv<MdfCsvRow>(
        filePath,
        row => {
          this.addRuleBinding(row.id, row[source.column], source.bindingType);
        },
        { skipLeadingMetadata: true, onIssue: makeEngineIssueReporter(this.ingestLog, 'objectDefs', 'MdfEngine', baseName) }
      );
    }

    const fieldRulesPath = `${this.basePath}Field-Rules.csv`;
    if (!(await existsAsync(fieldRulesPath))) return;
    const fieldRulesBase = path.basename(fieldRulesPath);

    await streamCsv<MdfCsvRow>(
      fieldRulesPath,
      row => {
        this.addRuleBinding(row.id, row['fields.ruleReferences.code.code'], 'FIELD_RULE', {
          fieldName: row['fields.name']
        });
      },
      { skipLeadingMetadata: true, onIssue: makeEngineIssueReporter(this.ingestLog, 'objectDefs', 'MdfEngine', fieldRulesBase) }
    );
  }

  addRuleBinding(
    objectId: string | undefined,
    ruleId: string | undefined,
    bindingType: RuleBindingType,
    metadata: RuleBindingMetadata = {}
  ): void {
    const cleanObjectId = `${objectId || ''}`.trim();
    const cleanRuleId = `${ruleId || ''}`.trim();
    if (!cleanObjectId || !cleanRuleId) return;

    this.graph.addNode(cleanRuleId, 'BUSINESS_RULE', { label: cleanRuleId });

    const key = compositeKey(cleanObjectId, cleanRuleId, bindingType);
    if (this.ruleBindingIndex.has(key)) {
      const edge = this.ruleBindingIndex.get(key)!;
      if (metadata.fieldName) {
        const fieldNames = new Set(edge.fieldNames || []);
        fieldNames.add(metadata.fieldName);
        edge.fieldNames = Array.from(fieldNames).sort();
      }
      return;
    }

    const edge = this.graph.addEdge(cleanObjectId, cleanRuleId, 'TRIGGERED_BY', compact({
      ruleBindingType: bindingType,
      fieldNames: metadata.fieldName ? [metadata.fieldName] : undefined
    }));

    if (edge?.type === 'TRIGGERED_BY') this.ruleBindingIndex.set(key, edge);
  }
}
