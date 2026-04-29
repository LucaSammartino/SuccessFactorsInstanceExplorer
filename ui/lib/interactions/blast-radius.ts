// Blast radius BFS — computes N-hop downstream node set from a seed node.
// Works on the raw graph edges (S.allEdges + synthetic PERMITS from S.roleObjectPermissions).

import { appState as S } from '../store';
import type { AnyEdge } from '../types';

export interface BlastResult {
    nodeIds: Set<string>;
    edgeIds: Set<string>;
}

/** BFS following semantic edge directions. */
export function computeBlastRadius(seedId: string, hops = 2): BlastResult {
    const visitedNodes = new Set([seedId]);
    const visitedEdges = new Set<string>();
    let frontier = new Set([seedId]);

    for (let h = 0; h < hops; h++) {
        const next = new Set<string>();
        frontier.forEach(nodeId => {
            const nodeEdges: AnyEdge[] = S.edgesByNode.get(nodeId) ?? [];
            nodeEdges.forEach(e => {
                const eid = e.id ?? `${e.from}|${e.to}|${e.type}`;
                visitedEdges.add(eid);
                const otherId = e.from === nodeId ? e.to : e.from;
                if (typeof otherId !== 'string') return;
                if (!visitedNodes.has(otherId)) {
                    visitedNodes.add(otherId);
                    next.add(otherId);
                }
            });

            // Also follow synthetic PERMITS from roleObjectPermissions
            if (S.nodeById.get(nodeId)?.type === 'RBP_ROLE') {
                (S.roleObjectByRole.get(nodeId) ?? []).forEach(p => {
                    const objId = p.objectId as string;
                    if (!objId) return;
                    visitedEdges.add(`permit:${nodeId}:${objId}`);
                    if (!visitedNodes.has(objId)) {
                        visitedNodes.add(objId);
                        next.add(objId);
                    }
                });
            }
            if (S.nodeById.get(nodeId)?.type === 'MDF_OBJECT') {
                (S.roleObjectByObject.get(nodeId) ?? []).forEach(p => {
                    const roleId = p.roleId as string;
                    if (!roleId) return;
                    visitedEdges.add(`permit:${roleId}:${nodeId}`);
                    if (!visitedNodes.has(roleId)) {
                        visitedNodes.add(roleId);
                        next.add(roleId);
                    }
                });
            }
        });
        frontier = next;
    }

    return { nodeIds: visitedNodes, edgeIds: visitedEdges };
}

/** Apply blast-radius fade to a rendered SVG graph canvas. */
export function applyBlastRadiusFade(nodeIds: Set<string>) {
    const g = S.g;
    if (!g) return;

    g.selectAll('.graph-node, .suite-node, .bp-node, .rbp-node, .rl-node')
        .style('opacity', (d: any) => nodeIds.has(d?.id ?? d) ? 1 : 0.06);

    g.selectAll('path, line')
        .filter(function() {
            // Only fade edges not connecting blast nodes
            return true;
        })
        .attr('stroke-opacity', (e: any) => {
            if (!e) return 0.06;
            const from = e.from ?? e.source?.id ?? e.source;
            const to = e.to ?? e.target?.id ?? e.target;
            return (nodeIds.has(from) || nodeIds.has(to)) ? 0.85 : 0.04;
        });
}

/** Remove blast-radius fade (restore full opacity). */
export function clearBlastRadiusFade() {
    const g = S.g;
    if (!g) return;
    g.selectAll('.graph-node, .suite-node, .bp-node, .rbp-node, .rl-node')
        .style('opacity', 1);
    g.selectAll('path, line').attr('stroke-opacity', null);
}
