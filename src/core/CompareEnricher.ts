import type { DashboardLike, DiffNodeRef, DiffEdgeRef, DiffEdgeChange, CountsByType, DiffNodeChange, MdfFieldDelta } from './GraphDiff.js';
import { diffDashboardExports } from './GraphDiff.js';
import type { ObjectVerbAtom, FieldPermAtom, FieldOverrideAtom, SystemPermAtom, PermAtom } from './PermissionFlattener.js';
import { flattenPermissionAtoms } from './PermissionFlattener.js';

export type ChangeKind = 'added' | 'removed' | 'changed';

export type EnrichedNodeRef = DiffNodeRef & {
  moduleFamily?: string;
  moduleLabel?: string;
  affectsCount: number;
  changeKind: ChangeKind;
};

export type EnrichedNodeChange = EnrichedNodeRef & {
  changedKeys: string[];
  mdfFieldDelta?: MdfFieldDelta;
};

export type PermCellChange = {
  atom: PermAtom;
  changeKind: ChangeKind;
  previousValue?: string;
};

export type RolePermissionDelta = {
  roleId: string;
  roleLabel: string;
  moduleFamily?: string;
  moduleLabel?: string;
  objectVerbs:    { added: ObjectVerbAtom[];    removed: ObjectVerbAtom[]; };
  fieldPerms:     { added: FieldPermAtom[];     removed: FieldPermAtom[]; };
  fieldOverrides: { added: FieldOverrideAtom[]; removed: FieldOverrideAtom[]; changed: PermCellChange[]; };
  systemPerms:    { added: SystemPermAtom[];    removed: SystemPermAtom[]; };
  totals: { added: number; removed: number; changed: number; };
};

export interface EnrichedCompareResult {
  baseProject:   { id: string; name?: string; generatedAt?: string };
  targetProject: { id: string; name?: string; generatedAt?: string };

  nodes: {
    added:   EnrichedNodeRef[];
    removed: EnrichedNodeRef[];
    changed: EnrichedNodeChange[];
  };
  edges: {
    added:   DiffEdgeRef[];
    removed: DiffEdgeRef[];
    changed: DiffEdgeChange[];
  };

  rolePermissionDeltas: Record<string, RolePermissionDelta>;
  byNodeType: CountsByType;
  byEdgeType: CountsByType;

  totals: {
    totalChanges: number;
    nodes:  { added: number; removed: number; changed: number };
    edges:  { added: number; removed: number; changed: number };
    objectVerbs:    { added: number; removed: number };
    fieldPerms:     { added: number; removed: number };
    fieldOverrides: { added: number; removed: number; changed: number };
    systemPerms:    { added: number; removed: number };
  };

  summaryLines: string[];
  isEmpty: boolean;
}

export function buildCompareResult(
  baseExport: DashboardLike,
  targetExport: DashboardLike,
  baseMeta: { id: string; name?: string; generatedAt?: string },
  targetMeta: { id: string; name?: string; generatedAt?: string }
): EnrichedCompareResult {
  const diffResult = diffDashboardExports(baseExport, targetExport);

  // 1. Build Node Map & Reverse Dependents (affectsCount)
  const baseNodes = new Map<string, any>();
  const targetNodes = new Map<string, any>();
  
  if (baseExport.graph?.nodes) {
    for (const n of baseExport.graph.nodes) if (n.id) baseNodes.set(n.id as string, n);
  }
  if (targetExport.graph?.nodes) {
    for (const n of targetExport.graph.nodes) if (n.id) targetNodes.set(n.id as string, n);
  }

  const baseReverseDeps = new Map<string, number>();
  const targetReverseDeps = new Map<string, number>();

  if (baseExport.graph?.edges) {
    for (const e of baseExport.graph.edges) {
      if (e.to) baseReverseDeps.set(e.to as string, (baseReverseDeps.get(e.to as string) || 0) + 1);
    }
  }
  if (targetExport.graph?.edges) {
    for (const e of targetExport.graph.edges) {
      if (e.to) targetReverseDeps.set(e.to as string, (targetReverseDeps.get(e.to as string) || 0) + 1);
    }
  }

  const enrichNode = <T extends DiffNodeRef>(n: T, graph: 'base'|'target', changeKind: ChangeKind): T & { moduleFamily?: string; moduleLabel?: string; affectsCount: number; changeKind: ChangeKind } => {
    const raw = graph === 'target' ? targetNodes.get(n.id) : baseNodes.get(n.id);
    const deps = graph === 'target' ? targetReverseDeps : baseReverseDeps;
    return {
      ...n,
      moduleFamily: raw?.moduleFamily as string | undefined,
      moduleLabel: raw?.moduleLabel as string | undefined,
      affectsCount: deps.get(n.id) || 0,
      changeKind
    };
  };

  const enrichedNodes = {
    added: diffResult.nodes.added.map(n => enrichNode(n, 'target', 'added')),
    removed: diffResult.nodes.removed.map(n => enrichNode(n, 'base', 'removed')),
    changed: diffResult.nodes.changed.map(n => enrichNode(n, 'target', 'changed'))
  };

  const aAtoms = flattenPermissionAtoms(baseExport);
  const bAtoms = flattenPermissionAtoms(targetExport);

  const serializeAtomWithoutValue = (a: PermAtom) => {
    if (a.kind === 'fieldOverride') return `${a.kind}|${a.roleId}|${a.objectId}|${a.field}`;
    if (a.kind === 'objectVerb') return `${a.kind}|${a.roleId}|${a.objectId}|${a.verb}`;
    if (a.kind === 'fieldPerm') return `${a.kind}|${a.roleId}|${a.objectId}|${a.permission}`;
    return `${a.kind}|${a.roleId}|${a.permission}`;
  };
  const serializeFull = (a: PermAtom) => {
    if (a.kind === 'fieldOverride') return `${serializeAtomWithoutValue(a)}|${a.value}`;
    return serializeAtomWithoutValue(a);
  };

  const aMap = new Map<string, PermAtom>();
  for (const a of aAtoms) aMap.set(serializeFull(a), a);
  const bMap = new Map<string, PermAtom>();
  for (const b of bAtoms) bMap.set(serializeFull(b), b);

  const aNoValueMap = new Map<string, FieldOverrideAtom>();
  for (const a of aAtoms) {
      if (a.kind === 'fieldOverride') aNoValueMap.set(serializeAtomWithoutValue(a), a);
  }

  const rolePermissionDeltas: Record<string, RolePermissionDelta> = {};
  const ensureRoleDelta = (roleId: string) => {
    if (!rolePermissionDeltas[roleId]) {
      const raw = targetNodes.get(roleId) || baseNodes.get(roleId);
      rolePermissionDeltas[roleId] = {
        roleId,
        roleLabel: raw?.label || roleId,
        moduleFamily: raw?.moduleFamily as string | undefined,
        moduleLabel: raw?.moduleLabel as string | undefined,
        objectVerbs: { added: [], removed: [] },
        fieldPerms: { added: [], removed: [] },
        fieldOverrides: { added: [], removed: [], changed: [] },
        systemPerms: { added: [], removed: [] },
        totals: { added: 0, removed: 0, changed: 0 }
      };
    }
    return rolePermissionDeltas[roleId];
  };

  const totals = {
    totalChanges: 0,
    nodes: { added: enrichedNodes.added.length, removed: enrichedNodes.removed.length, changed: enrichedNodes.changed.length },
    edges: { added: diffResult.edges.added.length, removed: diffResult.edges.removed.length, changed: diffResult.edges.changed.length },
    objectVerbs: { added: 0, removed: 0 },
    fieldPerms: { added: 0, removed: 0 },
    fieldOverrides: { added: 0, removed: 0, changed: 0 },
    systemPerms: { added: 0, removed: 0 }
  };

  for (const [key, b] of bMap.entries()) {
    if (!aMap.has(key)) {
      const delta = ensureRoleDelta(b.roleId);
      if (b.kind === 'fieldOverride') {
        const keyNoVal = serializeAtomWithoutValue(b);
        const aVal = aNoValueMap.get(keyNoVal);
        if (aVal && aVal.value !== b.value) {
          delta.fieldOverrides.changed.push({ atom: b, changeKind: 'changed', previousValue: aVal.value });
          delta.totals.changed++;
          totals.fieldOverrides.changed++;
          aMap.delete(serializeFull(aVal));
        } else {
          delta.fieldOverrides.added.push(b);
          delta.totals.added++;
          totals.fieldOverrides.added++;
        }
      } else {
         if (b.kind === 'objectVerb') { delta.objectVerbs.added.push(b); totals.objectVerbs.added++; }
         else if (b.kind === 'fieldPerm') { delta.fieldPerms.added.push(b); totals.fieldPerms.added++; }
         else if (b.kind === 'systemPerm') { delta.systemPerms.added.push(b); totals.systemPerms.added++; }
         delta.totals.added++;
      }
    }
  }

  for (const [key, a] of aMap.entries()) {
    if (!bMap.has(key)) {
      const delta = ensureRoleDelta(a.roleId);
      if (a.kind === 'fieldOverride') { delta.fieldOverrides.removed.push(a); totals.fieldOverrides.removed++; }
      else if (a.kind === 'objectVerb') { delta.objectVerbs.removed.push(a); totals.objectVerbs.removed++; }
      else if (a.kind === 'fieldPerm') { delta.fieldPerms.removed.push(a); totals.fieldPerms.removed++; }
      else if (a.kind === 'systemPerm') { delta.systemPerms.removed.push(a); totals.systemPerms.removed++; }
      delta.totals.removed++;
    }
  }

  Object.values(rolePermissionDeltas).forEach(r => {
    r.objectVerbs.added.sort((x, y) => `${x.objectId}|${x.verb}`.localeCompare(`${y.objectId}|${y.verb}`));
    r.objectVerbs.removed.sort((x, y) => `${x.objectId}|${x.verb}`.localeCompare(`${y.objectId}|${y.verb}`));
    r.fieldOverrides.added.sort((x, y) => `${x.objectId}|${x.field}`.localeCompare(`${y.objectId}|${y.field}`));
    r.fieldOverrides.removed.sort((x, y) => `${x.objectId}|${x.field}`.localeCompare(`${y.objectId}|${y.field}`));
    r.fieldOverrides.changed.sort((x, y) => {
      const ax = x.atom as FieldOverrideAtom;
      const ay = y.atom as FieldOverrideAtom;
      return `${ax.objectId}|${ax.field}`.localeCompare(`${ay.objectId}|${ay.field}`);
    });
  });

  totals.totalChanges = totals.nodes.added + totals.nodes.removed + totals.nodes.changed +
    totals.edges.added + totals.edges.removed + totals.edges.changed +
    totals.fieldOverrides.added + totals.fieldOverrides.removed + totals.fieldOverrides.changed +
    totals.objectVerbs.added + totals.objectVerbs.removed +
    totals.fieldPerms.added + totals.fieldPerms.removed +
    totals.systemPerms.added + totals.systemPerms.removed;

  const summaryLineCount = Object.keys(rolePermissionDeltas).length;

  return {
    baseProject: baseMeta,
    targetProject: targetMeta,
    nodes: enrichedNodes,
    edges: diffResult.edges,
    rolePermissionDeltas,
    byNodeType: diffResult.byNodeType,
    byEdgeType: diffResult.byEdgeType,
    totals,
    summaryLines: [
      ...diffResult.summaryLines,
      `Role Permissions: delta in ${summaryLineCount} roles.`,
    ],
    isEmpty: totals.totalChanges === 0
  };
}
