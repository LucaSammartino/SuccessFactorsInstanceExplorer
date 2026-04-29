// Module Blueprint view — deterministic 4-lane architecture layout.
// Columns: backbone-touching objects → module domain objects → rules/workflow → API facade.

import * as d3 from 'd3';
import { appState as S } from '../store';
import { NODE_COLORS, EDGE_STYLES } from '../constants';
import { refreshMinimapForActiveCanvas } from '../render/minimap';
import { getActiveGraphCanvasHostId } from '../graph-canvas-host';
import { readGraphViewportSize } from '../layout/graph-viewport';
import type { GraphData, AnyNode, AnyEdge } from '../types';
import { truncateLabel } from '../utils';
import { selectNode } from '../node-selection';

const NODE_W = 140;
const NODE_H = 44;
const RULE_W = 130;
const RULE_H = 36;
const MAX_DOMAIN_OBJECTS = 32;
const MAX_RULES = 18;

type BlueprintLaneDef = {
    col: number;
    label: string;
    accent: string;
    left: number;
    width: number;
    top: number;
    height: number;
};

// ── Scope builder ─────────────────────────────────────────────────────────────

export function buildBlueprintScope(moduleFamily: string): GraphData {
    if (!moduleFamily || moduleFamily === 'ALL') {
        return emptyBlueprint('Select a module to open its blueprint');
    }

    const moduleObjects = S.allNodes.filter(
        n => n.type === 'MDF_OBJECT' && n.moduleFamily === moduleFamily
    );

    if (moduleObjects.length === 0) {
        return emptyBlueprint(`${moduleFamily} — no objects found`);
    }

    const moduleObjectIds = new Set(moduleObjects.map(n => n.id));
    const nodes: AnyNode[] = [];
    const edges: AnyEdge[] = [];

    const backboneIds = new Set<string>();
    S.allEdges.forEach(e => {
        if (e.type !== 'ASSOCIATION') return;
        const fromInModule = moduleObjectIds.has(e.from as string);
        const toInModule = moduleObjectIds.has(e.to as string);
        const fromNode = S.nodeById.get(e.from as string);
        const toNode = S.nodeById.get(e.to as string);
        if (fromInModule && toNode?.objectClass === 'FOUNDATION') backboneIds.add(e.to as string);
        if (toInModule && fromNode?.objectClass === 'FOUNDATION') backboneIds.add(e.from as string);
    });

    const backboneObjects = Array.from(backboneIds)
        .map(id => S.nodeById.get(id))
        .filter(Boolean) as AnyNode[];
    backboneObjects
        .sort((a, b) =>
            String(a.foundationGroup ?? '').localeCompare(String(b.foundationGroup ?? ''))
            || String(a.label ?? a.id).localeCompare(String(b.label ?? b.id))
        )
        .forEach(n => nodes.push({ ...n, _col: 0 }));

    const domainObjects = [...moduleObjects]
        .sort((a, b) =>
            (S.edgesByNode.get(b.id as string)?.length ?? 0) - (S.edgesByNode.get(a.id as string)?.length ?? 0)
            || String(a.label ?? a.id).localeCompare(String(b.label ?? b.id))
        )
        .slice(0, MAX_DOMAIN_OBJECTS);
    const visibleModuleObjectIds = new Set(domainObjects.map(n => n.id as string));
    domainObjects.forEach(n => nodes.push({ ...n, _col: 1 }));

    const ruleIds = new Set<string>();
    const ruleEdges: AnyEdge[] = [];
    S.allEdges.forEach(e => {
        if (e.type !== 'TRIGGERED_BY' && e.type !== 'MODIFIES') return;
        const fromNode = S.nodeById.get(e.from as string);
        const toNode = S.nodeById.get(e.to as string);
        const ruleNode = fromNode?.type === 'BUSINESS_RULE'
            ? fromNode
            : toNode?.type === 'BUSINESS_RULE'
                ? toNode
                : null;
        const objectNode = fromNode?.type === 'MDF_OBJECT'
            ? fromNode
            : toNode?.type === 'MDF_OBJECT'
                ? toNode
                : null;
        if (!ruleNode || !objectNode || !visibleModuleObjectIds.has(objectNode.id as string)) return;
        ruleIds.add(ruleNode.id as string);
        ruleEdges.push(e);
    });

    const visibleRuleIds = new Set(
        Array.from(ruleIds)
            .sort((a, b) =>
                (S.edgesByNode.get(b)?.length ?? 0) - (S.edgesByNode.get(a)?.length ?? 0)
                || String(S.nodeById.get(a)?.label ?? a).localeCompare(String(S.nodeById.get(b)?.label ?? b))
            )
            .slice(0, MAX_RULES)
    );

    Array.from(visibleRuleIds)
        .map(id => S.nodeById.get(id))
        .filter(Boolean)
        .forEach(ruleNode => nodes.push({ ...(ruleNode as AnyNode), _col: 2 }));

    const odataForModule = S.allNodes.filter(
        n => n.type === 'ODATA_ENTITY' && n.moduleFamily === moduleFamily
    );
    const apiFacadeId = `__bp_api_${moduleFamily}`;
    if (odataForModule.length > 0) {
        nodes.push({
            id: apiFacadeId,
            type: 'API_FACADE',
            label: `${moduleFamily} API`,
            subtitle: `${odataForModule.length} OData entities`,
            _col: 3,
            odataCount: odataForModule.length,
        });
    }

    S.allEdges.forEach(e => {
        if (e.type !== 'ASSOCIATION') return;
        const fromBackbone = backboneIds.has(e.from as string) && visibleModuleObjectIds.has(e.to as string);
        const toBackbone = backboneIds.has(e.to as string) && visibleModuleObjectIds.has(e.from as string);
        if (fromBackbone || toBackbone) edges.push(e);
    });

    S.allEdges.forEach(e => {
        if (e.type !== 'ASSOCIATION') return;
        if (visibleModuleObjectIds.has(e.from as string) && visibleModuleObjectIds.has(e.to as string)) {
            edges.push(e);
        }
    });

    edges.push(...ruleEdges.filter(e => {
        const fromNode = S.nodeById.get(e.from as string);
        const toNode = S.nodeById.get(e.to as string);
        const ruleNode = fromNode?.type === 'BUSINESS_RULE'
            ? fromNode
            : toNode?.type === 'BUSINESS_RULE'
                ? toNode
                : null;
        const objectNode = fromNode?.type === 'MDF_OBJECT'
            ? fromNode
            : toNode?.type === 'MDF_OBJECT'
                ? toNode
                : null;
        return !!ruleNode && !!objectNode
            && visibleRuleIds.has(ruleNode.id as string)
            && visibleModuleObjectIds.has(objectNode.id as string);
    }));

    if (odataForModule.length > 0) {
        domainObjects.forEach(obj => {
            const hasOdata = S.allEdges.some(e =>
                e.type === 'EXPOSES'
                && (e.from === obj.id || e.to === obj.id)
                && odataForModule.some(od => od.id === e.from || od.id === e.to)
            );
            if (!hasOdata) return;
            edges.push({
                id: `__bp_exp_${obj.id}`,
                from: obj.id as string,
                to: apiFacadeId,
                type: 'EXPOSES_API',
            });
        });
    }

    const workflowTotal = S.dashboard?.workflow?.stats?.byBaseObjectType
        ? Object.values(S.dashboard.workflow.stats.byBaseObjectType as Record<string, number>)
            .reduce((sum: number, count) => sum + (count as number), 0)
        : 0;
    if (workflowTotal > 0) {
        nodes.push({
            id: `__bp_wf_${moduleFamily}`,
            type: 'ARCH_ANCHOR',
            label: 'Workflow Engine',
            subtitle: `${workflowTotal} workflow definitions`,
            anchorRole: 'workflow',
            _col: 2,
        });
    }

    const visibleDegree = new Map<string, number>();
    edges.forEach(e => {
        visibleDegree.set(e.from as string, (visibleDegree.get(e.from as string) ?? 0) + 1);
        visibleDegree.set(e.to as string, (visibleDegree.get(e.to as string) ?? 0) + 1);
    });

    return {
        scopeLabel: `${moduleFamily} Blueprint`,
        viewKind: 'blueprint',
        scopeKey: `blueprint:${moduleFamily}`,
        layoutPreset: 'static',
        nodes,
        edges,
        visibleDegree,
        visibleStats: new Map(),
        objectNodeCount: domainObjects.length,
        componentByNodeId: new Map(),
        components: [],
        hiddenComponentCount: 0,
        hiddenLowSignalNodeCount: Math.max(0, moduleObjects.length - domainObjects.length),
    };
}

function emptyBlueprint(label: string): GraphData {
    return {
        scopeLabel: label,
        viewKind: 'blueprint',
        scopeKey: 'blueprint:empty',
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

// ── Renderer ──────────────────────────────────────────────────────────────────

export function renderModuleBlueprint(graphData: GraphData) {
    const hostId = getActiveGraphCanvasHostId();
    const container = document.getElementById(hostId);
    if (!container) return;
    container.innerHTML = '';

    if (graphData.nodes.length === 0) {
        container.innerHTML = '<div class="view-empty">No data for this module.</div>';
        return;
    }

    const { width, height } = readGraphViewportSize(container);
    const { laneDefs, positions, contentBottom } = computeBlueprintLayout(graphData, width, height);
    const vbH = Math.max(height, contentBottom + 48);

    const svg = d3.select(`#${hostId}`)
        .append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('viewBox', `0 0 ${width} ${vbH}`);
    S.svg = svg as any;

    const g = svg.append('g');
    S.g = g as any;
    const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 4])
        .on('zoom', ev => {
            g.attr('transform', ev.transform);
            refreshMinimapForActiveCanvas();
        });
    svg.call(zoom);
    S.zoomBehavior = zoom;

    const laneGroup = g.append('g').attr('class', 'bp-lanes');
    laneGroup.selectAll('g')
        .data(laneDefs)
        .join('g')
        .each(function(lane) {
            const sel = d3.select(this);
            sel.append('rect')
                .attr('class', 'blueprint-lane-stripe')
                .attr('x', lane.left)
                .attr('y', lane.top + 6)
                .attr('width', 5)
                .attr('height', Math.max(0, lane.height - 12))
                .attr('rx', 3)
                .attr('fill', lane.accent)
                .attr('fill-opacity', 0.45);

            sel.append('rect')
                .attr('class', 'blueprint-lane-frame')
                .attr('x', lane.left)
                .attr('y', lane.top)
                .attr('width', lane.width)
                .attr('height', lane.height)
                .attr('rx', 20)
                .attr('fill', withAlpha(lane.accent, 0.05))
                .attr('stroke', withAlpha(lane.accent, 0.28))
                .attr('stroke-width', 1.6);

            sel.append('text')
                .attr('x', lane.left + lane.width / 2)
                .attr('y', lane.top + 26)
                .attr('class', 'blueprint-col-header')
                .text(lane.label);

            sel.append('text')
                .attr('x', lane.left + lane.width / 2)
                .attr('y', lane.top + 56)
                .attr('class', 'blueprint-col-subheader')
                .text('Nodes in this lane');
        });

    const edgeGroup = g.append('g').attr('class', 'bp-edges');
    edgeGroup.selectAll('path')
        .data(graphData.edges.filter(e => positions.has(e.from as string) && positions.has(e.to as string)))
        .join('path')
        .attr('fill', 'none')
        .attr('stroke', e => EDGE_STYLES[e.type]?.color ?? '#a5b4c7')
        .attr('stroke-width', e => EDGE_STYLES[e.type]?.width ?? 1.2)
        .attr('stroke-dasharray', e => EDGE_STYLES[e.type]?.dash ?? null)
        .attr('stroke-opacity', 0.35)
        .attr('d', (e: AnyEdge) => {
            const source = positions.get(e.from as string)!;
            const target = positions.get(e.to as string)!;
            const mx = (source.x + target.x) / 2;
            return `M${source.x},${source.y} C${mx},${source.y} ${mx},${target.y} ${target.x},${target.y}`;
        });

    const nodeGroup = g.append('g').attr('class', 'bp-nodes');
    const nodeGs = nodeGroup.selectAll<SVGGElement, AnyNode>('g')
        .data(graphData.nodes.filter(n => positions.has(n.id as string)))
        .join('g')
        .attr('class', 'bp-node')
        .attr('transform', (n: AnyNode) => {
            const position = positions.get(n.id as string)!;
            return `translate(${position.x},${position.y})`;
        })
        .style('cursor', 'pointer')
        .on('click', (_ev, n: AnyNode) => {
            if (n.type === 'MDF_OBJECT' || n.type === 'BUSINESS_RULE') {
                selectNode(n.id as string, { type: 'BLUEPRINT' });
            }
        })
        .on('mouseover', (_ev, n: AnyNode) => highlightBpNeighbors(n, nodeGs, edgeGroup, graphData, true))
        .on('mouseout', () => highlightBpNeighbors(null, nodeGs, edgeGroup, graphData, false));

    nodeGs.each(function(n: AnyNode) {
        const sel = d3.select(this);
        const widthPx = (n.type === 'BUSINESS_RULE' || n.type === 'ARCH_ANCHOR') ? RULE_W : NODE_W;
        const heightPx = (n.type === 'BUSINESS_RULE' || n.type === 'ARCH_ANCHOR') ? RULE_H : NODE_H;
        const isSelected = S.currentSelection?.nodeId === n.id;
        const fillColor = nodeColor(n);

        sel.append('rect')
            .attr('class', 'bp-node-face')
            .attr('x', -widthPx / 2)
            .attr('y', -heightPx / 2)
            .attr('width', widthPx)
            .attr('height', heightPx)
            .attr('rx', n.type === 'ARCH_ANCHOR' ? 16 : 10)
            .style('fill', withAlpha(fillColor, 0.15))
            .style('stroke', fillColor)
            .style('stroke-width', `${isSelected ? 2.5 : 1.5}px`);

        if (n.objectClass === 'FOUNDATION') {
            sel.append('rect')
                .attr('x', -widthPx / 2 - 2)
                .attr('y', -heightPx / 2 - 2)
                .attr('width', widthPx + 4)
                .attr('height', heightPx + 4)
                .attr('rx', 12)
                .attr('fill', 'none')
                .attr('stroke', '#0b6cf2')
                .attr('stroke-width', 1.4)
                .attr('stroke-dasharray', '4 2')
                .attr('stroke-opacity', 0.45);
        }

        sel.append('text')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('class', 'bp-node-label')
            .text(truncateLabel(String(n.label ?? n.id), n.type === 'API_FACADE' ? 20 : 18));

        if (n.subtitle && (n.type === 'API_FACADE' || n.type === 'ARCH_ANCHOR')) {
            sel.append('text')
                .attr('text-anchor', 'middle')
                .attr('y', heightPx / 2 + 12)
                .attr('class', 'bp-node-subtitle')
                .text(truncateLabel(String(n.subtitle), 32));
        }
    });
}

function blueprintNodeVerticalExtent(n: AnyNode): number {
    const h = (n.type === 'BUSINESS_RULE' || n.type === 'ARCH_ANCHOR') ? RULE_H : NODE_H;
    const sub = (n.subtitle && (n.type === 'API_FACADE' || n.type === 'ARCH_ANCHOR')) ? 18 : 0;
    return h + sub;
}

function computeBlueprintLayout(graphData: GraphData, width: number, height: number) {
    const gap = width >= 1600 ? 28 : 22;
    const laneWidths = width >= 1600
        ? [240, 560, 300, 240]
        : width >= 1280
            ? [220, 460, 280, 220]
            : [200, 360, 240, 200];
    const totalWidth = laneWidths.reduce((sum, laneWidth) => sum + laneWidth, 0) + gap * (laneWidths.length - 1);
    const startX = Math.max(28, (width - totalWidth) / 2);
    const laneTop = Math.max(48, height * 0.07);
    const minLaneFromViewport = Math.max(320, height - laneTop - 36);

    /** Header: title (y≈26) + subheader (y≈56) + gap before first row of nodes. */
    const LANE_HEADER = 72;
    const LANE_FOOTER = 36;

    const laneMetas = [0, 1, 2, 3].map(col => {
        const laneNodes = sortBlueprintNodes(
            graphData.nodes.filter(n => ((n._col as number) ?? 1) === col),
            graphData,
            col
        );
        const laneWidth = laneWidths[col];
        const left = startX + laneWidths.slice(0, col).reduce((s, w) => s + w, 0) + gap * col;
        const label =
            col === 0 ? 'Backbone'
                : col === 1 ? moduleLabel(graphData.scopeLabel)
                    : col === 2 ? 'Rules & Workflow'
                        : 'API Facade';
        const accent = col === 0 ? '#0b6cf2' : col === 1 ? '#2563eb' : col === 2 ? '#d97706' : '#0c8cab';

        if (laneNodes.length === 0) {
            return { col, label, accent, left, width: laneWidth, needHeight: minLaneFromViewport, laneNodes, columns: 1, rows: 0, rowGap: 66, maxExtent: NODE_H };
        }
        const columns = determineBlueprintColumns(col, laneWidth, laneNodes.length);
        const rows = Math.ceil(laneNodes.length / columns);
        const maxExtent = Math.max(...laneNodes.map(blueprintNodeVerticalExtent));
        const rowGap = Math.max(col === 2 ? 58 : 66, Math.ceil(maxExtent * 1.12));
        const stackH = rows > 0 ? (rows - 1) * rowGap + maxExtent : 0;
        const needHeight = LANE_HEADER + stackH + LANE_FOOTER;
        return { col, label, accent, left, width: laneWidth, needHeight, laneNodes, columns, rows, rowGap, maxExtent };
    });

    const laneHeight = Math.max(minLaneFromViewport, ...laneMetas.map(m => m.needHeight));

    const laneDefs: BlueprintLaneDef[] = laneMetas.map(m => ({
        col: m.col,
        label: m.label,
        accent: m.accent,
        left: m.left,
        width: m.width,
        top: laneTop,
        height: laneHeight,
    }));

    const positions = new Map<string, { x: number; y: number }>();
    laneMetas.forEach((meta, idx) => {
        const lane = laneDefs[idx];
        if (meta.laneNodes.length === 0) return;

        const { columns, rows, rowGap, maxExtent, laneNodes } = meta;
        const innerLeft = lane.left + 18;
        const innerTop = lane.top + LANE_HEADER;
        const innerWidth = lane.width - 36;
        const innerHeight = lane.height - LANE_HEADER - LANE_FOOTER;
        const cellWidth = innerWidth / columns;
        const stackH = (rows - 1) * rowGap + maxExtent;
        const firstY = innerTop + Math.max(0, (innerHeight - stackH) / 2) + maxExtent / 2;

        laneNodes.forEach((node, index) => {
            const colIndex = Math.floor(index / rows);
            const rowIndex = index % rows;
            positions.set(node.id as string, {
                x: innerLeft + cellWidth * (colIndex + 0.5),
                y: firstY + rowIndex * rowGap,
            });
        });
    });

    return { laneDefs, positions, contentBottom: laneTop + laneHeight };
}

function sortBlueprintNodes(nodes: AnyNode[], graphData: GraphData, col: number): AnyNode[] {
    return [...nodes].sort((a, b) => {
        if (col === 0) {
            return String(a.foundationGroup ?? '').localeCompare(String(b.foundationGroup ?? ''))
                || String(a.label ?? a.id).localeCompare(String(b.label ?? b.id));
        }
        if (col === 1 || col === 2) {
            return (graphData.visibleDegree.get(b.id as string) ?? 0) - (graphData.visibleDegree.get(a.id as string) ?? 0)
                || String(a.label ?? a.id).localeCompare(String(b.label ?? b.id));
        }
        return String(a.label ?? a.id).localeCompare(String(b.label ?? b.id));
    });
}

function determineBlueprintColumns(col: number, laneWidth: number, nodeCount: number): number {
    if (col === 1) {
        if (nodeCount > 24 && laneWidth >= 520) return 3;
        if (nodeCount > 12 && laneWidth >= 400) return 2;
    }
    if (col === 2 && nodeCount > 10 && laneWidth >= 260) return 2;
    return 1;
}

function nodeColor(n: AnyNode): string {
    if (n.type === 'API_FACADE') return NODE_COLORS.API_FACADE;
    if (n.type === 'ARCH_ANCHOR') return NODE_COLORS.ARCH_ANCHOR;
    if (n.objectClass === 'FOUNDATION') return '#0b6cf2';
    return NODE_COLORS[n.type as string] ?? '#7b8798';
}

function moduleLabel(scopeLabel: string): string {
    return scopeLabel.replace(' Blueprint', '') || 'Module';
}

function withAlpha(hex: string, alpha: number): string {
    if (!hex || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) {
        return `rgba(123, 135, 152, ${alpha})`;
    }
    const value = hex.replace('#', '');
    const normalized = value.length === 3
        ? value.split('').map(ch => `${ch}${ch}`).join('')
        : value;
    const intValue = Number.parseInt(normalized, 16);
    const r = (intValue >> 16) & 255;
    const g = (intValue >> 8) & 255;
    const b = intValue & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function highlightBpNeighbors(
    hovered: AnyNode | null,
    nodeGs: d3.Selection<SVGGElement, AnyNode, SVGGElement, unknown>,
    edgeGroup: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>,
    graphData: GraphData,
    entering: boolean,
) {
    if (!entering || !hovered) {
        nodeGs.style('opacity', 1);
        nodeGs.selectAll('text').attr('opacity', 1);
        edgeGroup.selectAll('path').attr('stroke-opacity', 0.35);
        return;
    }
    const connectedIds = new Set([hovered.id as string]);
    graphData.edges.forEach((e: AnyEdge) => {
        if (e.from === hovered.id) connectedIds.add(e.to as string);
        if (e.to === hovered.id) connectedIds.add(e.from as string);
    });
    nodeGs.style('opacity', (n: any) => (connectedIds.has(n.id) ? 1 : 0.18));
    nodeGs.selectAll('text').attr('opacity', (n: any) => (connectedIds.has(n.id) ? 1 : 0.16));
    edgeGroup.selectAll('path').attr('stroke-opacity',
        (e: any) => (connectedIds.has(e.from) || connectedIds.has(e.to)) ? 0.75 : 0.06
    );
}
