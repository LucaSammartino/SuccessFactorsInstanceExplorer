import fs from 'fs-extra';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { SFGraph } from '../core/GraphSchema.js';
import type { EngineOptions, ODataEntityNode } from '../types.js';
import type { IngestLogBuilder } from '../ingest/IngestLog.js';
import { compact, existsAsync, isEngineOptionUnset, makeEngineIssueReporter, resolveEngineDataPath } from './utils.js';

/**
 * OData Ingestion Engine
 *
 * Parses SuccessFactors OData metadata (EDMX) and maps it to MDF objects.
 */
const DEFAULT_ODATA_PATH = 'sample-data/SSFFRealinstancefiles/DataModels/ExampleSSFF-Metadata.xml';
const COUNTRY_SUFFIXES = new Set([
  'arg', 'aus', 'bra', 'can', 'chl', 'chn', 'deu', 'esp', 'fra', 'gbr',
  'ind', 'ita', 'jpn', 'kor', 'mex', 'mwi', 'nld', 'nzl', 'phl', 'sgp',
  'svn', 'tur', 'uk', 'usa', 'zaf'
]);

type ODataSet = Record<string, unknown>;

type MatchCandidate = NonNullable<ODataEntityNode['matchCandidates']>[number];

type ODataMatch = {
  id: string;
  strategy: string;
  confidence: number;
  ambiguous: boolean;
  candidates: MatchCandidate[];
};

type MdfIndex = {
  exactId: Map<string, string>;
  lowerId: Map<string, string[]>;
  lowerAlias: Map<string, string[]>;
  lowerLabel: Map<string, string[]>;
  normalized: Map<string, string[]>;
  nodes: Array<{ id: string; normalizedKeys: string[] }>;
};

export class ODataEngine {
  graph: SFGraph;
  filePath: string;
  _usingDefault: boolean;
  ingestLog?: IngestLogBuilder;

  constructor(graph: SFGraph, options: EngineOptions = {}) {
    this.graph = graph;
    this.filePath = resolveEngineDataPath(options.odataXml, DEFAULT_ODATA_PATH);
    this._usingDefault = isEngineOptionUnset(options.odataXml);
    this.ingestLog = options.ingestLog;
  }

  /** Mutates the shared graph with OData entity nodes and exposure links to matching MDF objects. */
  async run(): Promise<void> {
    console.log('[OData Engine] Starting ingestion...');
    if (!(await existsAsync(this.filePath))) {
      if (this._usingDefault) console.log('[OData Engine] skipping - no path configured');
      else {
        console.error(`[OData Engine] File not found: ${this.filePath}`);
        makeEngineIssueReporter(this.ingestLog, 'odata', 'ODataEngine')?.({
          severity: 'warn',
          code: 'odata.xml.missing',
          message: `OData metadata XML not found at ${this.filePath}.`
        });
      }
      return;
    }
    const baseName = path.basename(this.filePath);

    const xmlData = await fs.readFile(this.filePath, 'utf-8');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      // Defense in depth: legitimate OData EDMX never declares entities.
      // Disable entity/DOCTYPE processing so a malicious export cannot trigger
      // XXE or billion-laughs entity expansion.
      processEntities: false
    });

    let jsonObj: Record<string, any>;
    try {
      jsonObj = parser.parse(xmlData) as Record<string, any>;
    } catch (err) {
      const message = (err as Error).message;
      console.error(`[OData Engine] XML parse failed for ${baseName}: ${message}`);
      makeEngineIssueReporter(this.ingestLog, 'odata', 'ODataEngine', baseName)?.({
        severity: 'error',
        code: 'odata.xml.parseFailed',
        message: `Failed to parse ${baseName}: ${message}`,
        hint: 'Confirm the OData metadata file downloaded fully — open it in a browser and check the document is well-formed XML.'
      });
      return;
    }

    const dataServices = jsonObj['edmx:Edmx']?.['edmx:DataServices'];
    const schema = Array.isArray(dataServices?.Schema) ? dataServices.Schema[0] : dataServices?.Schema;
    const entitySets = schema?.EntityContainer?.EntitySet;

    if (!entitySets) {
      console.log('[OData Engine] No EntitySets found.');
      makeEngineIssueReporter(this.ingestLog, 'odata', 'ODataEngine', baseName)?.({
        severity: 'warn',
        code: 'odata.entitySets.missing',
        message: `No <EntitySet> entries found inside <EntityContainer> in ${baseName}.`,
        hint: 'This typically means the OData metadata download was truncated. Re-export from the SuccessFactors OData API Metadata Refresh page.'
      });
      return;
    }

    const sets = Array.isArray(entitySets) ? entitySets : [entitySets];
    const mdfIndex = this.buildMdfIndex();
    const strategyCounts: Record<string, number> = {};
    const unmatchedEntitySets: Array<{ entitySet: string; label: string; sampleDoc: string }> = [];
    const ambiguousMatches: Array<{ entitySet: string; selected: string; confidence: number; candidates: MatchCandidate[] }> = [];
    let matchedCount = 0;

    sets.forEach((set: ODataSet) => {
      const setName = `${set.Name || ''}`.trim();
      if (!setName) return;

      const odataNodeId = `ODATA::${setName}`;
      const label = `${set['sap:label'] || set.label || setName}`;
      const documentationText = this.extractDocumentationText(set);
      const match = this.matchToMdfObject(setName, label, documentationText, mdfIndex);

      if (match?.id) {
        matchedCount += 1;
        strategyCounts[match.strategy] = (strategyCounts[match.strategy] || 0) + 1;
        if (match.ambiguous) {
          ambiguousMatches.push({
            entitySet: setName,
            selected: match.id,
            confidence: match.confidence,
            candidates: match.candidates
          });
        }
      } else {
        unmatchedEntitySets.push({
          entitySet: setName,
          label,
          sampleDoc: documentationText ? documentationText.slice(0, 120) : ''
        });
      }

      this.graph.addNode(odataNodeId, 'ODATA_ENTITY', compact({
        label,
        creatable: set['sap:creatable'] as string | boolean | undefined,
        updatable: set['sap:updatable'] as string | boolean | undefined,
        deletable: set['sap:deletable'] as string | boolean | undefined,
        upsertable: set['sap:upsertable'] as string | boolean | undefined,
        tags: this.extractTags(set),
        odataSetName: setName,
        matchedMdfObjectId: match?.id,
        matchStrategy: match?.strategy,
        matchConfidence: match?.confidence,
        matchCandidates: match?.candidates
      }));

      if (match?.id) {
        this.graph.addEdge(odataNodeId, match.id, 'EXPOSES', compact({
          exposureSource: match.strategy,
          matchConfidence: match.confidence
        }));
      }
    });

    this.graph.addEngineDiagnostic('odata', {
      entitySetCount: sets.length,
      matchedCount,
      unmatchedCount: unmatchedEntitySets.length,
      ambiguousCount: ambiguousMatches.length,
      strategyCounts,
      unmatchedEntitySets: unmatchedEntitySets.slice(0, 50),
      ambiguousMatches: ambiguousMatches.slice(0, 50)
    });

    console.log('[OData Engine] Ingestion complete.');
  }

  extractTags(set: ODataSet): string[] {
    const documentation = set.Documentation as Record<string, any> | undefined;
    const tagCollection = documentation?.['sap:tagcollection']?.['sap:tag'];
    if (!tagCollection) return [];
    return Array.isArray(tagCollection) ? tagCollection.map(String) : [String(tagCollection)];
  }

  extractDocumentationText(set: ODataSet): string {
    const documentation = set.Documentation as Record<string, unknown> | undefined;
    const raw = [
      documentation?.Summary,
      documentation?.summary,
      documentation?.LongDescription,
      documentation?.longDescription,
      documentation?.['#text']
    ].filter(Boolean).join(' ');
    return `${raw || ''}`.replace(/\s+/g, ' ').trim();
  }

  buildMdfIndex(): MdfIndex {
    const index: MdfIndex = {
      exactId: new Map(),
      lowerId: new Map(),
      lowerAlias: new Map(),
      lowerLabel: new Map(),
      normalized: new Map(),
      nodes: []
    };

    for (const node of this.graph.nodes.values()) {
      if (node.type !== 'MDF_OBJECT') continue;
      const id = `${node.id || ''}`.trim();
      if (!id) continue;

      const label = `${node.label || ''}`.trim();
      const aliases = Array.isArray(node.dataModelAliases) ? node.dataModelAliases : [];
      const normalizedKeys = new Set<string>();

      index.exactId.set(id, id);
      this.pushIndex(index.lowerId, id.toLowerCase(), id);
      this.pushNormalizedVariants(normalizedKeys, id);

      if (label) {
        this.pushIndex(index.lowerLabel, label.toLowerCase(), id);
        this.pushNormalizedVariants(normalizedKeys, label);
      }

      for (const alias of aliases) {
        const cleanAlias = `${alias || ''}`.trim();
        if (!cleanAlias) continue;
        this.pushIndex(index.lowerAlias, cleanAlias.toLowerCase(), id);
        this.pushNormalizedVariants(normalizedKeys, cleanAlias);
      }

      for (const key of normalizedKeys) {
        this.pushIndex(index.normalized, key, id);
      }

      index.nodes.push({ id, normalizedKeys: Array.from(normalizedKeys) });
    }

    return index;
  }

  pushIndex(map: Map<string, string[]>, key: string, value: string): void {
    if (!key) return;
    const arr = map.get(key);
    if (!arr) {
      map.set(key, [value]);
      return;
    }
    if (!arr.includes(value)) arr.push(value);
  }

  pushNormalizedVariants(targetSet: Set<string>, raw: string): void {
    for (const variant of this.getNameVariants(raw)) {
      const normalized = this.normalizeForMatch(variant);
      if (normalized) targetSet.add(normalized);
    }
  }

  getNameVariants(rawValue: string): string[] {
    const value = `${rawValue || ''}`.trim();
    if (!value) return [];

    const variants = new Set<string>([value]);
    variants.add(value.replace(/(Nav|ByKey)$/i, ''));
    variants.add(value.replace(/V\d+$/i, ''));
    variants.add(value.replace(/V\d+[A-Za-z]{2,3}$/i, ''));
    variants.add(value.replace(/[_-][A-Za-z]{2,3}$/i, ''));

    const lower = value.toLowerCase();
    for (const suffix of COUNTRY_SUFFIXES) {
      if (lower.endsWith(suffix) && value.length > suffix.length + 4) {
        variants.add(value.slice(0, value.length - suffix.length));
      }
    }

    return Array.from(variants)
      .map(v => `${v || ''}`.trim())
      .filter(Boolean);
  }

  normalizeForMatch(rawValue: string): string {
    const value = `${rawValue || ''}`.trim().toLowerCase();
    if (!value) return '';
    return value
      .replace(/(nav|bykey)$/g, '')
      .replace(/v\d+[a-z]{0,3}$/g, '')
      .replace(/[_\-\s]+[a-z]{2,3}$/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  addCandidates(
    candidateMap: Map<string, { id: string; score: number; strategy: string }>,
    ids: string[] | undefined,
    score: number,
    strategy: string
  ): void {
    if (!ids?.length) return;
    const uniqueIds = ids.length === 1 ? ids : Array.from(new Set(ids));
    for (const id of uniqueIds) {
      const existing = candidateMap.get(id);
      if (!existing || score > existing.score) {
        candidateMap.set(id, { id, score, strategy });
      }
    }
  }

  private maxCandidateScore(candidates: Map<string, { id: string; score: number; strategy: string }>): number {
    let m = 0;
    for (const c of candidates.values()) {
      if (c.score > m) m = c.score;
    }
    return m;
  }

  matchToMdfObject(setName: string, label: string, documentationText: string, mdfIndex: MdfIndex): ODataMatch | null {
    const candidates = new Map<string, { id: string; score: number; strategy: string }>();
    const rawSetName = `${setName || ''}`.trim();
    const lowerSetName = rawSetName.toLowerCase();

    this.addCandidates(candidates, mdfIndex.exactId.has(rawSetName) ? [rawSetName] : [], 1.0, 'exact-id');
    this.addCandidates(candidates, mdfIndex.lowerId.get(lowerSetName), 0.98, 'case-insensitive-id');
    this.addCandidates(candidates, mdfIndex.lowerAlias.get(lowerSetName), 0.95, 'data-model-alias');
    this.addCandidates(candidates, mdfIndex.lowerLabel.get(`${label || ''}`.trim().toLowerCase()), 0.92, 'exact-label');

    for (const variant of this.getNameVariants(rawSetName)) {
      const normalized = this.normalizeForMatch(variant);
      if (!normalized) continue;
      this.addCandidates(candidates, mdfIndex.normalized.get(normalized), 0.88, 'normalized-name');
    }

    for (const variant of this.getNameVariants(label)) {
      const normalized = this.normalizeForMatch(variant);
      if (!normalized) continue;
      this.addCandidates(candidates, mdfIndex.normalized.get(normalized), 0.84, 'normalized-label');
    }

    // Best possible documentation / name-overlap scores are 0.72 / 0.66 — cannot beat 0.84+ cheap matches.
    const HIGH_CONFIDENCE = 0.84;
    if (this.maxCandidateScore(candidates) < HIGH_CONFIDENCE) {
      const docText = `${documentationText || ''}`.trim();
      const docNormalized = this.normalizeForMatch(docText);
      if (docNormalized) {
        for (const node of mdfIndex.nodes) {
          if (node.normalizedKeys.some(key => key.length >= 6 && docNormalized.includes(key))) {
            this.addCandidates(candidates, [node.id], 0.72, 'documentation-match');
          }
        }
      }

      const normalizedSetName = this.normalizeForMatch(rawSetName);
      if (normalizedSetName.length >= 5) {
        for (const node of mdfIndex.nodes) {
          if (node.normalizedKeys.some(key => key.length >= 5 && (key.includes(normalizedSetName) || normalizedSetName.includes(key)))) {
            this.addCandidates(candidates, [node.id], 0.66, 'name-overlap');
          }
        }
      }
    }

    if (candidates.size === 0) return null;

    const ranked = Array.from(candidates.values())
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.id.localeCompare(right.id);
      });

    const top = ranked[0];
    const ambiguous = ranked.length > 1 && Math.abs(ranked[0].score - ranked[1].score) <= 0.02;
    return {
      id: top.id,
      strategy: top.strategy,
      confidence: Number(top.score.toFixed(2)),
      ambiguous,
      candidates: ranked.slice(0, 5).map(entry => ({
        id: entry.id,
        score: Number(entry.score.toFixed(2)),
        strategy: entry.strategy
      }))
    };
  }
}
