/**
 * Deterministic graph summary for golden snapshots and CI regression checks.
 */

import crypto from 'node:crypto';
import type { SFGraph } from '../core/GraphSchema.js';
import type { SFNode } from '../types.js';
import { compareUtf16 } from '../core/deterministicSort.js';

function sortKeys<V>(obj: Record<string, V>): Record<string, V> {
  if (!obj || typeof obj !== 'object') return obj;
  return Object.keys(obj)
    .sort()
    .reduce<Record<string, V>>((acc, k) => {
      acc[k] = obj[k];
      return acc;
    }, {});
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = keyFn(item);
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

type WorkflowSummaryLite = {
  present: boolean;
  workflowCount?: number;
  recordCount?: number;
  uniqueApproverTypeCount?: number;
  uniqueBaseObjectTypeCount?: number;
};

type DataModelsSummaryLite = {
  foundationReferenceCount?: number;
  corporateObjectCount?: number;
  countryOverrideObjectCount?: number;
  byClass?: Record<string, number>;
  byTechnology?: Record<string, number>;
};

function metaFromGraph(graph: SFGraph): {
  workflow: WorkflowSummaryLite;
  dataModels: DataModelsSummaryLite | null;
} {
  const meta = graph.meta as {
    workflow?: { summary?: Record<string, unknown> } | null;
    dataModels?: { summary?: Record<string, unknown> } | null;
  };
  const wf = meta.workflow?.summary;
  const dm = meta.dataModels?.summary;

  return {
    workflow: wf
      ? {
          present: wf.present === true,
          workflowCount: wf.workflowCount as number | undefined,
          recordCount: wf.recordCount as number | undefined,
          uniqueApproverTypeCount: wf.uniqueApproverTypeCount as number | undefined,
          uniqueBaseObjectTypeCount: wf.uniqueBaseObjectTypeCount as number | undefined
        }
      : { present: false },
    dataModels: dm
      ? {
          foundationReferenceCount: dm.foundationReferenceCount as number | undefined,
          corporateObjectCount: dm.corporateObjectCount as number | undefined,
          countryOverrideObjectCount: dm.countryOverrideObjectCount as number | undefined,
          byClass: sortKeys((dm.byClass || {}) as Record<string, number>),
          byTechnology: sortKeys((dm.byTechnology || {}) as Record<string, number>)
        }
      : null
  };
}

export function buildGoldenSnapshot(graph: SFGraph): Record<string, unknown> {
  const nodes = Array.from(graph.nodes.values());
  const nodeCountsByType = countBy(nodes, (n: SFNode) => n.type);
  const idsByType: Record<string, string[]> = {};
  for (const n of nodes) {
    if (!idsByType[n.type]) idsByType[n.type] = [];
    idsByType[n.type].push(n.id);
  }
  for (const t of Object.keys(idsByType)) {
    idsByType[t].sort(compareUtf16);
  }

  const edgeCountsByType = countBy(graph.edges, e => e.type);
  const edgeFingerprints = graph.edges
    .map(e => `${e.from}\t${e.to}\t${e.type}`)
    .sort(compareUtf16);

  const { workflow: workflowMeta, dataModels: dataModelsMeta } = metaFromGraph(graph);

  return {
    snapshotVersion: 1,
    totalNodes: nodes.length,
    totalEdges: graph.edges.length,
    nodeCountsByType: sortKeys(nodeCountsByType),
    edgeCountsByType: sortKeys(edgeCountsByType),
    nodeIdsByType: sortKeys(idsByType),
    edgeFingerprints,
    meta: {
      workflow: workflowMeta,
      dataModels: dataModelsMeta
    },
    diagnostics: {
      unresolvedRuleBaseObjectCount: graph.meta.diagnostics?.unresolvedRuleBaseObjects?.length ?? 0
    }
  };
}

export function buildGoldenSnapshotLite(graph: SFGraph): Record<string, unknown> {
  const full = buildGoldenSnapshot(graph) as {
    snapshotVersion: number;
    totalNodes: number;
    totalEdges: number;
    nodeCountsByType: Record<string, number>;
    edgeCountsByType: Record<string, number>;
    nodeIdsByType: Record<string, string[]>;
    edgeFingerprints: string[];
    meta: unknown;
    diagnostics: unknown;
  };
  const edgeBody = full.edgeFingerprints.join('\n');
  const edgeFingerprintSha256 = crypto.createHash('sha256').update(edgeBody, 'utf8').digest('hex');

  const nodeLines: string[] = [];
  for (const [t, ids] of Object.entries(full.nodeIdsByType)) {
    for (const id of ids) {
      nodeLines.push(`${t}\t${id}`);
    }
  }
  nodeLines.sort(compareUtf16);
  const nodeInventorySha256 = crypto
    .createHash('sha256')
    .update(nodeLines.join('\n'), 'utf8')
    .digest('hex');

  return {
    snapshotLiteVersion: 1,
    snapshotVersion: full.snapshotVersion,
    totalNodes: full.totalNodes,
    totalEdges: full.totalEdges,
    nodeCountsByType: full.nodeCountsByType,
    edgeCountsByType: full.edgeCountsByType,
    edgeFingerprintSha256,
    nodeInventorySha256,
    meta: full.meta,
    diagnostics: full.diagnostics
  };
}
