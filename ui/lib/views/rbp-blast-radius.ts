// RBP Blast Radius view — custom 4-band Sankey-like layout.
// Bands (left → right): Role → Module categories → Objects (top N) → Permission actions

import * as d3 from 'd3';
import { appState as S } from '../store';
import { NODE_COLORS, MODULE_CLUSTER_COLORS } from '../constants';
import { refreshMinimapForActiveCanvas } from '../render/minimap';
import { getActiveGraphCanvasHostId } from '../graph-canvas-host';
import { readGraphViewportSize } from '../layout/graph-viewport';
import type { GraphData, AnyNode, AnyEdge } from '../types';
import { truncateLabel } from '../utils';
import { getFocusedNodeIds, selectNode } from '../node-selection';
import { refreshWorkspace } from '../workspace';

const BAND_W = 160;
const BAND_PAD = 100;
const NODE_H = 38;
const NODE_W = 150;
const MAX_OBJECTS = 30;
const MAX_MODULES = 12;

// ── Scope builder ─────────────────────────────────────────────────────────────

export function buildRbpFlowScope(roleId?: string): GraphData {
    // Find a role to display
    const rid = roleId
        ?? getFocusedNodeIds().find(id => S.nodeById.get(id)?.type === 'RBP_ROLE');

    if (!rid) {
        return emptyRbpScope('Select a role from the list on the left to see its blast radius.');
    }

    const roleNode = S.nodeById.get(rid as string);
    if (!roleNode) return emptyRbpScope('Role not found');

    const perms = S.roleObjectByRole.get(rid as string) ?? [];

    // Band 1: Role node itself
    const nodes: AnyNode[] = [{ ...roleNode, _band: 0 }];
    const edges: AnyEdge[] = [];

    // Band 2: Module categories
    const byModule = new Map<string, number>();
    perms.forEach(p => {
        const mod = (p.objectNode?.moduleFamily as string) ?? 'Unclassified';
        byModule.set(mod, (byModule.get(mod) ?? 0) + 1);
    });

    const modules = Array.from(byModule.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_MODULES);

    modules.forEach(([mod, count]) => {
        const modId = `__rbp_mod_${mod}`;
        nodes.push({
            id: modId,
            type: 'MODULE_CLUSTER',
            label: mod,
            subtitle: `${count} objects`,
            moduleFamily: mod,
            _band: 1,
            permCount: count,
        });
        edges.push({
            id: `e_role_${mod}`,
            from: rid as string,
            to: modId,
            type: 'PERMITS',
            permissionWeight: count,
        });
    });

    // Band 3: Top objects
    const topObjects = perms
        .sort((a, b) => (b.permissions?.length ?? 0) - (a.permissions?.length ?? 0))
        .slice(0, MAX_OBJECTS);

    topObjects.forEach(p => {
        if (!p.objectNode) return;
        const objMod = (p.objectNode.moduleFamily as string) ?? 'Unclassified';
        const modId = `__rbp_mod_${objMod}`;
        const objId = p.objectNode.id as string;
        nodes.push({ ...p.objectNode, _band: 2 });
        edges.push({
            id: `e_mod_${objId}`,
            from: modId,
            to: objId,
            type: 'PERMITS',
            permissionWeight: p.permissions?.length ?? 1,
        });
    });

    const visibleDegree = new Map<string, number>();
    edges.forEach(e => {
        visibleDegree.set(e.from as string, (visibleDegree.get(e.from as string) ?? 0) + 1);
        visibleDegree.set(e.to as string, (visibleDegree.get(e.to as string) ?? 0) + 1);
    });

    return {
        scopeLabel: `RBP Flow: ${(roleNode.label ?? roleNode.id) as string}`,
        viewKind: 'rbp-flow',
        scopeKey: `rbp-flow:${rid}`,
        layoutPreset: 'static',
        nodes,
        edges,
        visibleDegree,
        visibleStats: new Map(),
        objectNodeCount: topObjects.length,
        componentByNodeId: new Map(),
        components: [],
        hiddenComponentCount: 0,
        hiddenLowSignalNodeCount: 0,
    };
}

function emptyRbpScope(label: string): GraphData {
    return {
        scopeLabel: label,
        viewKind: 'rbp-flow',
        scopeKey: 'rbp-flow:empty',
        layoutPreset: 'static',
        nodes: [],
        edges: [],
        visibleDegree: new Map(),
        visibleStats: new Map(),
        objectNodeCount: 0,
        componentByNodeId: new Map(),
        components: [],
        hiddenComponentCount: 0,
        hiddenLowSignalNodeCount: 0,
    };
}

// ── Static band-layout computation ───────────────────────────────────────────

function computeBandPositions(nodes: AnyNode[], width: number, height: number) {
    const byBand = new Map<number, AnyNode[]>();
    nodes.forEach(n => {
        const b = (n._band as number) ?? 1;
        if (!byBand.has(b)) byBand.set(b, []);
        byBand.get(b)!.push(n);
    });

    const bandCount = 3;
    const totalWidth = bandCount * BAND_W + (bandCount - 1) * BAND_PAD;
    const startX = (width - totalWidth) / 2 + BAND_W / 2;

    const positions = new Map<string, { x: number; y: number }>();

    for (let band = 0; band < bandCount; band++) {
        const bandNodes = byBand.get(band) ?? [];
        const bandX = startX + band * (BAND_W + BAND_PAD);
        const totalH = bandNodes.length * (NODE_H + 14);
        let startY = (height - totalH) / 2 + NODE_H / 2;
        bandNodes.forEach(n => {
            positions.set(n.id as string, { x: bandX, y: startY });
            startY += NODE_H + 14;
        });
    }

    return positions;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

export function renderRbpFlow(graphData: GraphData) {
    const hostId = getActiveGraphCanvasHostId();
    const container = document.getElementById(hostId);
    if (!container) return;
    container.innerHTML = '';

    if (graphData.nodes.length === 0) {
        container.innerHTML = '<div class="view-empty">No role selected or no permissions found. Select a role from the Roles view or RBP rail.</div>';
        return;
    }

    const { width, height } = readGraphViewportSize(container);
    const positions = computeBandPositions(graphData.nodes, width, height);

    const svg = d3.select(`#${hostId}`)
        .append('svg')
        .attr('width', '100%').attr('height', '100%')
        .attr('viewBox', `0 0 ${width} ${height}`);
    S.svg = svg as any;

    const g = svg.append('g');
    S.g = g as any;
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 4])
        .on('zoom', ev => {
            g.attr('transform', ev.transform);
            refreshMinimapForActiveCanvas();
        });
    svg.call(zoom);
    S.zoomBehavior = zoom;

    const bandMeta = [0, 1, 2].map(bandIndex => {
        const bandNodes = graphData.nodes.filter(n => (n._band as number) === bandIndex);
        const ys = bandNodes
            .map(n => positions.get(n.id as string)?.y)
            .filter((y): y is number => y != null);
        const minY = ys.length > 0 ? Math.min(...ys) : height / 2;
        const maxY = ys.length > 0 ? Math.max(...ys) : height / 2;
        const firstId = bandNodes[0]?.id as string;
        const x = firstId ? positions.get(firstId)?.x ?? 0 : 0;
        return { bandIndex, minY, maxY, x };
    });

    const guideGroup = g.append('g').attr('class', 'rbp-band-guides');
    const topPad = 12;
    const bottomPad = 16;
    bandMeta.forEach(({ minY, maxY, x }) => {
        if (!x) return;
        const y0 = Math.max(topPad, minY - 36);
        const y1 = Math.min(height - bottomPad, maxY + NODE_H / 2 + 12);
        guideGroup.append('line')
            .attr('x1', x).attr('x2', x)
            .attr('y1', y0).attr('y2', y1)
            .attr('stroke', 'rgba(11, 108, 242, 0.14)')
            .attr('stroke-width', 2)
            .attr('stroke-dasharray', '4 6');
    });

    const bandLabels = ['Role', 'Modules', 'Objects'];
    bandLabels.forEach((label, i) => {
        const m = bandMeta[i];
        if (!m?.x) return;
        const labelY = Math.max(18, Math.min(m.minY - 20, height - 40));
        g.append('text')
            .attr('x', m.x)
            .attr('y', labelY)
            .attr('class', 'rbp-band-header')
            .attr('text-anchor', 'middle')
            .text(label);
    });

    // Flow paths (cubic bezier between bands)
    const edgeGroup = g.append('g').attr('class', 'rbp-edges');
    edgeGroup.selectAll('path')
        .data(graphData.edges)
        .join('path')
        .attr('fill', 'none')
        .attr('stroke', '#be3b2b')
        .attr('stroke-width', (e: AnyEdge) => Math.max(1, Math.min(6, (e.permissionWeight as number ?? 1) * 0.4)))
        .attr('stroke-opacity', 0.35)
        .attr('d', (e: AnyEdge) => {
            const s = positions.get(e.from as string);
            const t = positions.get(e.to as string);
            if (!s || !t) return null;
            const cpX = (s.x + t.x) / 2;
            return `M${s.x + NODE_W / 2},${s.y} C${cpX},${s.y} ${cpX},${t.y} ${t.x - NODE_W / 2},${t.y}`;
        });

    // Nodes
    const nodeGroup = g.append('g').attr('class', 'rbp-nodes');
    const nodeGs = nodeGroup.selectAll<SVGGElement, AnyNode>('g')
        .data(graphData.nodes.filter(n => positions.has(n.id as string)))
        .join('g')
        .attr('class', 'rbp-node')
        .attr('transform', (n: AnyNode) => {
            const p = positions.get(n.id as string)!;
            return `translate(${p.x},${p.y})`;
        })
        .style('cursor', 'pointer')
        .on('click', (_ev, n: AnyNode) => {
            if (n.type === 'MDF_OBJECT') selectNode(n.id as string, { type: 'RBP_FLOW' });
            if (n.type === 'MODULE_CLUSTER' && n.moduleFamily) {
                S.currentModule = n.moduleFamily as string;
                S.currentViewKind = 'blueprint';
                refreshWorkspace();
            }
        })
        .on('mouseover', (_ev, n: AnyNode) => highlightFlow(n, nodeGs, edgeGroup, graphData, true))
        .on('mouseout', () => highlightFlow(null, nodeGs, edgeGroup, graphData, false));

    nodeGs.each(function(n: AnyNode) {
        const sel = d3.select(this);
        const isRole = n.type === 'RBP_ROLE';
        const fillColor = isRole ? NODE_COLORS.RBP_ROLE
            : n.type === 'MODULE_CLUSTER' ? (MODULE_CLUSTER_COLORS[(n.moduleFamily as string) ?? ''] ?? NODE_COLORS.MODULE_CLUSTER)
            : NODE_COLORS.MDF_OBJECT;

        sel.append('rect')
            .attr('x', -NODE_W / 2).attr('y', -NODE_H / 2)
            .attr('width', NODE_W).attr('height', NODE_H)
            .attr('rx', isRole ? 20 : 6)
            .attr('fill', fillColor)
            .attr('fill-opacity', isRole ? 0.18 : 0.1)
            .attr('stroke', fillColor)
            .attr('stroke-width', isRole ? 2.5 : 1.5);

        sel.append('text')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('class', 'rbp-node-label')
            .text(truncateLabel((n.label ?? n.id) as string, 20));

        if (n.subtitle) {
            sel.append('text')
                .attr('text-anchor', 'middle')
                .attr('y', NODE_H / 2 + 12)
                .attr('class', 'rbp-node-subtitle')
                .text(n.subtitle as string);
        }
    });
}

function highlightFlow(
    hovered: AnyNode | null,
    nodeGs: d3.Selection<SVGGElement, AnyNode, SVGGElement, unknown>,
    edgeGroup: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>,
    graphData: GraphData,
    entering: boolean,
) {
    if (!entering || !hovered) {
        nodeGs.selectAll('rect').attr('opacity', 1);
        nodeGs.selectAll('text').attr('opacity', 1);
        edgeGroup.selectAll('path').attr('stroke-opacity', 0.35);
        return;
    }
    const connIds = new Set([hovered.id as string]);
    graphData.edges.forEach((e: AnyEdge) => {
        if (e.from === hovered.id) connIds.add(e.to as string);
        if (e.to === hovered.id) connIds.add(e.from as string);
    });
    nodeGs.selectAll('rect').attr('opacity', (n: any) => connIds.has(n.id) ? 1 : 0.12);
    nodeGs.selectAll('text').attr('opacity', (n: any) => connIds.has(n.id) ? 1 : 0.06);
    edgeGroup.selectAll('path').attr('stroke-opacity',
        (e: any) => (connIds.has(e.from) || connIds.has(e.to)) ? 0.85 : 0.04
    );
}
