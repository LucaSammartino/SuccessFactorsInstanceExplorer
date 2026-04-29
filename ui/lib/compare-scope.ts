import { appState as S } from './store';
import { compareState } from './compare';
import type { CascadingEdge, CascadingNode } from './types';

type PreparedCompareModel = {
    nodeById: Map<string, CascadingNode>;
    edgesByNode: Map<string, CascadingEdge[]>;
    roleObjectByRole: Map<string, any[]>;
    roleObjectPermissions: any[];
};

export type CompareScopeDraft = {
    scopedNodes: Map<string, CascadingNode>;
    edges: CascadingEdge[];
    scopeLabel: string;
};

export function buildCompareScope(nodeId: string): CompareScopeDraft | null {
    const scopedNodes = new Map<string, CascadingNode>();
    const edges: CascadingEdge[] = [];
    const labels: string[] = [];

    for (const model of getCompareModels()) {
        const seedNode = model.nodeById.get(nodeId);
        if (!seedNode) continue;
        scopedNodes.set(seedNode.id, seedNode);
        labels.push(String(seedNode.label || seedNode.id));

        if (seedNode.type === 'RBP_ROLE') {
            const permissionEntries = model.roleObjectByRole.get(seedNode.id) || [];
            const objectIds = new Set<string>();

            permissionEntries.forEach(entry => {
                if (entry.objectNode) scopedNodes.set(entry.objectNode.id, entry.objectNode);
                if (entry.objectId) objectIds.add(entry.objectId);
            });

            edges.push(...buildPermissionEdgesForModel(objectIds, scopedNodes, model.roleObjectPermissions, seedNode.id));
            mergePreparedNeighborhood(scopedNodes, edges, model, collectPreparedNeighborhood(model.edgesByNode, Array.from(objectIds), 1));
        } else {
            mergePreparedNeighborhood(scopedNodes, edges, model, collectPreparedNeighborhood(model.edgesByNode, [seedNode.id], 1));
            if (seedNode.type === 'MDF_OBJECT') {
                edges.push(...buildPermissionEdgesForModel(new Set([seedNode.id]), scopedNodes, model.roleObjectPermissions));
            }
        }
    }

    if (scopedNodes.size === 0) return null;
    const title = labels[0] || nodeId;
    return { scopedNodes, edges, scopeLabel: `${title} compare focus` };
}

export function applyCompareDiffTags(nodes: CascadingNode[], edges: CascadingEdge[]): void {
    if (!S.compareOverlay || !compareState.result || compareState.result.error) return;
    const result = compareState.result;
    const nodeStatus = new Map<string, 'added' | 'removed' | 'changed' | 'unchanged'>();
    result.nodes.added.forEach((node: any) => nodeStatus.set(node.id, 'added'));
    result.nodes.removed.forEach((node: any) => nodeStatus.set(node.id, 'removed'));
    result.nodes.changed.forEach((node: any) => nodeStatus.set(node.id, 'changed'));
    Object.entries(result.rolePermissionDeltas || {}).forEach(([roleId, delta]: [string, any]) => {
        const total = (delta?.totals?.added || 0) + (delta?.totals?.removed || 0) + (delta?.totals?.changed || 0);
        if (total > 0 && !nodeStatus.has(roleId)) nodeStatus.set(roleId, 'changed');
    });

    const edgeStatus = new Map<string, 'added' | 'removed' | 'changed' | 'unchanged'>();
    result.edges.added.forEach((edge: any) => edgeStatus.set(edge.id, 'added'));
    result.edges.removed.forEach((edge: any) => edgeStatus.set(edge.id, 'removed'));
    result.edges.changed.forEach((edge: any) => edgeStatus.set(edge.id, 'changed'));

    nodes.forEach(node => {
        (node as any).diffStatus = nodeStatus.get(node.id) || 'unchanged';
    });

    edges.forEach(edge => {
        const structuralStatus = edgeStatus.get(edgeIdentity(edge));
        const permissionStatus = edge.type === 'PERMITS'
            ? syntheticPermissionDiffStatus(edge.from, edge.to)
            : undefined;
        const status = compareStatusRank(permissionStatus) > compareStatusRank(structuralStatus)
            ? permissionStatus
            : structuralStatus;
        (edge as any).diffStatus = status || 'unchanged';
    });
}

function getCompareModels(): PreparedCompareModel[] {
    const models: Array<PreparedCompareModel | null> = [
        {
            nodeById: S.nodeById,
            edgesByNode: S.edgesByNode,
            roleObjectByRole: S.roleObjectByRole,
            roleObjectPermissions: S.roleObjectPermissions,
        },
        S.compareTargetPrepared
            ? {
                nodeById: S.compareTargetPrepared.nodeById,
                edgesByNode: S.compareTargetPrepared.edgesByNode,
                roleObjectByRole: S.compareTargetPrepared.roleObjectByRole,
                roleObjectPermissions: S.compareTargetPrepared.roleObjectPermissions,
            }
            : null,
    ];
    return models.filter((model): model is PreparedCompareModel => Boolean(model));
}

function collectPreparedNeighborhood(
    edgesByNode: Map<string, CascadingEdge[]>,
    seedIds: string[],
    depth = 1
): { nodeIds: Set<string>; edges: CascadingEdge[] } {
    const visitedIds = new Set(seedIds);
    const collectedEdges: CascadingEdge[] = [];
    const seenEdges = new Set<string>();
    let frontier = new Set<string>(seedIds);

    for (let step = 0; step < depth; step++) {
        const nextFrontier = new Set<string>();
        for (const id of frontier) {
            for (const edge of edgesByNode.get(id) || []) {
                const key = edgeIdentity(edge);
                if (!seenEdges.has(key)) {
                    collectedEdges.push(edge);
                    seenEdges.add(key);
                }

                const otherId = edge.from === id ? edge.to : edge.from;
                if (!visitedIds.has(otherId)) {
                    visitedIds.add(otherId);
                    nextFrontier.add(otherId);
                }
            }
        }
        frontier = nextFrontier;
    }

    return { nodeIds: visitedIds, edges: collectedEdges };
}

function mergePreparedNeighborhood(
    scopedNodes: Map<string, CascadingNode>,
    edges: CascadingEdge[],
    model: { nodeById: Map<string, CascadingNode> },
    neighborhood: { nodeIds: Set<string>; edges: CascadingEdge[] }
): void {
    neighborhood.nodeIds.forEach((id: string) => {
        const node = model.nodeById.get(id);
        if (node) scopedNodes.set(id, node);
    });
    edges.push(...neighborhood.edges);
}

function buildPermissionEdgesForModel(
    objectIds: Set<string>,
    scopedNodes: Map<string, CascadingNode>,
    roleObjectPermissions: any[],
    specificRoleId: string | null = null
): CascadingEdge[] {
    const syntheticEdges: CascadingEdge[] = [];
    const seen = new Set<string>();

    roleObjectPermissions.forEach(entry => {
        if (!objectIds.has(entry.objectId)) return;
        if (specificRoleId && entry.roleId !== specificRoleId) return;
        if (!entry.roleNode || !entry.objectNode) return;

        scopedNodes.set(entry.roleNode.id, entry.roleNode);
        scopedNodes.set(entry.objectNode.id, entry.objectNode);

        const key = `${entry.roleId}|${entry.objectId}`;
        if (seen.has(key)) return;
        seen.add(key);

        syntheticEdges.push({
            id: `permit_${entry.roleId}_${entry.objectId}`,
            from: entry.roleId,
            to: entry.objectId,
            type: 'PERMITS',
            permissions: entry.permissions,
            categories: entry.categories,
            actionTypes: entry.actionTypesRollup || [],
            permissionWeight: Math.max(1, (entry.permissions || []).length, (entry.actionTypesRollup || []).length),
            synthetic: true,
        });
    });

    return syntheticEdges;
}

function compareStatusRank(status: string | undefined): number {
    if (status === 'removed') return 4;
    if (status === 'added') return 3;
    if (status === 'changed') return 2;
    return 1;
}

function edgeIdentity(edge: CascadingEdge): string {
    return edge.id || `${edge.from}|${edge.to}|${edge.type}|${edge.ruleBindingType || ''}|${edge.associationKind || ''}`;
}

function syntheticPermissionDiffStatus(roleId: string, objectId: string): 'added' | 'removed' | 'changed' | undefined {
    const delta = compareState.result?.rolePermissionDeltas?.[roleId];
    if (!S.compareOverlay || !delta) return undefined;
    const touchesObject = (item: any) => item?.objectId === objectId;
    const added =
        delta.objectVerbs.added.some(touchesObject) ||
        delta.fieldPerms.added.some(touchesObject) ||
        delta.fieldOverrides.added.some(touchesObject);
    const removed =
        delta.objectVerbs.removed.some(touchesObject) ||
        delta.fieldPerms.removed.some(touchesObject) ||
        delta.fieldOverrides.removed.some(touchesObject);
    const changed = delta.fieldOverrides.changed.some((item: any) => item?.atom?.objectId === objectId);

    if (changed || (added && removed)) return 'changed';
    if (added) return 'added';
    if (removed) return 'removed';
    return undefined;
}
