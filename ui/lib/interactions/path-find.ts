// Shortest path between two nodes via BFS weighted by edge type.
// Lower weight = preferred traversal.

import { appState as S } from '../store';

const EDGE_COSTS: Record<string, number> = {
    ASSOCIATION: 1,
    TRIGGERED_BY: 2,
    MODIFIES: 2,
    EXPOSES: 2,
    PERMITS: 3,
    GATEWAY: 4,
};

export interface PathResult {
    nodeIds: string[];
    edgeIds: string[];
    found: boolean;
}

export function findShortestPath(startId: string, endId: string): PathResult {
    if (startId === endId) return { nodeIds: [startId], edgeIds: [], found: true };

    // BFS with cost tracking
    const dist = new Map<string, number>([[startId, 0]]);
    const prev = new Map<string, { nodeId: string; edgeId: string }>();
    const queue: Array<{ id: string; cost: number }> = [{ id: startId, cost: 0 }];

    while (queue.length > 0) {
        queue.sort((a, b) => a.cost - b.cost);
        const { id: current, cost } = queue.shift()!;

        if (current === endId) break;

        const edges = S.edgesByNode.get(current) ?? [];
        for (const edge of edges) {
            const neighbor = edge.from === current ? edge.to as string : edge.from as string;
            const edgeCost = EDGE_COSTS[edge.type] ?? 2;
            const newCost = cost + edgeCost;

            if (!dist.has(neighbor) || newCost < dist.get(neighbor)!) {
                dist.set(neighbor, newCost);
                prev.set(neighbor, {
                    nodeId: current,
                    edgeId: edge.id ?? `${edge.from}|${edge.to}|${edge.type}`,
                });
                queue.push({ id: neighbor, cost: newCost });
            }
        }

        // PERMITS edges from roleObjectPermissions
        if (S.nodeById.get(current)?.type === 'RBP_ROLE') {
            (S.roleObjectByRole.get(current) ?? []).forEach(p => {
                const neighbor = p.objectId as string;
                const newCost = cost + EDGE_COSTS.PERMITS;
                if (!dist.has(neighbor) || newCost < dist.get(neighbor)!) {
                    dist.set(neighbor, newCost);
                    prev.set(neighbor, { nodeId: current, edgeId: `permit:${current}:${neighbor}` });
                    queue.push({ id: neighbor, cost: newCost });
                }
            });
        }
    }

    if (!prev.has(endId) && endId !== startId) {
        return { nodeIds: [], edgeIds: [], found: false };
    }

    // Reconstruct path
    const nodeIds: string[] = [];
    const edgeIds: string[] = [];
    let cur = endId;
    while (cur !== startId) {
        nodeIds.unshift(cur);
        const p = prev.get(cur)!;
        edgeIds.unshift(p.edgeId);
        cur = p.nodeId;
    }
    nodeIds.unshift(startId);

    return { nodeIds, edgeIds, found: true };
}

/** Highlight a path on the currently rendered graph. */
export function applyPathHighlight(nodeIds: string[], _edgeIds: string[]) {
    const g = S.g;
    if (!g) return;

    const pathSet = new Set(nodeIds);

    // Opacity + class on parent groups only — child rects/circles often have no datum;
    // setting stroke attr(null) on them stripped blueprint strokes and contributed to black fills.
    g.selectAll('.graph-node, .suite-node, .bp-node, .rbp-node, .rl-node')
        .style('opacity', (d: any) => pathSet.has(d?.id ?? d) ? 1 : 0.08)
        .classed('path-highlight', (d: any) => pathSet.has(d?.id ?? ''));

    g.selectAll('path, line').attr('stroke-opacity', (e: any) => {
        if (!e) return 0.04;
        const from = e.from ?? e.source?.id ?? e.source;
        const to = e.to ?? e.target?.id ?? e.target;
        return (pathSet.has(from) && pathSet.has(to)) ? 1 : 0.04;
    });
}

export function clearPathHighlight() {
    const g = S.g;
    if (!g) return;
    g.selectAll('.graph-node, .suite-node, .bp-node, .rbp-node, .rl-node')
        .style('opacity', 1)
        .classed('path-highlight', false);
    g.selectAll('path, line').attr('stroke-opacity', null);
}
