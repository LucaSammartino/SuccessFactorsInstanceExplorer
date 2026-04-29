import { appState as S } from './store';
import type { PreparedInstanceModel } from './prepared-instance';
import { getFocusedNodeIds } from './node-selection';

export function canToggleRolePermissionLinks(): boolean {
    return !(S.currentViewKind === 'drilldown' && S.currentModule === 'ALL');
}

export function shouldIncludeRoleLinks(): boolean {
    if (S.currentView === 'RBP_ROLE') return true;
    const selectedType = S.nodeById.get(S.currentSelection?.nodeId ?? '')?.type;
    const focusHasRole = getFocusedNodeIds().some(nodeId => S.nodeById.get(nodeId)?.type === 'RBP_ROLE');
    if (selectedType === 'RBP_ROLE' || focusHasRole) return true;
    if (S.currentView !== 'all') return false;
    if (!canToggleRolePermissionLinks()) return false;
    return S.includeRolePermissionLinks;
}

export function getRankedRolesForRail(moduleFamily: string | null | undefined, subModule?: string | null) {
    const rows: { roleId: string; count: number; label: string }[] = [];
    S.roleObjectByRole.forEach((entries, roleId) => {
        const node = S.nodeById.get(roleId);
        if (!node || node.type !== 'RBP_ROLE') return;
        if (moduleFamily) {
            const touches = entries.some(
                entry => (entry.objectNode?.moduleFamily || 'Unclassified') === moduleFamily &&
                    (!subModule || subModule === 'ALL' || entry.objectNode?.subModule === subModule)
            );
            if (!touches) return;
        }
        rows.push({ roleId, count: entries.length, label: (node.label as string) || roleId });
    });
    rows.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
    return rows;
}

/** Rank roles for matrix / rail using a prepared snapshot (compare right pane). */
export function getRankedRolesForRailFromPrepared(
    prep: PreparedInstanceModel,
    moduleFamily: string | null | undefined,
    subModule?: string | null
) {
    const rows: { roleId: string; count: number; label: string }[] = [];
    prep.roleObjectByRole.forEach((entries, roleId) => {
        const node = prep.nodeById.get(roleId);
        if (!node || node.type !== 'RBP_ROLE') return;
        if (moduleFamily) {
            const touches = entries.some(
                entry => (entry.objectNode?.moduleFamily || 'Unclassified') === moduleFamily &&
                    (!subModule || subModule === 'ALL' || entry.objectNode?.subModule === subModule)
            );
            if (!touches) return;
        }
        rows.push({ roleId, count: entries.length, label: (node.label as string) || roleId });
    });
    rows.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
    return rows;
}
