import fs from 'fs-extra';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { SFGraph } from '../core/GraphSchema.js';
import type { CorporateDataModel, CountryOverride, DataModelField, EngineOptions, MdfObjectNode } from '../types.js';
import type { IngestLogBuilder } from '../ingest/IngestLog.js';
import { compact, makeEngineIssueReporter, resolveEngineDataPath } from './utils.js';

const DEFAULT_PATHS = {
  foundationReference: './SSFFArchitectureResearch/ListofFObjects.md',
  corporateDataModel: './sample-data/SSFFRealinstancefiles/DataModels/CDM-backup-data-model-V1.xml',
  countrySpecificModel: './sample-data/SSFFRealinstancefiles/DataModels/CSF-for-corporate-DM.xml'
};

const LEGACY_SYSTEM_IDS = new Set([
  'corporateAddress',
  'dynamicRole',
  'dynamicRoleAssignment',
  'wfConfig',
  'wfConfigStep',
  'wfStepApprover',
  'eventReason',
  'wfConfigContributor',
  'wfConfigCC'
]);

type FoundationEntry = {
  objectName: string;
  technicalId: string;
  framework: string;
  description: string;
  section: string;
  moduleTag: string;
};

type CorporateObject = {
  rawId: string;
  canonicalId: string;
  label: string;
  description: string;
  framework: string;
  section: string;
  moduleTag: string;
  fields: DataModelField[];
  fieldCount: number;
};

type CountryOverrideEntry = {
  countryCode: string;
  rawId: string;
  canonicalId: string;
  label: string;
  fields: DataModelField[];
  fieldCount: number;
};

type DataModelPaths = {
  foundationReference: string;
  corporateDataModel: string;
  countrySpecificModels: string[];
};

type ClassificationSummary = {
  summary: {
    foundationReferenceCount: number;
    corporateObjectCount: number;
    countryOverrideObjectCount: number;
    countryCount: number;
    byClass: Record<string, number>;
    byTechnology: Record<string, number>;
  };
  sources: {
    foundationReference: string;
    corporateDataModel: string;
    countrySpecificModels: string[];
  };
  countries: Array<{ countryCode: string; overrideCount: number }>;
  ambiguousObjects: Array<{ id: string; label: string }>;
  classificationPrecedence: string[];
};

export class DataModelEngine {
  graph: SFGraph;
  paths: DataModelPaths;
  xmlParser: XMLParser;
  ingestLog?: IngestLogBuilder;

  constructor(graph: SFGraph, options: EngineOptions = {}) {
    this.graph = graph;
    this.paths = {
      foundationReference: resolveEngineDataPath(
        options.foundationReference,
        DEFAULT_PATHS.foundationReference
      ),
      corporateDataModel: resolveEngineDataPath(
        options.corporateDataModel,
        DEFAULT_PATHS.corporateDataModel
      ),
      countrySpecificModels:
        options.countrySpecificModels !== undefined
          ? options.countrySpecificModels
          : [DEFAULT_PATHS.countrySpecificModel]
    };
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      // Defense in depth: legitimate SF data-model XML never declares entities.
      // Disable entity/DOCTYPE processing so a malicious export cannot trigger
      // XXE or billion-laughs entity expansion.
      processEntities: false
    });
    this.ingestLog = options.ingestLog;
  }

  /**
   * Parse XML content with structured error logging. Returns null on failure
   * so the engine can continue processing other models without aborting.
   */
  private safeParseXml(xml: string, filePath: string): Record<string, any> | null {
    try {
      return this.xmlParser.parse(xml) as Record<string, any>;
    } catch (err) {
      const baseName = path.basename(filePath);
      const message = (err as Error).message;
      console.warn(`[DataModelEngine] XML parse failed for ${baseName}: ${message}`);
      makeEngineIssueReporter(this.ingestLog, 'dataModel', 'DataModelEngine', baseName)?.({
        severity: 'error',
        code: 'xml.parse.failed',
        message: `Failed to parse ${baseName}: ${message}`,
        hint: 'Confirm the file is well-formed XML — try opening it in a text editor or browser to spot the truncation point.'
      });
      return null;
    }
  }

  /** Mutates the shared graph with data-model object metadata and provenance discovered from workbook/markdown inputs. */
  async run(): Promise<void> {
    const foundationEntries = await this.parseFoundationReference();
    const foundationByLowerId = new Map(foundationEntries.map(entry => [entry.technicalId.toLowerCase(), entry]));

    const corporateObjects = await this.parseCorporateDataModel(foundationByLowerId);
    const countryOverrides = await this.parseCountrySpecificModel(foundationByLowerId);

    this.applyFoundationReferenceEntries(foundationEntries);
    this.applyCorporateObjects(corporateObjects);
    this.applyCountryOverrides(countryOverrides);
    this.finalizeObjectTaxonomy(foundationByLowerId, corporateObjects, countryOverrides);

    this.graph.meta.dataModels = this.buildSummary(foundationEntries, corporateObjects, countryOverrides) as unknown as Record<string, unknown>;
  }

  async parseFoundationReference(): Promise<FoundationEntry[]> {
    if (!this.paths.foundationReference) return [];
    const resolved = path.resolve(this.paths.foundationReference);
    if (!(await fs.pathExists(resolved))) return [];

    const markdown = await fs.readFile(resolved, 'utf8');
    const lines = markdown.split(/\r?\n/);
    const entries: FoundationEntry[] = [];
    let currentSection = 'Uncategorized';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('## ')) {
        currentSection = trimmed.replace(/^##\s+/, '').replace(/^\d+\.\s+/, '').trim();
        continue;
      }

      if (!trimmed.startsWith('|') || trimmed.includes(':---')) continue;
      const parts = trimmed.split('|').map((part: string) => part.trim());
      if (parts.length < 5) continue;

      const objectName = parts[1].replace(/\*\*/g, '');
      const technicalId = parts[2].replace(/`/g, '');
      const framework = parts[3];
      const description = parts[4];
      if (!technicalId || technicalId === 'Technical ID') continue;

      entries.push({
        objectName,
        technicalId,
        framework,
        description,
        section: currentSection,
        moduleTag: inferModuleTag(currentSection)
      });
    }

    return entries;
  }

  async parseCorporateDataModel(foundationByLowerId: Map<string, FoundationEntry>): Promise<CorporateObject[]> {
    if (!this.paths.corporateDataModel) return [];
    const resolved = path.resolve(this.paths.corporateDataModel);
    if (!(await fs.pathExists(resolved))) return [];

    const xml = await fs.readFile(resolved, 'utf8');
    const doc = this.safeParseXml(xml, resolved);
    if (!doc) return [];
    if (!doc['corporate-data-model']) {
      const baseName = path.basename(resolved);
      makeEngineIssueReporter(this.ingestLog, 'dataModel', 'DataModelEngine', baseName)?.({
        severity: 'warn',
        code: 'xml.unexpectedRoot',
        message: `Expected <corporate-data-model> root in ${baseName} but didn't find it.`,
        hint: 'This file may be a country-specific (CSF) export rather than the corporate (CDM) one. Check the filename + the file content.'
      });
    }
    const elements = toArray(doc?.['corporate-data-model']?.['hris-element']);

    return elements.map((element) => {
      const rawId = `${element?.['@_id'] || ''}`.trim();
      if (!rawId) return null;

      const reference = foundationByLowerId.get(rawId.toLowerCase());
      const canonicalId = reference?.technicalId || rawId;
      const label = pickDefaultLabel(element.label) || reference?.objectName || canonicalId;
      const fields = toArray(element['hris-field']).map(field => parseDataModelField(field));
      const section = reference?.section || inferSectionForCorporateId(rawId);

      return {
        rawId,
        canonicalId,
        label,
        description: pickDefaultText(element.description ?? element['@_description']),
        framework: reference?.framework || inferFrameworkForCorporateId(rawId),
        section,
        moduleTag: reference?.moduleTag || inferModuleTag(section),
        fields,
        fieldCount: fields.length
      };
    }).filter(Boolean) as CorporateObject[];
  }

  async parseCountrySpecificModel(foundationByLowerId: Map<string, FoundationEntry>): Promise<CountryOverrideEntry[]> {
    const overrides: CountryOverrideEntry[] = [];

    for (const modelPath of this.paths.countrySpecificModels) {
      const resolved = path.resolve(modelPath);
      if (!(await fs.pathExists(resolved))) continue;

      const xml = await fs.readFile(resolved, 'utf8');
      const doc = this.safeParseXml(xml, resolved);
      if (!doc) continue;
      if (!doc['country-specific-fields'] && !doc['country-region-data-model']) {
        const baseName = path.basename(resolved);
        makeEngineIssueReporter(this.ingestLog, 'dataModel', 'DataModelEngine', baseName)?.({
          severity: 'warn',
          code: 'xml.unexpectedRoot',
          message: `Expected <country-specific-fields> or <country-region-data-model> root in ${baseName} but didn't find it.`,
          hint: 'Confirm this is the country/region-specific (CSF) export, not a corporate-data-model file.'
        });
      }
      const countries = toArray(doc?.['country-specific-fields']?.country);

      for (const country of countries) {
        const countryCode = `${country?.['@_id'] || ''}`.trim();
        if (!countryCode) continue;

        for (const element of toArray(country['hris-element'])) {
          const rawId = `${element?.['@_id'] || ''}`.trim();
          if (!rawId) continue;

          const reference = foundationByLowerId.get(rawId.toLowerCase());
          const canonicalId = reference?.technicalId || rawId;
          const fields = toArray(element['hris-field']).map(field => parseDataModelField(field));
          overrides.push({
            countryCode,
            rawId,
            canonicalId,
            label: pickDefaultLabel(element.label) || reference?.objectName || canonicalId,
            fields,
            fieldCount: fields.length
          });
        }
      }
    }

    return overrides;
  }

  applyFoundationReferenceEntries(entries: FoundationEntry[]): void {
    for (const entry of entries) {
      const existing = this.graph.nodes.get(entry.technicalId);
      const existingObject = existing?.type === 'MDF_OBJECT' ? existing : null;
      const label = existingObject?.label && existingObject.label !== existingObject.id ? existingObject.label : entry.objectName;

      this.upsertObjectNode(entry.technicalId, {
        label,
        description: existingObject?.description || entry.description,
        objectClass: 'FOUNDATION',
        objectTechnology: normalizeFramework(entry.framework),
        objectClassSource: 'foundation-reference',
        foundationFramework: entry.framework,
        foundationGroup: entry.section,
        dataModelSources: uniqueArray([...(existingObject?.dataModelSources || []), 'ListofFObjects.md']),
        tags: uniqueArray([...(existingObject?.tags || []), entry.moduleTag]),
        searchKeywords: uniqueArray([...(existingObject?.searchKeywords || []), entry.objectName, entry.technicalId, entry.section, entry.framework])
      });
    }
  }

  applyCorporateObjects(objects: CorporateObject[]): void {
    const corporateSourceFile = path.basename(this.paths.corporateDataModel);
    for (const object of objects) {
      const existing = this.graph.nodes.get(object.canonicalId);
      const existingObject = existing?.type === 'MDF_OBJECT' ? existing : null;
      const label = existingObject?.label && existingObject.label !== existingObject.id ? existingObject.label : object.label;

      this.upsertObjectNode(object.canonicalId, {
        label,
        description: existingObject?.description || object.description,
        objectClass: 'FOUNDATION',
        objectTechnology: normalizeFramework(object.framework),
        objectClassSource: 'corporate-data-model',
        foundationGroup: object.section,
        tags: uniqueArray([...(existingObject?.tags || []), object.moduleTag]),
        dataModelAliases: uniqueArray([...(existingObject?.dataModelAliases || []), object.rawId]),
        dataModelSources: uniqueArray([...(existingObject?.dataModelSources || []), 'Corporate Data Model']),
        corporateDataModel: {
          sourceId: object.rawId,
          sourceFile: corporateSourceFile,
          fieldCount: object.fieldCount,
          fields: object.fields
        } satisfies CorporateDataModel,
        searchKeywords: uniqueArray([...(existingObject?.searchKeywords || []), object.rawId, object.label, object.section, object.framework])
      });
    }
  }

  applyCountryOverrides(overrides: CountryOverrideEntry[]): void {
    const grouped = new Map<string, CountryOverride[]>();

    for (const override of overrides) {
      if (!grouped.has(override.canonicalId)) grouped.set(override.canonicalId, []);
      grouped.get(override.canonicalId)!.push({
        countryCode: override.countryCode,
        sourceId: override.rawId,
        fieldCount: override.fieldCount,
        fields: override.fields
      });
    }

    grouped.forEach((countryEntries, canonicalId) => {
      const existing = this.graph.nodes.get(canonicalId);
      const existingObject = existing?.type === 'MDF_OBJECT' ? existing : null;
      this.upsertObjectNode(canonicalId, {
        label: existingObject?.label || canonicalId,
        countryOverrides: countryEntries.sort((left, right) => left.countryCode.localeCompare(right.countryCode)),
        dataModelSources: uniqueArray([...(existingObject?.dataModelSources || []), 'Country Specific Corporate Data Model']),
        searchKeywords: uniqueArray([...(existingObject?.searchKeywords || []), ...countryEntries.map(entry => entry.countryCode)])
      });
    });
  }

  finalizeObjectTaxonomy(
    foundationByLowerId: Map<string, FoundationEntry>,
    corporateObjects: CorporateObject[],
    countryOverrides: CountryOverrideEntry[]
  ): void {
    const corporateIdSet = new Set(corporateObjects.map(object => object.canonicalId.toLowerCase()));
    const countryOverrideIdSet = new Set(countryOverrides.map(override => override.canonicalId.toLowerCase()));

    for (const node of this.graph.nodes.values()) {
      if (node.type !== 'MDF_OBJECT') continue;

      const normalizedId = node.id.toLowerCase();
      const foundationRef = foundationByLowerId.get(normalizedId);
      const isFoundation = Boolean(
        node.objectClass === 'FOUNDATION' ||
        foundationRef ||
        corporateIdSet.has(normalizedId) ||
        countryOverrideIdSet.has(normalizedId)
      );

      if (isFoundation) {
        node.objectClass = 'FOUNDATION';
        node.objectTechnology = node.objectTechnology || normalizeFramework(foundationRef?.framework || inferFrameworkForCorporateId(node.id));
        node.objectClassSource = node.objectClassSource || (foundationRef ? 'foundation-reference' : 'corporate-data-model');
      } else if (isGenericObject(node)) {
        node.objectClass = 'GENERIC';
        node.objectTechnology = node.objectTechnology || 'MDF';
        node.objectClassSource = node.objectClassSource || 'generic-heuristic';
      } else {
        node.objectClass = node.objectClass || 'MDF';
        node.objectTechnology = node.objectTechnology || 'MDF';
        node.objectClassSource = node.objectClassSource || 'mdf-default';
      }
    }
  }

  buildSummary(
    foundationEntries: FoundationEntry[],
    corporateObjects: CorporateObject[],
    countryOverrides: CountryOverrideEntry[]
  ): ClassificationSummary {
    const objectNodes = Array.from(this.graph.nodes.values()).filter((node): node is MdfObjectNode => node.type === 'MDF_OBJECT');
    const byClass = countBy(objectNodes, node => node.objectClass || 'MDF');
    const byTechnology = countBy(objectNodes, node => node.objectTechnology || 'MDF');
    const byCountry = countBy(countryOverrides, item => item.countryCode);
    const foundationTechnicalIds = new Set(foundationEntries.map(e => e.technicalId));

    return {
      summary: {
        foundationReferenceCount: foundationEntries.length,
        corporateObjectCount: corporateObjects.length,
        countryOverrideObjectCount: new Set(countryOverrides.map(item => item.canonicalId)).size,
        countryCount: new Set(countryOverrides.map(item => item.countryCode)).size,
        byClass,
        byTechnology
      },
      sources: {
        foundationReference: path.basename(this.paths.foundationReference),
        corporateDataModel: path.basename(this.paths.corporateDataModel),
        countrySpecificModels: this.paths.countrySpecificModels.map(p => path.basename(p))
      },
      countries: Object.entries(byCountry)
        .map(([countryCode, overrideCount]) => ({ countryCode, overrideCount }))
        .sort((left, right) => right.overrideCount - left.overrideCount)
        .slice(0, 25),
      ambiguousObjects: objectNodes
        .filter(
          node =>
            node.objectClass === 'FOUNDATION' &&
            !(node.corporateDataModel || node.countryOverrides?.length || foundationTechnicalIds.has(node.id))
        )
        .map(node => ({ id: node.id, label: node.label || node.id }))
        .slice(0, 25),
      classificationPrecedence: [
        'ListofFObjects.md',
        'Corporate Data Model XML',
        'Country Specific Corporate Data Model XML',
        'Generic-object heuristic',
        'MDF default'
      ]
    };
  }

  upsertObjectNode(id: string, metadata: Partial<MdfObjectNode>): void {
    const existing = this.graph.nodes.get(id);
    const existingObject = existing?.type === 'MDF_OBJECT' ? existing : null;
    const merged: Partial<MdfObjectNode> & { id: string; label: string } = {
      ...(existingObject || {}),
      ...metadata,
      id,
      label: selectPreferredLabel(existingObject?.label, id, metadata.label),
      tags: uniqueArray([...(existingObject?.tags || []), ...(metadata.tags || [])]),
      dataModelAliases: uniqueArray([...(existingObject?.dataModelAliases || []), ...(metadata.dataModelAliases || [])]),
      dataModelSources: uniqueArray([...(existingObject?.dataModelSources || []), ...(metadata.dataModelSources || [])]),
      searchKeywords: uniqueArray([...(existingObject?.searchKeywords || []), ...(metadata.searchKeywords || [])])
    };

    if (metadata.countryOverrides) {
      merged.countryOverrides = mergeCountryOverrides(existingObject?.countryOverrides || [], metadata.countryOverrides);
    }

    if (metadata.corporateDataModel) {
      merged.corporateDataModel = metadata.corporateDataModel;
    }

    this.graph.addNode(id, existing?.type || 'MDF_OBJECT', merged);
  }
}

function parseDataModelField(field: Record<string, any>): DataModelField {
  return compact({
    id: `${field?.['@_id'] || ''}`.trim(),
    label: pickDefaultLabel(field?.label),
    visibility: field?.['@_visibility'],
    required: field?.['@_required'] === 'true' || field?.['@_required'] === true,
    maxLength: field?.['@_max-length'],
    type: field?.['@_type'] || field?.['@_data-type']
  }) as DataModelField;
}

function pickDefaultLabel(labelNode: unknown): string {
  const labels = toArray(labelNode);
  const preferred = labels.find(label => typeof label === 'string' || !(label as Record<string, unknown>)?.['@_xml:lang']);
  return pickDefaultText(preferred || labels[0]);
}

function pickDefaultText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') return `${(value as Record<string, unknown>)['#text'] || ''}`.trim();
  return `${value}`.trim();
}

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function normalizeFramework(framework: string | undefined): 'LEGACY' | 'MDF' {
  return `${framework || ''}`.trim().toUpperCase() === 'LEGACY' ? 'LEGACY' : 'MDF';
}

function inferModuleTag(section: string | undefined): string {
  return /system|workflow/i.test(`${section || ''}`)
    ? 'Foundation/Platform'
    : 'Employee Central (EC)';
}

function inferFrameworkForCorporateId(rawId: string): string {
  return LEGACY_SYSTEM_IDS.has(rawId) || ['locationGroup', 'geozone', 'location', 'payRange', 'payGrade', 'payComponent', 'payComponentGroup', 'frequency'].includes(rawId)
    ? 'Legacy'
    : 'MDF';
}

function inferSectionForCorporateId(rawId: string): string {
  if (['locationGroup', 'geozone', 'location', 'corporateAddress'].includes(rawId)) return 'Organizational Objects';
  if (['payRange', 'payGrade', 'payComponent', 'payComponentGroup', 'frequency'].includes(rawId)) return 'Pay & Compensation Objects';
  if (LEGACY_SYSTEM_IDS.has(rawId)) return 'System & Workflow Objects';
  return 'Foundation Objects';
}

function isGenericObject(node: MdfObjectNode): boolean {
  const id = `${node.id || ''}`;
  const label = `${node.label || ''}`;
  const category = `${node.category || ''}`;
  return (
    /^cust_/i.test(id) ||
    /^go\d/i.test(id) || /^goCustomObject/i.test(id) ||
    /generic object/i.test(label) ||
    ['META_OR_CONFIG', 'TECHNICAL_DATA'].includes(category)
  );
}

function selectPreferredLabel(existingLabel: string | undefined, id: string, incomingLabel: string | undefined): string {
  if (existingLabel && existingLabel !== id) return existingLabel;
  return incomingLabel || existingLabel || id;
}

function uniqueArray(values: Array<string | undefined> | undefined): string[] {
  return Array.from(new Set((values || []).filter(Boolean) as string[]));
}

function countBy<T>(items: T[], keySelector: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  items.forEach(item => {
    const key = keySelector(item);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function mergeCountryOverrides(existing: CountryOverride[], incoming: CountryOverride[]): CountryOverride[] {
  const byCountry = new Map<string, CountryOverride>();

  [...existing, ...incoming].forEach(entry => {
    if (!entry?.countryCode) return;
    byCountry.set(entry.countryCode, entry);
  });

  return Array.from(byCountry.values()).sort((left, right) => left.countryCode.localeCompare(right.countryCode));
}
