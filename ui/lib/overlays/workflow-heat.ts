// Workflow heat overlay — tints nodes that have associated workflow definitions.
// Uses graph.meta.workflow.stats.byBaseObjectType to identify dense objects.

import { drilldownNodeCircleFill } from '../constants';
import { appState as S } from '../store';

export function buildWorkflowHeatMap(): Map<string, number> {
    const heat = new Map<string, number>();

    const byBase: Record<string, number> = S.dashboard?.workflow?.stats?.byBaseObjectType ?? {};
    const total = Object.values(byBase).reduce((a, v) => a + (v as number), 0) || 1;

    // Map workflow base object types to node IDs by matching node id / label
    S.allNodes.forEach(n => {
        if (n.type !== 'MDF_OBJECT') return;
        const nodeId = n.id as string;
        const label = (n.label ?? nodeId) as string;
        const count = byBase[nodeId] ?? byBase[label] ?? 0;
        if (count > 0) heat.set(nodeId, count / total);
    });

    return heat;
}

export function applyWorkflowHeatOverlay(heat: Map<string, number>) {
    const g = S.g;
    if (!g) return;

    const scale = (v: number) => `rgba(14, 116, 144, ${Math.min(0.85, 0.2 + v * 4)})`;

    // Only force-directed drilldown nodes carry datum on <circle>. Touching blueprint/rule
    // rects here breaks fills (child shapes have no datum; clearing fill → SVG default black).
    g.selectAll('.graph-node circle')
        .style('fill', (d: any) => {
            const h = heat.get(d?.id ?? '');
            return h ? scale(h) : drilldownNodeCircleFill(d);
        });

    g.selectAll('.graph-node')
        .classed('workflow-heat-node', (d: any) => heat.has(d?.id ?? ''));
}

export function clearWorkflowHeatOverlay() {
    const g = S.g;
    if (!g) return;
    g.selectAll('.graph-node circle').style('fill', (d: any) => drilldownNodeCircleFill(d));
    g.selectAll('.workflow-heat-node').classed('workflow-heat-node', false);
}
