import type { SFGraph } from './GraphSchema.js';
import type { RoleObjectPermission, RoleSystemPermission, SFNode } from '../types.js';

function ensureArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function sanitizeNode(node: SFNode): Record<string, unknown> {
  const base: Record<string, unknown> = {
    ...node,
    tags: ensureArray(node.tags),
    secondaryTypes: ensureArray(node.secondaryTypes),
  };

  if (node.type === 'MDF_OBJECT') {
    base.attributes = ensureArray(node.attributes);
    base.mdfPermissionCategories = ensureArray(node.mdfPermissionCategories);
    base.systemPermissionCategories = ensureArray(node.systemPermissionCategories);
    base.dataModelAliases = ensureArray(node.dataModelAliases);
    base.dataModelSources = ensureArray(node.dataModelSources);
    base.searchKeywords = ensureArray(node.searchKeywords);
    base.countryOverrides = ensureArray(node.countryOverrides).map(override => ({
      ...override,
      fields: ensureArray(override.fields)
    }));
    base.corporateDataModel = node.corporateDataModel
      ? {
          ...node.corporateDataModel,
          fields: ensureArray(node.corporateDataModel.fields)
        }
      : null;
  } else if (node.type === 'BUSINESS_RULE') {
    base.modifiesFields = ensureArray(node.modifiesFields);
  } else if (node.type === 'RBP_ROLE') {
    base.mdfPermissionCategories = ensureArray(node.mdfPermissionCategories);
    base.systemPermissionCategories = ensureArray(node.systemPermissionCategories);
  }

  return base;
}

function sanitizeEdge(edge: { id: string; type: string; fieldNames?: string[] }): Record<string, unknown> {
  const base: Record<string, unknown> = { ...edge };
  if (edge.type === 'TRIGGERED_BY') {
    base.fieldNames = ensureArray(edge.fieldNames as string[] | undefined);
  }
  return base;
}

function sanitizeRoleObjectPermission(entry: RoleObjectPermission): RoleObjectPermission {
  const fieldItems = ensureArray(entry.fieldItems).map(item => ({
    objectHint: item?.objectHint || '',
    fieldName: item?.fieldName || '',
    actions: ensureArray(item?.actions),
    actionTypes: ensureArray(item?.actionTypes),
    category: item?.category || ''
  }));
  const populationAssignments = ensureArray(entry.populationAssignments).map(item => ({
    id: item?.id || '',
    name: item?.name || '',
    population: item?.population || ''
  }));

  return {
    ...entry,
    permissions: ensureArray(entry.permissions),
    categories: ensureArray(entry.categories),
    structures: ensureArray(entry.structures),
    fieldOverrides: ensureArray(entry.fieldOverrides),
    fieldItems,
    actionTypesRollup: ensureArray(entry.actionTypesRollup),
    fieldItemCount: Number.isFinite(entry.fieldItemCount) ? entry.fieldItemCount : fieldItems.length,
    populationAssignments
  };
}

function sanitizeRoleSystemPermission(entry: RoleSystemPermission): RoleSystemPermission {
  return {
    roleId: entry?.roleId || '',
    permission: entry?.permission || '',
    categories: ensureArray(entry?.categories),
    searchText: entry?.searchText || ''
  };
}

export function buildDashboardExport(graph: SFGraph, stats: Record<string, unknown>) {
  const renderable = graph.getRenderableData();

  return {
    generatedAt: new Date().toISOString(),
    graph: {
      nodes: renderable.nodes.map(sanitizeNode),
      edges: renderable.edges.map(edge => sanitizeEdge(edge))
    },
    permissions: {
      roleObjectPermissions: (graph.meta.roleObjectPermissions || []).map(sanitizeRoleObjectPermission),
      roleSystemPermissions: (graph.meta.roleSystemPermissions || []).map(sanitizeRoleSystemPermission)
    },
    dataModels: graph.meta.dataModels || null,
    workflow: graph.meta.workflow || null,
    stats,
    diagnostics: {
      ...renderable.diagnostics,
      unresolvedRuleBaseObjects: graph.meta.diagnostics?.unresolvedRuleBaseObjects || [],
      engines: graph.meta.diagnostics?.engines || {}
    }
  };
}
