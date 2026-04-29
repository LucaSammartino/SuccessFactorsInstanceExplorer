/**
 * Stable summary of `buildDashboardExport` (UI/API payload).
 * Omits `generatedAt` and full node/edge bodies — use hashes and counts only.
 */

import crypto from 'node:crypto';
import type { SFGraph } from '../core/GraphSchema.js';
import { ArchitecturalStats } from '../core/ArchitecturalStats.js';
import { buildDashboardExport } from '../core/DashboardExporter.js';
import { compareUtf16 } from '../core/deterministicSort.js';

function deepStableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(deepStableStringify).join(',')}]`;
  }
  const keys = Object.keys(value as object).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${deepStableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

/** Top-level keys the API writes to `data.json` (contract guard). */
export const DASHBOARD_EXPORT_TOP_LEVEL_KEYS = [
  'generatedAt',
  'graph',
  'permissions',
  'dataModels',
  'workflow',
  'stats',
  'diagnostics'
] as const;

/** Extra top-level keys the server adds when persisting `data.json` (not produced by `buildDashboardExport`). */
export const API_DATA_JSON_EXTRA_KEYS = ['projectBundle'] as const;

/** Shape guard for on-disk / GET `/api/projects/:id/data` payloads after ingest (includes `projectBundle`). */
export function apiProjectDataJsonHasExpectedShape(exp: Record<string, unknown>): boolean {
  const keys = Object.keys(exp).sort();
  const expected = [...DASHBOARD_EXPORT_TOP_LEVEL_KEYS, ...API_DATA_JSON_EXTRA_KEYS].sort();
  if (keys.length !== expected.length) return false;
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i] !== expected[i]) return false;
  }
  const p = exp.permissions as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') return false;
  const pk = Object.keys(p).sort().join(',');
  if (pk !== 'roleObjectPermissions,roleSystemPermissions') return false;
  return true;
}

export function buildDashboardExportLite(graph: SFGraph): Record<string, unknown> {
  const stats = new ArchitecturalStats(graph).calculate();
  const exp = buildDashboardExport(graph, stats) as Record<string, unknown>;
  const g = exp.graph as { nodes: { id: string }[]; edges: unknown[] };
  const permissions = exp.permissions as {
    roleObjectPermissions: unknown[];
    roleSystemPermissions: unknown[];
  };
  const workflow = exp.workflow as { summary?: Record<string, unknown> } | null | undefined;
  const dataModels = exp.dataModels as { summary?: Record<string, unknown> } | null | undefined;
  const diagnostics = exp.diagnostics as Record<string, unknown>;

  const wf = workflow?.summary;
  const dm = dataModels?.summary;

  const statsSha256 = crypto
    .createHash('sha256')
    .update(deepStableStringify(stats), 'utf8')
    .digest('hex');

  const sortedNodeIds = g.nodes.map(n => n.id).sort(compareUtf16);
  const renderableNodeInventorySha256 = crypto
    .createHash('sha256')
    .update(sortedNodeIds.join('\n'), 'utf8')
    .digest('hex');

  return {
    exportLiteVersion: 1,
    topLevelKeys: [...DASHBOARD_EXPORT_TOP_LEVEL_KEYS].sort(),
    renderableNodeCount: g.nodes.length,
    renderableEdgeCount: g.edges.length,
    roleObjectPermissionRows: permissions.roleObjectPermissions.length,
    roleSystemPermissionRows: permissions.roleSystemPermissions.length,
    statsSha256,
    renderableNodeInventorySha256,
    diagnostics: {
      totalNodes: diagnostics.totalNodes,
      totalEdges: diagnostics.totalEdges,
      renderableEdges: diagnostics.renderableEdges,
      droppedEdgesCount: diagnostics.droppedEdgesCount,
      unresolvedRuleBaseObjectsCount: (diagnostics.unresolvedRuleBaseObjects as unknown[] | undefined)?.length ?? 0
    },
    meta: {
      workflow: wf
        ? {
            present: wf.present === true,
            workflowCount: wf.workflowCount,
            recordCount: wf.recordCount,
            uniqueApproverTypeCount: wf.uniqueApproverTypeCount,
            uniqueBaseObjectTypeCount: wf.uniqueBaseObjectTypeCount
          }
        : { present: false },
      dataModels: dm
        ? {
            foundationReferenceCount: dm.foundationReferenceCount,
            corporateObjectCount: dm.corporateObjectCount,
            countryOverrideObjectCount: dm.countryOverrideObjectCount,
            byClass: Object.keys((dm.byClass as object) || {})
              .sort()
              .reduce(
                (acc, k) => {
                  acc[k] = (dm.byClass as Record<string, number>)[k];
                  return acc;
                },
                {} as Record<string, number>
              ),
            byTechnology: Object.keys((dm.byTechnology as object) || {})
              .sort()
              .reduce(
                (acc, k) => {
                  acc[k] = (dm.byTechnology as Record<string, number>)[k];
                  return acc;
                },
                {} as Record<string, number>
              )
          }
        : null
    }
  };
}

export function dashboardExportHasExpectedShape(exp: Record<string, unknown>): boolean {
  const keys = Object.keys(exp).sort();
  const expected = [...DASHBOARD_EXPORT_TOP_LEVEL_KEYS].sort();
  if (keys.length !== expected.length) return false;
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i] !== expected[i]) return false;
  }
  const p = exp.permissions as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') return false;
  const pk = Object.keys(p).sort().join(',');
  if (pk !== 'roleObjectPermissions,roleSystemPermissions') return false;
  return true;
}
