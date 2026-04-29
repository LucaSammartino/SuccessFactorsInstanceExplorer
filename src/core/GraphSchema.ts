/**
 * SuccessFactors Architectural Graph Schema
 *
 * Represents the entire SuccessFactors system as a directed graph plus
 * supporting metadata used by the dashboard.
 */

import type {
  NodeType,
  EdgeType,
  SFNode,
  SFEdge,
  NodeMetadata,
  EdgeMetadata,
  GraphMeta,
  RenderableData,
  RoleObjectPermission,
  RoleSystemPermission
} from '../types.js';
import type { IngestLog } from '../ingest/IngestLog.js';

/**
 * Fields that are ARRAYS — when merging nodes the union of both arrays is kept.
 * Note: `secondaryTypes` is handled separately with explicit OData logic.
 */
const ARRAY_MERGE_FIELDS = new Set([
  'tags',
  'attributes',
  'mdfPermissionCategories',
  'systemPermissionCategories',
  'searchKeywords',
  'dataModelAliases',
  'dataModelSources'
]);

/**
 * Fields that are PROTECTED once they hold a non-empty value — subsequent
 * engine passes may not overwrite them.  This prevents e.g. a secondary
 * OData enrichment from blanking out a description set by MdfEngine.
 */
const PROTECT_ONCE_SET_FIELDS = new Set([
  'description',
  'category',
  'objectClass',
  'objectTechnology',
  'foundationFramework',
  'foundationGroup'
]);

export class SFGraph {
  nodes: Map<string, SFNode>;
  edges: SFEdge[];
  _edgeKeys: Set<string>;
  meta: GraphMeta;

  constructor() {
    this.nodes = new Map();
    this.edges = [];
    this._edgeKeys = new Set();
    this.meta = {
      roleObjectPermissions: [] as RoleObjectPermission[],
      roleSystemPermissions: [] as RoleSystemPermission[],
      dataModels: null,
      workflow: null,
      diagnostics: {
        unresolvedRuleBaseObjects: [],
        engines: {}
      }
    };
  }

  /**
   * Record per-engine diagnostic data. Merged into graph.meta.diagnostics.engines[engineName].
   */
  addEngineDiagnostic(engineName: string, data: Record<string, unknown>): void {
    const existing = this.meta.diagnostics.engines[engineName] || {};
    this.meta.diagnostics.engines[engineName] = { ...existing, ...data };
  }

  /**
   * Attach a finalised structured ingest log. Called once, by `runPipeline`,
   * after every engine has emitted into the shared `IngestLogBuilder`.
   */
  setIngestLog(log: IngestLog): void {
    this.meta.diagnostics.ingestLog = log;
  }

  /**
   * Add or merge a node into the graph in place, preserving protected metadata and collecting secondary types.
   */
  addNode(id: string, type: NodeType, metadata: NodeMetadata = {}): SFNode | null {
    const cleanId = `${id || ''}`.trim();
    if (!cleanId) return null;

    if (this.nodes.has(cleanId)) {
      const existing = this.nodes.get(cleanId)!;

      for (const [key, incomingValue] of Object.entries(metadata)) {
        if (key === 'id' || key === 'type') continue;
        if (incomingValue === null || incomingValue === undefined) continue;

        if (ARRAY_MERGE_FIELDS.has(key)) {
          const existing_arr = Array.isArray((existing as any)[key]) ? (existing as any)[key] : [];
          const incoming_arr = Array.isArray(incomingValue) ? incomingValue : [incomingValue];
          (existing as any)[key] = Array.from(new Set([...existing_arr, ...incoming_arr]));
        } else if (PROTECT_ONCE_SET_FIELDS.has(key) && (existing as any)[key]) {
          // protected — keep first non-empty value, ignore incoming
        } else {
          (existing as any)[key] = incomingValue;
        }
      }

      // Type reconciliation: keep primary type, collect secondary types
      if (type !== existing.type) {
        const secondaryTypes = new Set(existing.secondaryTypes || []);
        secondaryTypes.add(type);
        existing.secondaryTypes = Array.from(secondaryTypes);
        if (type === 'ODATA_ENTITY') (existing as any).odataExposed = true;
      }

      return existing;
    }

    const node = { id: cleanId, type, ...metadata } as SFNode;
    this.nodes.set(cleanId, node);
    return node;
  }

  /**
   * Add a directed edge while preserving the canonical relationship type.
   */
  addEdge(from: string, to: string, type: EdgeType, metadata: EdgeMetadata = {}): SFEdge | null {
    const src = `${from || ''}`.trim();
    const dest = `${to || ''}`.trim();
    if (!src || !dest || !type) return null;

    const edgeMetadata: any = { ...metadata };
    if (edgeMetadata.type && edgeMetadata.type !== type && !edgeMetadata.edgeSubtype) {
      edgeMetadata.edgeSubtype = edgeMetadata.type;
    }
    delete edgeMetadata.type;

    const dedupeKey = `${src}|${dest}|${type}`;
    if (this._edgeKeys.has(dedupeKey)) return null;
    this._edgeKeys.add(dedupeKey);

    const edge = { from: src, to: dest, type, ...edgeMetadata } as SFEdge;
    this.edges.push(edge);
    return edge;
  }

  /**
   * Export only edges whose endpoints exist in the node set.
   */
  getRenderableData(): RenderableData {
    const nodes = Array.from(this.nodes.values());
    const nodeIds = new Set(nodes.map(node => node.id));
    const renderableEdges: (SFEdge & { id: string })[] = [];
    const droppedEdges: SFEdge[] = [];

    this.edges.forEach((edge) => {
      if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) {
        renderableEdges.push({ id: `edge_${renderableEdges.length}`, ...edge });
      } else {
        droppedEdges.push(edge);
      }
    });

    return {
      nodes,
      edges: renderableEdges,
      diagnostics: {
        totalNodes: nodes.length,
        totalEdges: this.edges.length,
        renderableEdges: renderableEdges.length,
        droppedEdgesCount: droppedEdges.length,
        droppedEdges: droppedEdges.slice(0, 50)
      }
    };
  }

  serialize() {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: [...this.edges],
      meta: this.meta
    };
  }
}
