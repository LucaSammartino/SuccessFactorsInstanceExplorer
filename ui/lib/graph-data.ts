import { appState as S } from './store';
import { GATEWAY_THRESHOLD } from './constants';
import type {
    CascadingNode, CascadingEdge, ConnectedComponent, VisibleStatBucket, GraphData
} from './types';
import { truncateLabel, formatType } from './utils';
import { getFocusedNodeIds } from './node-selection';
import { shouldIncludeRoleLinks } from './view-helpers';
import { buildSuiteScope } from './views/suite-architecture';
import { buildBlueprintScope } from './views/module-blueprint';
import { buildRbpFlowScope } from './views/rbp-blast-radius';
import { applyCompareDiffTags, buildCompareScope } from './compare-scope';

export function buildGraphScope(): GraphData | null {
    if ((S.currentViewKind as string) === 'rule-lineage') {
        S.currentViewKind = 'suite';
    }
    // Route to specialised view builders first
    if (S.currentViewKind === 'suite') {
        if (!S.dashboard) return null;
        return buildSuiteScope();
    }

    if (S.currentViewKind === 'blueprint') {
        if (!S.dashboard) return null;
        return buildBlueprintScope(S.currentModule);
    }

    if (S.currentViewKind === 'rbp-flow') {
        const roleId = getFocusedNodeIds().find(id => S.nodeById.get(id)?.type === 'RBP_ROLE');
        return buildRbpFlowScope(roleId);
    }

    // drilldown: use existing scope logic
    return buildDrilldownScope();
}

/** Original scope-building logic, now isolated as drilldown. */
export function buildDrilldownScope(): GraphData | null {
    if (S.compareOverlay) {
        const overlayScope = buildCompareScope(S.compareOverlay.focusNodeId);
        if (overlayScope) {
            return finalizeScope(overlayScope.scopedNodes, overlayScope.edges, overlayScope.scopeLabel);
        }
    }

    const focusedIds = getFocusedNodeIds();
    if (focusedIds.length === 1) {
        return buildSelectionScope(focusedIds[0]);
    }
    if (focusedIds.length > 1) {
        return buildMultiSelectionScope(focusedIds);
    }

    if (S.currentView === 'RBP_ROLE') {
        const label = S.currentModule === 'ALL' ? 'All modules' : `${S.currentModule}${S.currentSubModule !== 'ALL' ? ' · ' + S.currentSubModule : ''} module`;
        return emptyRoleGraphScope(label);
    }

    if (S.currentModule !== 'ALL') {
        if (S.currentSubModule !== 'ALL') {
            return buildSubModuleScope(S.currentModule, S.currentSubModule);
        }
        return buildModuleScope(S.currentModule);
    }

    return buildGlobalScope();
}

export function isAggregateRolesPickState() {
    return S.currentView === 'RBP_ROLE' && getFocusedNodeIds().length === 0;
}

export function isPermissionMatrixMode() {
    return S.activeWorkspace === 'graph' && isAggregateRolesPickState();
}

export function buildGlobalScope() {
    const roleLinks = shouldIncludeRoleLinks();
    const scopeNodes = roleLinks ? S.allNodes : S.allNodes.filter(node => node.type !== 'RBP_ROLE');
    const scopedNodes = new Map(scopeNodes.map(node => [node.id, node]));
    let edges = S.allEdges.filter(edge => scopedNodes.has(edge.from) && scopedNodes.has(edge.to));

    if (roleLinks) {
        const objectIds = new Set(
            Array.from(scopedNodes.values())
                .filter(node => node.type === 'MDF_OBJECT')
                .map(node => node.id)
        );
        edges = edges.concat(buildPermissionEdges(objectIds, scopedNodes));
    }

    return finalizeScope(scopedNodes, edges, 'All modules');
}

export function buildSubModuleScope(moduleFamily: string, subModule: string) {
    const roleLinks = shouldIncludeRoleLinks();
    const inSubModule = S.allNodes.filter(node => node.moduleFamily === moduleFamily && node.subModule === subModule);
    const scopeNodes = roleLinks ? inSubModule : inSubModule.filter(node => node.type !== 'RBP_ROLE');
    const scopedNodes = new Map(scopeNodes.map(node => [node.id, node]));

    let edges = S.allEdges.filter(edge => scopedNodes.has(edge.from) && scopedNodes.has(edge.to));

    if (roleLinks) {
        const objectIds = new Set(
            Array.from(scopedNodes.values())
                .filter(node => node.type === 'MDF_OBJECT')
                .map(node => node.id)
        );
        edges = edges.concat(buildPermissionEdges(objectIds, scopedNodes));
    }

    return finalizeScope(scopedNodes, edges, `${moduleFamily} · ${subModule}`);
}

export function buildModuleScope(moduleFamily: string) {
    const roleLinks = shouldIncludeRoleLinks();
    const inModule = S.allNodes.filter(node => node.moduleFamily === moduleFamily);
    const scopeNodes = roleLinks ? inModule : inModule.filter(node => node.type !== 'RBP_ROLE');
    const scopedNodes = new Map(scopeNodes.map(node => [node.id, node]));

    let edges = S.allEdges.filter(edge => scopedNodes.has(edge.from) && scopedNodes.has(edge.to));

    if (roleLinks) {
        const objectIds = new Set(
            Array.from(scopedNodes.values())
                .filter(node => node.type === 'MDF_OBJECT')
                .map(node => node.id)
        );
        edges = edges.concat(buildPermissionEdges(objectIds, scopedNodes));
    }

    return finalizeScope(scopedNodes, edges, `${moduleFamily} module`);
}

export function buildSelectionScope(nodeId: string) {
    const scopedNodes = new Map<string, CascadingNode>();
    let edges: CascadingEdge[] = [];
    const seedNode = appendSelectionSeed(nodeId, scopedNodes, edges);
    if (!seedNode) return null;

    return finalizeScope(scopedNodes, edges, `${seedNode.label} focus`);
}

export function buildMultiSelectionScope(nodeIds: string[]) {
    const scopedNodes = new Map<string, CascadingNode>();
    let edges: CascadingEdge[] = [];
    const labels: string[] = [];

    nodeIds.forEach(nodeId => {
        const seedNode = appendSelectionSeed(nodeId, scopedNodes, edges);
        if (seedNode) labels.push((seedNode.label as string) || seedNode.id);
    });

    if (scopedNodes.size === 0) return null;
    const lead = labels.slice(0, 2).join(' + ');
    const suffix = labels.length > 2 ? ` +${labels.length - 2}` : '';
    return finalizeScope(scopedNodes, edges, `${lead}${suffix} focus`);
}

export function appendSelectionSeed(
    nodeId: string,
    scopedNodes: Map<string, CascadingNode>,
    edges: CascadingEdge[]
) {
    const seedNode = S.nodeById.get(nodeId);
    if (!seedNode) return null;

    scopedNodes.set(seedNode.id, seedNode);

    if (seedNode.type === 'RBP_ROLE') {
        const permissionEntries = S.roleObjectByRole.get(seedNode.id) ?? [];
        const objectIds = new Set<string>();

        permissionEntries.forEach(entry => {
            scopedNodes.set(entry.objectNode.id, entry.objectNode);
            objectIds.add(entry.objectNode.id);
        });

        edges.push(...buildPermissionEdges(objectIds, scopedNodes, seedNode.id));
        const neighborhood = collectNeighborhood(Array.from(objectIds), 1);
        mergeScope(scopedNodes, edges, neighborhood);
    } else {
        const neighborhood = collectNeighborhood([seedNode.id], 1);
        mergeScope(scopedNodes, edges, neighborhood);

        if (seedNode.type === 'MDF_OBJECT') {
            edges.push(...buildPermissionEdges(new Set([seedNode.id]), scopedNodes));
        }
    }

    return seedNode;
}

export function collectNeighborhood(seedIds: string[], depth = 1): { nodeIds: Set<string>; edges: CascadingEdge[] } {
    const visitedIds = new Set(seedIds);
    const collectedEdges: CascadingEdge[] = [];
    const seenEdges = new Set();
    let frontier = new Set<string>(seedIds);

    for (let step = 0; step < depth; step++) {
        const nextFrontier = new Set<string>();
        for (const id of frontier) {
            for (const edge of S.edgesByNode.get(id) ?? []) {
                const key = edge.id || `${edge.from}|${edge.to}|${edge.type}|${edge.ruleBindingType || ''}|${edge.associationKind || ''}`;
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

export function buildPermissionEdges(
    objectIds: Set<string>,
    scopedNodes: Map<string, CascadingNode>,
    specificRoleId: string | null = null
): CascadingEdge[] {
    const syntheticEdges: CascadingEdge[] = [];
    const seen = new Set();

    S.roleObjectPermissions.forEach(entry => {
        if (!objectIds.has(entry.objectId)) return;
        if (specificRoleId && entry.roleId !== specificRoleId) return;

        const roleNode = S.nodeById.get(entry.roleId);
        const objectNode = S.nodeById.get(entry.objectId);
        if (!roleNode || !objectNode) return;

        scopedNodes.set(roleNode.id, roleNode);
        scopedNodes.set(objectNode.id, objectNode);

        const key = `${entry.roleId}|${entry.objectId}`;
        if (seen.has(key)) return;
        seen.add(key);

        syntheticEdges.push({
            id: `permit_${seen.size}`,
            from: entry.roleId,
            to: entry.objectId,
            type: 'PERMITS',
            permissions: entry.permissions,
            categories: entry.categories,
            actionTypes: entry.actionTypesRollup ?? [],
            permissionWeight: Math.max(1, (entry.permissions ?? []).length, (entry.actionTypesRollup ?? []).length),
            synthetic: true
        });
    });

    return syntheticEdges;
}

export function buildPermissionEdgesForRoles(
    roleIdSet: Set<string>,
    scopedNodes: Map<string, CascadingNode>
): CascadingEdge[] {
    const syntheticEdges: CascadingEdge[] = [];
    const seen = new Set();

    S.roleObjectPermissions.forEach(entry => {
        if (!roleIdSet.has(entry.roleId)) return;

        const roleNode = S.nodeById.get(entry.roleId);
        const objectNode = S.nodeById.get(entry.objectId);
        if (!roleNode || !objectNode) return;

        scopedNodes.set(roleNode.id, roleNode);
        scopedNodes.set(objectNode.id, objectNode);

        const key = `${entry.roleId}|${entry.objectId}`;
        if (seen.has(key)) return;
        seen.add(key);

        syntheticEdges.push({
            id: `permit_r_${syntheticEdges.length}`,
            from: entry.roleId,
            to: entry.objectId,
            type: 'PERMITS',
            permissions: entry.permissions,
            categories: entry.categories,
            actionTypes: entry.actionTypesRollup ?? [],
            permissionWeight: Math.max(1, (entry.permissions ?? []).length, (entry.actionTypesRollup ?? []).length),
            synthetic: true
        });
    });

    return syntheticEdges;
}

export function emptyRoleGraphScope(scopePrefix: string): GraphData {
    return {
        scopeLabel: `${scopePrefix} · Roles`,
        nodes: [],
        edges: [],
        visibleDegree: new Map(),
        visibleStats: new Map(),
        objectNodeCount: 0,
        componentByNodeId: new Map(),
        components: [],
        hiddenComponentCount: 0,
        hiddenLowSignalNodeCount: 0
    };
}

export function friendlyGatewayName(childType: string) {
    if (childType === 'BUSINESS_RULE') return 'Business Rules';
    if (childType === 'RBP_ROLE') return 'Access Roles';
    if (childType === 'MDF_OBJECT') return 'Child Objects';
    return childType;
}

export function transformToCascadingModel(nodes: CascadingNode[], edges: CascadingEdge[]) {
    if (!nodes.length) return { nodes, edges };

    const edgesFrom = new Map<string, CascadingEdge[]>();
    const edgesTo   = new Map<string, CascadingEdge[]>();
    edges.forEach((e: CascadingEdge) => {
        if (!edgesFrom.has(e.from)) edgesFrom.set(e.from, []);
        edgesFrom.get(e.from)!.push(e);
        if (!edgesTo.has(e.to)) edgesTo.set(e.to, []);
        edgesTo.get(e.to)!.push(e);
    });

    const sourceNodeById = new Map(nodes.map(n => [n.id, n]));
    const outputNodeIds = new Set(nodes.map(n => n.id));
    const edgeIndicesToRemove = new Set<number>();
    const edgeIndexByRef = new Map<CascadingEdge, number>();
    const extraNodes: CascadingNode[] = [];
    const extraEdges: CascadingEdge[] = [];
    const parentUpdates = new Map<string, Record<string, number>>();
    const collapsedRuleIds = new Set<string>();

    edges.forEach((edge, index) => {
        edgeIndexByRef.set(edge, index);
    });

    const isBusinessRuleEdge = (edge: CascadingEdge) =>
        edge.type === 'TRIGGERED_BY' || edge.type === 'MODIFIES';

    const connectedBusinessRuleId = (parentId: string, edge: CascadingEdge) => {
        const otherId = edge.from === parentId ? edge.to : edge.to === parentId ? edge.from : null;
        return otherId && sourceNodeById.get(otherId)?.type === 'BUSINESS_RULE' ? otherId : null;
    };

    nodes.forEach(parentNode => {
        const parentId = parentNode.id;
        const outgoingEdges = edgesFrom.get(parentId) ?? [];
        const incomingEdges = edgesTo.get(parentId) ?? [];
        const incident = [...outgoingEdges, ...incomingEdges];

        const groups: {
            childType: string;
            candidates: CascadingEdge[];
            childIdFn: (e: CascadingEdge) => string;
        }[] = [];

        if (parentNode.type !== 'BUSINESS_RULE' && parentNode.type !== 'GATEWAY_NODE' && parentNode.type !== 'RBP_ROLE') {
            groups.push({
                childType: 'BUSINESS_RULE',
                candidates: incident.filter(edge => isBusinessRuleEdge(edge) && Boolean(connectedBusinessRuleId(parentId, edge))),
                childIdFn: (edge: CascadingEdge) => connectedBusinessRuleId(parentId, edge)!
            });
        }

        if (parentNode.type === 'MDF_OBJECT') {
            groups.push({
                childType: 'RBP_ROLE',
                candidates: incomingEdges.filter(edge =>
                    edge.type === 'PERMITS' &&
                    sourceNodeById.get(edge.from)?.type === 'RBP_ROLE'
                ),
                childIdFn: (edge: CascadingEdge) => edge.from
            });

            groups.push({
                childType: 'MDF_OBJECT',
                candidates: outgoingEdges.filter(edge =>
                    edge.type === 'ASSOCIATION' &&
                    sourceNodeById.get(edge.to)?.type === 'MDF_OBJECT' &&
                    edge.to !== parentId
                ),
                childIdFn: (edge: CascadingEdge) => edge.to
            });
        }

        const patch: Record<string, number> = {};

        groups.forEach(({ childType, candidates, childIdFn }) => {
            const childIds    = [...new Set(candidates.map(childIdFn))];
            if (childIds.length < GATEWAY_THRESHOLD) return;

            const gatewayId   = `gw_${childType}_${parentId}`;
            const isExpanded  = S.gatewayState.get(gatewayId) ?? false;
            const friendly    = friendlyGatewayName(childType);
            const labelSuffix = isExpanded ? '· tap to collapse' : '· tap to expand';

            extraNodes.push({
                id:          gatewayId,
                type:        'GATEWAY_NODE',
                gatewayType: childType,
                parentId,
                childIds,
                isExpanded,
                label:       `${childIds.length} ${friendly} ${labelSuffix}`
            });

            extraEdges.push({
                id:          `edge_gw_${childType}_${parentId}`,
                from:        parentId,
                to:          gatewayId,
                type:        'GATEWAY',
                gatewayType: childType
            });

            candidates.forEach(edge => {
                const edgeIndex = edgeIndexByRef.get(edge);
                if (edgeIndex !== undefined) edgeIndicesToRemove.add(edgeIndex);
            });

            if (isExpanded) {
                childIds.forEach(childId => {
                    extraEdges.push({
                        id:          `edge_gw_${childType}_${parentId}_${childId}`,
                        from:        gatewayId,
                        to:          childId,
                        type:        'GATEWAY',
                        gatewayType: childType
                    });
                });
            } else {
                childIds.forEach(childId => {
                    if (childType === 'BUSINESS_RULE') {
                        collapsedRuleIds.add(childId);
                    } else {
                        outputNodeIds.delete(childId);
                    }
                });
            }

            if (childType === 'BUSINESS_RULE') patch._collapsedRuleCount = childIds.length;
            if (childType === 'RBP_ROLE')      patch._collapsedRoleCount = childIds.length;
            if (childType === 'MDF_OBJECT')     patch._collapsedChildCount = childIds.length;
        });

        if (Object.keys(patch).length > 0) {
            patch._collapsedTotal =
                (patch._collapsedRuleCount  ?? 0) +
                (patch._collapsedRoleCount  ?? 0) +
                (patch._collapsedChildCount ?? 0);
            parentUpdates.set(parentId, patch);
        }
    });

    const outEdges = edges.filter((_, i) => !edgeIndicesToRemove.has(i));
    outEdges.push(...extraEdges);

    const collapsedRulesWithRemainingEdges = new Set<string>();
    outEdges.forEach(edge => {
        if (collapsedRuleIds.has(edge.from)) collapsedRulesWithRemainingEdges.add(edge.from);
        if (collapsedRuleIds.has(edge.to)) collapsedRulesWithRemainingEdges.add(edge.to);
    });

    collapsedRuleIds.forEach(childId => {
        if (!collapsedRulesWithRemainingEdges.has(childId)) {
            outputNodeIds.delete(childId);
        }
    });

    const outNodes = nodes
        .filter(n => outputNodeIds.has(n.id))
        .map(n => parentUpdates.has(n.id) ? { ...n, ...parentUpdates.get(n.id) } : n);
    outNodes.push(...extraNodes);

    const outNodeIds = new Set(outNodes.map(n => n.id));
    const safeEdges = outEdges.filter(e => outNodeIds.has(e.from) && outNodeIds.has(e.to));

    return { nodes: outNodes, edges: safeEdges };
}

export function finalizeScope(scopedNodes: Map<string, CascadingNode>, scopeEdges: CascadingEdge[], scopeLabel: string): GraphData {
    const edgeKeySet = new Set();
    const dedupedEdges: CascadingEdge[] = [];

    scopeEdges.forEach(edge => {
        const key = edge.id || `${edge.from}|${edge.to}|${edge.type}|${edge.ruleBindingType || ''}|${edge.associationKind || ''}`;
        if (edgeKeySet.has(key)) return;
        if (!scopedNodes.has(edge.from) || !scopedNodes.has(edge.to)) return;
        edgeKeySet.add(key);
        dedupedEdges.push(edge);
    });

    let nodes = Array.from(scopedNodes.values());
    let edges = dedupedEdges;

    const objectClassFiltered = applyObjectClassFilter(nodes, edges);
    nodes = objectClassFiltered.nodes;
    edges = objectClassFiltered.edges;

    if (S.currentView !== 'all') {
        const filtered = filterByType(nodes, edges, S.currentView);
        nodes = filtered.nodes;
        edges = filtered.edges;
    }

    const cascaded = transformToCascadingModel(nodes, edges);
    nodes = cascaded.nodes;
    edges = cascaded.edges;

    const rawComponents = buildConnectedComponents(nodes, edges);
    const protectedNodeIds = new Set([S.currentSelection?.nodeId, ...getFocusedNodeIds()].filter(Boolean));
    const hiddenComponentIds = new Set();
    const hiddenNodeIds = new Set();

    if (!S.showIsolated) {
        const allowedNodeIds = new Set();

        rawComponents.forEach(component => {
            const componentHasProtectedNode = component.nodeIds.some(nodeId => protectedNodeIds.has(nodeId));
            const keepComponent = componentHasProtectedNode || component.nodeIds.length >= 4;

            if (keepComponent) {
                component.nodeIds.forEach(nodeId => allowedNodeIds.add(nodeId));
            } else {
                hiddenComponentIds.add(component.id);
                component.nodeIds.forEach(nodeId => hiddenNodeIds.add(nodeId));
            }
        });

        nodes = nodes.filter(node => allowedNodeIds.has(node.id));
        edges = edges.filter(edge => allowedNodeIds.has(edge.from) && allowedNodeIds.has(edge.to));
    }

    const visibleDegree = new Map();
    edges.forEach(edge => {
        visibleDegree.set(edge.from, (visibleDegree.get(edge.from) ?? 0) + 1);
        visibleDegree.set(edge.to, (visibleDegree.get(edge.to) ?? 0) + 1);
    });

    const visibleComponents = buildConnectedComponents(nodes, edges);
    const componentByNodeId = new Map<string, string>();
    visibleComponents.forEach(component => {
        component.nodeIds.forEach(nodeId => componentByNodeId.set(nodeId, component.id));
    });
    const visibleStats = buildVisibleNodeStats(nodes, edges);
    applyCompareDiffTags(nodes, edges);

    return {
        scopeLabel,
        nodes,
        edges,
        visibleDegree,
        visibleStats,
        objectNodeCount: nodes.filter(node => node.type === 'MDF_OBJECT').length,
        componentByNodeId,
        components: visibleComponents,
        hiddenComponentCount: hiddenComponentIds.size,
        hiddenLowSignalNodeCount: hiddenNodeIds.size
    };
}

export function applyObjectClassFilter(nodes: CascadingNode[], edges: CascadingEdge[]) {
    if (S.currentObjectClass === 'ALL_OBJECTS') {
        return { nodes, edges };
    }

    const allowedObjectIds = new Set(
        nodes
            .filter(node => node.type === 'MDF_OBJECT' && (node.objectClass || 'MDF') === S.currentObjectClass)
            .map(node => node.id)
    );

    const filteredNodes = nodes.filter(node => node.type !== 'MDF_OBJECT' || allowedObjectIds.has(node.id));
    const filteredNodeIds = new Set(filteredNodes.map(node => node.id));
    const filteredEdges = edges.filter(edge => filteredNodeIds.has(edge.from) && filteredNodeIds.has(edge.to));

    return {
        nodes: filteredNodes,
        edges: filteredEdges
    };
}

export function filterByType(nodes: CascadingNode[], edges: CascadingEdge[], type: string) {
    const primaryIds = new Set();

    edges.forEach(edge => {
        if (S.nodeById.get(edge.from)?.type === type) primaryIds.add(edge.from);
        if (S.nodeById.get(edge.to)?.type === type) primaryIds.add(edge.to);
    });

    getFocusedNodeIds().forEach(nodeId => {
        if (S.nodeById.get(nodeId)?.type === type) primaryIds.add(nodeId);
    });

    if (primaryIds.size === 0) {
        return { nodes: [], edges: [] };
    }

    const visibleIds = new Set(primaryIds);
    edges.forEach(edge => {
        if (primaryIds.has(edge.from) || primaryIds.has(edge.to)) {
            visibleIds.add(edge.from);
            visibleIds.add(edge.to);
        }
    });

    return {
        nodes: nodes.filter(node => visibleIds.has(node.id)),
        edges: edges.filter(edge => visibleIds.has(edge.from) && visibleIds.has(edge.to))
    };
}

export function mergeScope(
    scopedNodes: Map<string, CascadingNode>,
    edges: CascadingEdge[],
    neighborhood: { nodeIds: Set<string>; edges: CascadingEdge[] }
) {
    neighborhood.nodeIds.forEach((id: string) => {
        const node = S.nodeById.get(id);
        if (node) scopedNodes.set(id, node);
    });
    edges.push(...neighborhood.edges);
}

export function buildConnectedComponents(nodes: CascadingNode[], edges: CascadingEdge[]): ConnectedComponent[] {
    const nodeIds = nodes.map(node => node.id);
    const adjacency = new Map<string, Set<string>>(nodeIds.map(nodeId => [nodeId, new Set<string>()]));

    edges.forEach(edge => {
        if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
        if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set());
        adjacency.get(edge.from)!.add(edge.to);
        adjacency.get(edge.to)!.add(edge.from);
    });

    const visited = new Set<string>();
    const components: ConnectedComponent[] = [];
    let componentIndex = 0;

    for (const nodeId of adjacency.keys()) {
        if (visited.has(nodeId)) continue;
        const queue = [nodeId];
        const componentNodeIds: string[] = [];
        visited.add(nodeId);

        while (queue.length > 0) {
            const current = queue.shift()!;
            componentNodeIds.push(current);
            for (const neighbor of adjacency.get(current) ?? []) {
                if (visited.has(neighbor)) continue;
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }

        const nodeIdSet = new Set(componentNodeIds);
        const componentEdges = edges.filter(edge => nodeIdSet.has(edge.from) && nodeIdSet.has(edge.to));
        components.push({
            id: `component_${componentIndex++}`,
            nodeIds: componentNodeIds,
            edgeIds: componentEdges.map(edge => edge.id || `${edge.from}|${edge.to}|${edge.type}`),
            edgeCount: componentEdges.length
        });
    }

    return components.sort((left, right) => right.nodeIds.length - left.nodeIds.length || right.edgeCount - left.edgeCount);
}

export function buildVisibleNodeStats(nodes: CascadingNode[], edges: CascadingEdge[]) {
    const visibleNodeIds = new Set(nodes.map(node => node.id));
    const stats = new Map<string, VisibleStatBucket>(
        nodes.map(node => [
            node.id,
            {
                degree: 0,
                weightedDegree: 0,
                MDF_OBJECT: 0,
                BUSINESS_RULE: 0,
                RBP_ROLE: 0,
                ODATA_ENTITY: 0,
                associationCount: 0,
                ruleCount: 0,
                permissionCount: 0,
                exposureCount: 0
            }
        ])
    );

    function bump(nodeId: string, otherId: string, edge: CascadingEdge) {
        if (!visibleNodeIds.has(nodeId)) return;
        const bucket = stats.get(nodeId);
        const otherNode = S.nodeById.get(otherId);
        if (!bucket || !otherNode) return;

        bucket.degree += 1;
        if ((bucket as any)[otherNode.type] != null) (bucket as any)[otherNode.type] += 1;
        if (edge.type === 'ASSOCIATION') bucket.associationCount += 1;
        if (['TRIGGERED_BY', 'MODIFIES'].includes(edge.type)) bucket.ruleCount += 1;
        if (edge.type === 'PERMITS') bucket.permissionCount += 1;
        if (edge.type === 'EXPOSES') bucket.exposureCount += 1;
    }

    edges.forEach(edge => {
        bump(edge.from, edge.to, edge);
        bump(edge.to, edge.from, edge);
    });

    stats.forEach(bucket => {
        bucket.weightedDegree = (
            bucket.degree +
            (bucket.MDF_OBJECT * 1.15) +
            (bucket.BUSINESS_RULE * 1.4) +
            (bucket.RBP_ROLE * 1.2) +
            (bucket.ODATA_ENTITY * 0.95)
        );
    });

    return stats;
}

export function computeHubLabel(
    nodeId: string,
    visibleStats: Map<string, VisibleStatBucket>
): { title: string; subtitle: string } {
    const stats = visibleStats?.get(nodeId);
    const node = S.nodeById.get(nodeId);
    const label = String((node as any)?.label ?? nodeId);
    if (!stats) return { title: label, subtitle: '' };

    const parts: string[] = [];
    if (stats.MDF_OBJECT > 0) parts.push(`${stats.MDF_OBJECT} objects`);
    if (stats.BUSINESS_RULE > 0) parts.push(`${stats.BUSINESS_RULE} rules`);
    if (stats.RBP_ROLE > 0) parts.push(`${stats.RBP_ROLE} roles`);
    if (stats.ODATA_ENTITY > 0) parts.push(`${stats.ODATA_ENTITY} OData`);

    return {
        title: truncateLabel(label, 42),
        subtitle: parts.slice(0, 2).join(' · ')
    };
}

export function buildNodeLabelLines(
    node: CascadingNode,
    visibleStats: Map<string, VisibleStatBucket>,
    hubIds: Set<string>,
    showLabels: boolean
) : string[] {
    if (node.type === 'GATEWAY_NODE') {
        const gw = node as any;
        const childCount = Array.isArray(gw.childIds) ? gw.childIds.length : 0;
        return [`${(gw.label as string) || `${childCount} ${friendlyGatewayName(String(gw.gatewayType || ''))}`}`];
    }

    const stats = visibleStats?.get(node.id);

    if (S.currentSelection?.nodeId === node.id) {
        return [
            truncateLabel(node.label || node.id, 42),
            `${formatType(node.type)} · ${stats?.degree ?? 0} visible links`
        ];
    }

    if (hubIds.has(node.id)) {
        const hubLabel = computeHubLabel(node.id, visibleStats);
        return [hubLabel.title, hubLabel.subtitle || `${stats?.degree ?? 0} visible links`];
    }

    if (showLabels) {
        return [truncateLabel(node.label || node.id, 28)];
    }

    return [];
}

export function buildHoverLabelLines(
    node: CascadingNode,
    visibleStats: Map<string, VisibleStatBucket>,
    hubIds: Set<string>
) : string[] {
    const stats = visibleStats?.get(node.id);
    if (hubIds.has(node.id)) {
        const hubLabel = computeHubLabel(node.id, visibleStats);
        return [hubLabel.title, hubLabel.subtitle || `${stats?.degree ?? 0} visible links`];
    }
    return [
        truncateLabel(node.label || node.id, 28),
        `${formatType(node.type)} · ${stats?.degree ?? 0} links`
    ];
}

export function updateNodeTextLabels(
    textSelection: any,
    visibleStats: Map<string, VisibleStatBucket>,
    hubIds: Set<string>,
    showLabels: boolean,
    highlightedIds: Set<string> | null = null
) {
    const _buildNodeLabelLines = buildNodeLabelLines;
    const _buildHoverLabelLines = buildHoverLabelLines;
    textSelection.each(function updateNodeText(this: Element, d: any) {
        const text = d3.select(this);
        const lines = highlightedIds?.has(d.id)
            ? _buildHoverLabelLines(d, visibleStats, hubIds)
            : _buildNodeLabelLines(d, visibleStats, hubIds, showLabels);

        text.selectAll('tspan').remove();
        lines.forEach((line, index) => {
            text.append('tspan')
                .attr('x', 0)
                .attr('dy', index === 0 ? 0 : '1.15em')
                .text(line);
        });
    });
}

import * as d3 from 'd3';

const HUB_COUNT_MIN = 3;
const HUB_COUNT_MAX = 15;
const HUB_NODE_RATIO = 0.05;
const HUB_WEIGHT_FLOOR = 4;
const GATEWAY_RADIUS_MIN = 10;
const GATEWAY_RADIUS_MAX = 22;
const GATEWAY_RADIUS_BASE = 8;
const GATEWAY_CHILD_RADIUS_SCALE = 2;
const NODE_RADIUS_MIN = 6;
const NODE_RADIUS_MAX = 34;
const NODE_RADIUS_WEIGHT_SCALE = 3.2;
const NODE_RADIUS_HUB_SCALE = 1.1;
const COLLAPSED_NODE_RADIUS_SCALE = 1.5;

export function buildHubSet(visibleStats: Map<string, VisibleStatBucket>, nodeCount: number): Set<string> {
    const entries = [...visibleStats.entries()].sort((l, r) => r[1].weightedDegree - l[1].weightedDegree);
    const hubCount = Math.min(HUB_COUNT_MAX, Math.max(HUB_COUNT_MIN, Math.floor(nodeCount * HUB_NODE_RATIO)));
    const hubThreshold = entries.length > hubCount
        ? (entries[hubCount - 1]?.[1]?.weightedDegree ?? HUB_WEIGHT_FLOOR)
        : HUB_WEIGHT_FLOOR;
    return new Set(
        entries
            .filter(([, stats]) => stats.weightedDegree >= Math.max(HUB_WEIGHT_FLOOR, hubThreshold))
            .slice(0, hubCount)
            .map(([id]) => id)
    );
}

export function makeNodeRadiusFn(
    visibleStats: Map<string, VisibleStatBucket>,
    degreeMap: Map<string, number>,
    hubIds: Set<string>,
    baseExtra = 0
): (d: any) => number {
    return (d: any) => {
        if (d.type === 'GATEWAY_NODE') {
            const childRadius = GATEWAY_RADIUS_BASE + Math.sqrt(d.childIds?.length ?? 0) * GATEWAY_CHILD_RADIUS_SCALE;
            return Math.max(GATEWAY_RADIUS_MIN, Math.min(GATEWAY_RADIUS_MAX, childRadius));
        }
        const stats = visibleStats.get(d.id);
        const collapsedBonus = d._collapsedTotal ? Math.sqrt(d._collapsedTotal) * COLLAPSED_NODE_RADIUS_SCALE : 0;
        const weightedDegree = (stats?.weightedDegree ?? degreeMap.get(d.id) ?? 0) + collapsedBonus;
        const radiusBase = NODE_RADIUS_MIN + baseExtra;
        const hubScale = hubIds.has(d.id) ? NODE_RADIUS_HUB_SCALE : 1;
        const radius = (radiusBase + Math.sqrt(weightedDegree) * NODE_RADIUS_WEIGHT_SCALE) * hubScale;
        return Math.max(radiusBase, Math.min(NODE_RADIUS_MAX, radius));
    };
}
