import type {
    EnrichedCompareResult,
    EnrichedNodeRef,
    EnrichedNodeChange,
    RolePermissionDelta,
} from '../../../src/core/CompareEnricher';

export type DiffStatus = 'added' | 'removed' | 'changed' | 'unchanged';

export type EntityKind =
    | 'RBP_ROLE'
    | 'MDF_OBJECT'
    | 'BUSINESS_RULE'
    | 'WORKFLOW'
    | 'ODATA_ENTITY'
    | 'FIELD';

/**
 * One searchable row. For FIELD rows, `id` is `${parentObjectId}::${fieldName}` so the
 * search list and selection state can key on it without colliding with regular node ids.
 */
export type EntityRow = {
    id: string;
    kind: EntityKind;
    label: string;
    parentId?: string;
    parentLabel?: string;
    moduleFamily?: string;
    moduleLabel?: string;
    diffStatus: DiffStatus;
    /** Short "+12 ~3 −1" or "12 perms · 3 overrides" — rendered in the row, optional. */
    changeSummary?: string;
    affectsCount?: number;
    /** True iff there is *any* concrete difference between base and target for this entity. */
    isDifferent: boolean;
    source: EntitySource;
};

export type EntitySource =
    | { kind: 'node-added'; node: EnrichedNodeRef }
    | { kind: 'node-removed'; node: EnrichedNodeRef }
    | { kind: 'node-changed'; node: EnrichedNodeChange; roleDelta?: RolePermissionDelta }
    | { kind: 'role-delta-only'; delta: RolePermissionDelta }
    | {
          kind: 'field';
          parentObjectId: string;
          parentObjectLabel: string;
          fieldName: string;
          fieldStatus: 'added' | 'removed' | 'changed';
          parentChangeNode?: EnrichedNodeChange;
      };

const KIND_TO_LABEL: Record<EntityKind, string> = {
    RBP_ROLE: 'Role',
    MDF_OBJECT: 'Object',
    BUSINESS_RULE: 'Rule',
    WORKFLOW: 'Workflow',
    ODATA_ENTITY: 'OData',
    FIELD: 'Field',
};

export function entityKindLabel(kind: EntityKind): string {
    return KIND_TO_LABEL[kind] ?? kind;
}

const NODE_TYPE_TO_KIND: Record<string, EntityKind> = {
    RBP_ROLE: 'RBP_ROLE',
    MDF_OBJECT: 'MDF_OBJECT',
    BUSINESS_RULE: 'BUSINESS_RULE',
    WORKFLOW: 'WORKFLOW',
    ODATA_ENTITY: 'ODATA_ENTITY',
};

function classifyNodeKind(nodeType: string): EntityKind | null {
    return NODE_TYPE_TO_KIND[nodeType] ?? null;
}

function summarizeRoleDelta(d: RolePermissionDelta): string {
    const parts: string[] = [];
    const verbsAdded = d.objectVerbs.added.length;
    const verbsRemoved = d.objectVerbs.removed.length;
    if (verbsAdded || verbsRemoved) parts.push(`verbs +${verbsAdded}/−${verbsRemoved}`);
    const fpAdded = d.fieldPerms.added.length;
    const fpRemoved = d.fieldPerms.removed.length;
    if (fpAdded || fpRemoved) parts.push(`field-perms +${fpAdded}/−${fpRemoved}`);
    const foA = d.fieldOverrides.added.length;
    const foR = d.fieldOverrides.removed.length;
    const foC = d.fieldOverrides.changed.length;
    if (foA || foR || foC) parts.push(`overrides +${foA}/−${foR}/~${foC}`);
    const sysA = d.systemPerms.added.length;
    const sysR = d.systemPerms.removed.length;
    if (sysA || sysR) parts.push(`sys +${sysA}/−${sysR}`);
    return parts.join(' · ');
}

function summarizeFieldDelta(node: EnrichedNodeChange): string {
    const d = node.mdfFieldDelta;
    if (!d) return node.changedKeys.length ? `${node.changedKeys.length} attr changed` : '';
    const parts: string[] = [];
    if (d.added.length) parts.push(`+${d.added.length}`);
    if (d.removed.length) parts.push(`−${d.removed.length}`);
    if (d.changed.length) parts.push(`~${d.changed.length}`);
    return parts.length ? `fields ${parts.join(' ')}` : '';
}

/**
 * Build the unified entity index from the compare result. Currently includes only
 * entities that appear in the diff (added / removed / changed) plus role permission
 * deltas plus per-field rows derived from `mdfFieldDelta`. Unchanged-in-both entities
 * are not indexed in v1.
 */
export function buildEntityIndex(result: EnrichedCompareResult | null): EntityRow[] {
    if (!result || result.isEmpty) return [];

    const rows: EntityRow[] = [];
    // Track which role ids we've already emitted via the changed/added/removed pass
    // so the "role-delta-only" pass doesn't double-add them.
    const seenRoleIds = new Set<string>();
    // Same idea for object ids — we want to attach the parentChangeNode on field rows.
    const changedNodeById = new Map<string, EnrichedNodeChange>();
    for (const n of result.nodes.changed) changedNodeById.set(n.id, n);

    const pushNodeRow = (
        node: EnrichedNodeRef | EnrichedNodeChange,
        diffStatus: 'added' | 'removed' | 'changed'
    ) => {
        const kind = classifyNodeKind(node.type);
        if (!kind) return; // edges, association nodes, etc. are skipped from search
        const isChanged = diffStatus === 'changed';
        const changedNode = isChanged ? (node as EnrichedNodeChange) : undefined;

        let changeSummary: string | undefined;
        let source: EntitySource;
        if (diffStatus === 'added') {
            changeSummary = 'added in target';
            source = { kind: 'node-added', node };
        } else if (diffStatus === 'removed') {
            changeSummary = 'removed from base';
            source = { kind: 'node-removed', node };
        } else {
            const roleDelta =
                kind === 'RBP_ROLE' ? result.rolePermissionDeltas[node.id] : undefined;
            const summaryParts: string[] = [];
            if (kind === 'MDF_OBJECT' && changedNode) {
                const s = summarizeFieldDelta(changedNode);
                if (s) summaryParts.push(s);
            } else if (changedNode?.changedKeys.length) {
                summaryParts.push(`${changedNode.changedKeys.length} attr`);
            }
            if (roleDelta) {
                const s = summarizeRoleDelta(roleDelta);
                if (s) summaryParts.push(s);
            }
            changeSummary = summaryParts.join(' · ');
            source = { kind: 'node-changed', node: changedNode!, roleDelta };
            if (roleDelta) seenRoleIds.add(node.id);
        }

        rows.push({
            id: node.id,
            kind,
            label: node.label || node.id,
            moduleFamily: (node as EnrichedNodeRef).moduleFamily,
            moduleLabel: (node as EnrichedNodeRef).moduleLabel,
            diffStatus,
            changeSummary,
            affectsCount: (node as EnrichedNodeRef).affectsCount,
            isDifferent: true,
            source,
        });

        if (kind === 'MDF_OBJECT' && isChanged && changedNode?.mdfFieldDelta) {
            const d = changedNode.mdfFieldDelta;
            const emitField = (fieldName: string, status: 'added' | 'removed' | 'changed') => {
                rows.push({
                    id: `${node.id}::${fieldName}`,
                    kind: 'FIELD',
                    label: fieldName,
                    parentId: node.id,
                    parentLabel: node.label || node.id,
                    moduleFamily: (node as EnrichedNodeRef).moduleFamily,
                    moduleLabel: (node as EnrichedNodeRef).moduleLabel,
                    diffStatus: status,
                    changeSummary:
                        status === 'added'
                            ? 'added in target'
                            : status === 'removed'
                              ? 'removed from base'
                              : 'attribute changed',
                    isDifferent: true,
                    source: {
                        kind: 'field',
                        parentObjectId: node.id,
                        parentObjectLabel: node.label || node.id,
                        fieldName,
                        fieldStatus: status,
                        parentChangeNode: changedNode,
                    },
                });
            };
            d.added.forEach(f => emitField(f, 'added'));
            d.removed.forEach(f => emitField(f, 'removed'));
            d.changed.forEach(f => emitField(f, 'changed'));
        }
    };

    result.nodes.added.forEach(n => pushNodeRow(n, 'added'));
    result.nodes.removed.forEach(n => pushNodeRow(n, 'removed'));
    result.nodes.changed.forEach(n => pushNodeRow(n, 'changed'));

    // Roles whose only signal is a permission delta (no structural node change).
    for (const [roleId, delta] of Object.entries(result.rolePermissionDeltas)) {
        if (seenRoleIds.has(roleId)) continue;
        const total = delta.totals.added + delta.totals.removed + delta.totals.changed;
        if (total === 0) continue;
        rows.push({
            id: roleId,
            kind: 'RBP_ROLE',
            label: delta.roleLabel || roleId,
            moduleFamily: delta.moduleFamily,
            moduleLabel: delta.moduleLabel,
            diffStatus: 'changed',
            changeSummary: summarizeRoleDelta(delta),
            isDifferent: true,
            source: { kind: 'role-delta-only', delta },
        });
    }

    return rows;
}

export type EntityFilterState = {
    query: string;
    kinds: Set<EntityKind>;
    statuses: Set<DiffStatus>;
};

export function makeDefaultEntityFilter(): EntityFilterState {
    return {
        query: '',
        kinds: new Set<EntityKind>([
            'RBP_ROLE',
            'MDF_OBJECT',
            'BUSINESS_RULE',
            'WORKFLOW',
            'ODATA_ENTITY',
            'FIELD',
        ]),
        statuses: new Set<DiffStatus>(['added', 'removed', 'changed']),
    };
}

export function filterEntityRows(rows: EntityRow[], f: EntityFilterState): EntityRow[] {
    const q = f.query.trim().toLowerCase();
    return rows.filter(r => {
        if (!f.kinds.has(r.kind)) return false;
        if (!f.statuses.has(r.diffStatus)) return false;
        if (!q) return true;
        if (r.label.toLowerCase().includes(q)) return true;
        if (r.id.toLowerCase().includes(q)) return true;
        if (r.parentLabel && r.parentLabel.toLowerCase().includes(q)) return true;
        if (r.parentId && r.parentId.toLowerCase().includes(q)) return true;
        return false;
    });
}

export const ALL_ENTITY_KINDS: EntityKind[] = [
    'RBP_ROLE',
    'MDF_OBJECT',
    'BUSINESS_RULE',
    'WORKFLOW',
    'ODATA_ENTITY',
    'FIELD',
];

export const ALL_DIFF_STATUSES: DiffStatus[] = ['added', 'changed', 'removed'];

export function diffStatusLabel(s: DiffStatus): string {
    if (s === 'added') return 'Added';
    if (s === 'removed') return 'Removed';
    if (s === 'changed') return 'Changed';
    return 'Unchanged';
}

export function diffStatusColorVar(s: DiffStatus): string {
    if (s === 'added') return '--compare-added';
    if (s === 'removed') return '--compare-removed';
    if (s === 'changed') return '--compare-changed';
    return '--ui5-text-color-secondary';
}

export function diffStatusSymbol(s: DiffStatus): string {
    if (s === 'added') return '+';
    if (s === 'removed') return '−';
    if (s === 'changed') return '~';
    return '·';
}
