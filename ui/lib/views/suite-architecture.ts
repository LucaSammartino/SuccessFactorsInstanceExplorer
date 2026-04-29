// Suite Architecture view — deterministic architecture board layout.
// Foundation metadata sits in the middle, business modules stay in a stable top band,
// and cross-cutting capabilities occupy fixed lower/side bands.

import * as d3 from 'd3';
import { appState as S } from '../store';
import { NODE_COLORS, MODULE_CLUSTER_COLORS, EDGE_STYLES } from '../constants';
import type { GraphData, AnyNode, AnyEdge } from '../types';
import { escapeHtml } from '../utils';
import { refreshMinimapForActiveCanvas } from '../render/minimap';
import { getActiveGraphCanvasHostId } from '../graph-canvas-host';
import { readGraphViewportSize } from '../layout/graph-viewport';
import { selectNode } from '../node-selection';
import { refreshWorkspace, setActiveWorkspace } from '../workspace';

type SuiteBand = {
    id: string;
    label: string;
    accent: string;
    x: number;
    y: number;
    width: number;
    height: number;
};

type ModuleFamilySummary = {
    family: string;
    nodeCount: number;
    objectCount: number;
    ruleCount: number;
    roleCount: number;
};

const SUITE_BACKBONE_ID = '__suite_backbone';
const SUITE_PLATFORM_ID = '__suite_platform';
const SUITE_UNCLASSIFIED_ID = '__suite_unclassified';

function normalizeFamily(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function isUnclassifiedFamily(value: unknown): boolean {
    const normalized = normalizeFamily(value).toLowerCase();
    return normalized === '' || normalized === 'unclassified' || normalized === '(unclassified)';
}

function deriveBackboneFamily(families: ModuleFamilySummary[]): string | null {
    const familyScores = new Map<string, number>();
    const familyStats = new Map(families.map(family => [family.family, family]));

    S.allEdges.forEach(edge => {
        if (edge.type !== 'ASSOCIATION') return;
        const fromNode = S.nodeById.get(edge.from as string);
        const toNode = S.nodeById.get(edge.to as string);
        if (!fromNode || !toNode) return;

        if (fromNode.type === 'MDF_OBJECT' && fromNode.objectClass === 'FOUNDATION') {
            const family = normalizeFamily(toNode.moduleFamily);
            if (family && !isUnclassifiedFamily(family)) {
                familyScores.set(family, (familyScores.get(family) ?? 0) + 1);
            }
        }
        if (toNode.type === 'MDF_OBJECT' && toNode.objectClass === 'FOUNDATION') {
            const family = normalizeFamily(fromNode.moduleFamily);
            if (family && !isUnclassifiedFamily(family)) {
                familyScores.set(family, (familyScores.get(family) ?? 0) + 1);
            }
        }
    });

    const ranked = Array.from(familyScores.entries()).sort((a, b) => {
        const familyA = familyStats.get(a[0]);
        const familyB = familyStats.get(b[0]);
        return b[1] - a[1]
            || Number(familyB?.objectCount ?? 0) - Number(familyA?.objectCount ?? 0)
            || Number(familyB?.nodeCount ?? 0) - Number(familyA?.nodeCount ?? 0)
            || a[0].localeCompare(b[0]);
    });

    return ranked[0]?.[0] ?? null;
}

// ── Scope builder ─────────────────────────────────────────────────────────────

export function buildSuiteScope(): GraphData {
    const dashboard = S.dashboard;
    const families: ModuleFamilySummary[] =
        dashboard?.stats?.moduleBreakdown?.families ?? [];

    const nodes: AnyNode[] = [];
    const edges: AnyEdge[] = [];

    const foundationNodes = S.allNodes.filter(n =>
        n.type === 'MDF_OBJECT' && n.objectClass === 'FOUNDATION'
    );
    const foundationCount = foundationNodes.length;
    const orgFoundationCount = foundationNodes.filter(n =>
        typeof n.foundationGroup === 'string'
        && (n.foundationGroup.includes('Organizational') || n.foundationGroup.includes('Position') || n.foundationGroup.includes('Job'))
    ).length;
    const backboneFamily = deriveBackboneFamily(families);

    nodes.push({
        id: SUITE_BACKBONE_ID,
        type: 'ARCH_ANCHOR',
        label: 'Foundation Backbone',
        subtitle: backboneFamily
            ? `${orgFoundationCount} org / position objects · ${foundationCount} foundation total · primary module ${backboneFamily}`
            : `${orgFoundationCount} org / position objects · ${foundationCount} foundation total`,
        anchorRole: 'backbone',
        moduleFamily: backboneFamily ?? undefined,
        objectCount: foundationCount,
    });

    nodes.push({
        id: SUITE_PLATFORM_ID,
        type: 'ARCH_ANCHOR',
        label: 'Platform Services',
        subtitle: 'Shared extensibility, admin surfaces, and configuration',
        anchorRole: 'platform',
    });
    edges.push({ id: 'e_platform_backbone', from: SUITE_PLATFORM_ID, to: SUITE_BACKBONE_ID, type: 'EXTENDS' });

    const odataCount = S.allNodes.filter(n => n.type === 'ODATA_ENTITY').length;
    const apiFacadeId = '__suite_api_facade';
    nodes.push({
        id: apiFacadeId,
        type: 'API_FACADE',
        label: 'Integration & APIs',
        subtitle: `${odataCount} OData entities`,
        anchorRole: 'api',
        odataCount,
    });
    edges.push({ id: 'e_api_backbone', from: SUITE_BACKBONE_ID, to: apiFacadeId, type: 'EXPOSES_API' });

    const roleCount = S.allNodes.filter(n => n.type === 'RBP_ROLE').length;
    const secAnchorId = '__suite_rbp';
    nodes.push({
        id: secAnchorId,
        type: 'ARCH_ANCHOR',
        label: 'Role-Based Permissions',
        subtitle: `${roleCount} roles · ${S.roleObjectPermissions.length.toLocaleString()} permission rows`,
        anchorRole: 'security',
        roleCount,
    });
    edges.push({ id: 'e_rbp_backbone', from: secAnchorId, to: SUITE_BACKBONE_ID, type: 'SECURES' });

    const workflowCount = dashboard?.workflow?.summary?.workflowCount ?? 0;
    const wfAnchorId = '__suite_workflow';
    nodes.push({
        id: wfAnchorId,
        type: 'ARCH_ANCHOR',
        label: 'Workflow Engine',
        subtitle: `${workflowCount} definitions`,
        anchorRole: 'workflow',
        workflowCount,
    });
    edges.push({ id: 'e_wf_backbone', from: wfAnchorId, to: SUITE_BACKBONE_ID, type: 'BACKBONE_SUPPORTS' });

    const uiAnchorId = '__suite_ui_surfaces';
    nodes.push({
        id: uiAnchorId,
        type: 'ARCH_ANCHOR',
        label: 'Admin Center\nPeople Profile',
        subtitle: 'Cross-suite UI surfaces',
        anchorRole: 'ui-surface',
    });
    edges.push({ id: 'e_ui_platform', from: uiAnchorId, to: SUITE_PLATFORM_ID, type: 'EXTENDS' });

    families
        .filter(f => !isUnclassifiedFamily(f.family))
        .sort((a, b) => b.objectCount - a.objectCount || a.family.localeCompare(b.family))
        .forEach(f => {
            const clusterId = `__suite_cluster_${f.family}`;
            nodes.push({
                id: clusterId,
                type: 'MODULE_CLUSTER',
                label: f.family,
                subtitle: `${f.objectCount} objects · ${f.ruleCount} rules · ${f.roleCount} roles`,
                moduleFamily: f.family,
                nodeCount: f.nodeCount,
                objectCount: f.objectCount,
                ruleCount: f.ruleCount,
                roleCount: f.roleCount,
            });
            edges.push({ id: `e_backbone_${f.family}`, from: SUITE_BACKBONE_ID, to: clusterId, type: 'BACKBONE_SUPPORTS' });
            edges.push({ id: `e_platform_${f.family}`, from: SUITE_PLATFORM_ID, to: clusterId, type: 'EXTENDS' });
        });

    const unclassifiedCount = S.allNodes.filter(n => isUnclassifiedFamily(n.moduleFamily)).length;
    if (unclassifiedCount > 0) {
        nodes.push({
            id: SUITE_UNCLASSIFIED_ID,
            type: 'MODULE_CLUSTER',
            label: 'Classification Gaps',
            subtitle: `${unclassifiedCount} nodes · taxonomy debt`,
            moduleFamily: 'Unclassified',
            nodeCount: unclassifiedCount,
            isDebtBucket: true,
        });
        edges.push({ id: 'e_debt_platform', from: SUITE_UNCLASSIFIED_ID, to: SUITE_PLATFORM_ID, type: 'EXTENDS' });
    }

    const visibleDegree = new Map<string, number>();
    edges.forEach(e => {
        visibleDegree.set(e.from, (visibleDegree.get(e.from) ?? 0) + 1);
        visibleDegree.set(e.to, (visibleDegree.get(e.to) ?? 0) + 1);
    });

    return {
        scopeLabel: 'Suite Architecture',
        viewKind: 'suite',
        scopeKey: 'suite',
        layoutPreset: 'static',
        nodes,
        edges,
        visibleDegree,
        visibleStats: new Map(),
        objectNodeCount: foundationCount,
        componentByNodeId: new Map(),
        components: [],
        hiddenComponentCount: 0,
        hiddenLowSignalNodeCount: 0,
    };
}

// ── Static layout computation ─────────────────────────────────────────────────

/** Space from band top to first row of module cards (title + gap, no overlap). */
const MODULE_BAND_HEADER = 48;
const MODULE_BAND_FOOTER = 28;
/** Room above a node center for band title + padding (single-node / crosscut bands). */
const SINGLE_NODE_TITLE_CLEARANCE = 40;
/** Distance from bottom of module band to horizontal centerline of spine nodes. */
const SPINE_CENTER_GAP_BELOW_MODULES = 120;
const CROSSCUT_GAP_BELOW_SPINE = 88;
const BAND_PAD_X = 20;
const BAND_PAD_Y_BOTTOM = 20;

function suiteNodeSize(node: AnyNode) {
    if (node.anchorRole === 'backbone') return { width: 240, height: 96, radius: 20 };
    if (node.type === 'MODULE_CLUSTER' && !node.isDebtBucket) return { width: 188, height: 76, radius: 16 };
    if (node.type === 'MODULE_CLUSTER' && node.isDebtBucket) return { width: 172, height: 64, radius: 16 };
    if (node.type === 'API_FACADE') return { width: 184, height: 72, radius: 16 };
    return { width: 184, height: 72, radius: 18 };
}

function suiteNodeVisualBBox(node: AnyNode, pos: { x: number; y: number }) {
    const { width: w, height: h } = suiteNodeSize(node);
    const labelLines = String(node.label ?? '').split('\n').length;
    const subtitleExtra = node.subtitle ? (labelLines > 1 ? 22 : 14) : 0;
    const top = pos.y - h / 2;
    const bottom = pos.y + h / 2 + subtitleExtra;
    return { left: pos.x - w / 2, right: pos.x + w / 2, top, bottom };
}

function computeSuiteLayout(nodes: AnyNode[], width: number, height: number) {
    const cx = Math.max(width / 2, 600);
    const safeWidth = Math.max(width, 1200);

    const positions = new Map<string, { x: number; y: number }>();
    const bands: SuiteBand[] = [];

    const bandTop = 50;

    const moduleNodes = nodes
        .filter(n => n.type === 'MODULE_CLUSTER' && !n.isDebtBucket)
        .sort((a, b) =>
            Number(b.objectCount ?? 0) - Number(a.objectCount ?? 0)
            || String(a.label ?? a.id).localeCompare(String(b.label ?? b.id))
        );

    const moduleCols = Math.max(3, Math.min(5, Math.floor((safeWidth - 100) / 214)));
    const moduleCardW = 188;
    const moduleCardH = 76;
    const moduleGapX = 26;
    const moduleGapY = 24;
    const moduleRows = Math.max(1, Math.ceil(moduleNodes.length / moduleCols));
    const gridWidth = moduleCols * moduleCardW + (moduleCols - 1) * moduleGapX;

    const gridLeft = cx - gridWidth / 2 + moduleCardW / 2;
    const modulesTop = bandTop + MODULE_BAND_HEADER + moduleCardH / 2;

    moduleNodes.forEach((node, index) => {
        const col = index % moduleCols;
        const row = Math.floor(index / moduleCols);
        positions.set(node.id as string, {
            x: gridLeft + col * (moduleCardW + moduleGapX),
            y: modulesTop + row * (moduleCardH + moduleGapY),
        });
    });

    const modulesGridH = moduleRows * moduleCardH + Math.max(0, moduleRows - 1) * moduleGapY;
    const modulesBandHeight = MODULE_BAND_HEADER + modulesGridH + MODULE_BAND_FOOTER;
    const modulesBand: SuiteBand = {
        id: 'modules',
        label: 'Business Modules',
        accent: '#64748b',
        x: cx - gridWidth / 2 - 32,
        y: bandTop,
        width: gridWidth + 64,
        height: modulesBandHeight,
    };
    bands.push(modulesBand);

    const spineSpread = 360;
    const middleY = bandTop + modulesBandHeight + SPINE_CENTER_GAP_BELOW_MODULES;

    positions.set(SUITE_PLATFORM_ID, { x: cx - spineSpread, y: middleY });
    positions.set(SUITE_BACKBONE_ID, { x: cx, y: middleY });
    positions.set('__suite_api_facade', { x: cx + spineSpread, y: middleY });

    const spineMeta: { id: string; label: string; accent: string; nodeId: string; width: number }[] = [
        { id: 'platform', label: 'Platform / Extensibility', accent: '#0b6cf2', nodeId: SUITE_PLATFORM_ID, width: 280 },
        { id: 'backbone', label: 'Foundation Backbone', accent: '#1d4ed8', nodeId: SUITE_BACKBONE_ID, width: 300 },
        { id: 'integration', label: 'Integration Layer', accent: '#0c8cab', nodeId: '__suite_api_facade', width: 280 },
    ];
    for (const s of spineMeta) {
        const pos = positions.get(s.nodeId)!;
        const node = nodes.find(n => n.id === s.nodeId)!;
        const vb = suiteNodeVisualBBox(node, pos);
        const h = SINGLE_NODE_TITLE_CLEARANCE + (vb.bottom - vb.top) + BAND_PAD_Y_BOTTOM;
        bands.push({
            id: s.id,
            label: s.label,
            accent: s.accent,
            x: pos.x - s.width / 2,
            y: vb.top - SINGLE_NODE_TITLE_CLEARANCE,
            width: s.width,
            height: h,
        });
    }

    const crosscutSpread = 320;
    const spineBottom = Math.max(...spineMeta.map(s => {
        const b = bands.find(bd => bd.id === s.id)!;
        return b.y + b.height;
    }));
    const crosscutY = spineBottom + CROSSCUT_GAP_BELOW_SPINE + 36;

    positions.set('__suite_rbp', { x: cx - crosscutSpread, y: crosscutY });
    positions.set('__suite_ui_surfaces', { x: cx, y: crosscutY + 20 });
    positions.set('__suite_workflow', { x: cx + crosscutSpread, y: crosscutY });

    const crosscutMemberIds = ['__suite_rbp', '__suite_ui_surfaces', '__suite_workflow'] as const;
    const hasUnclassified = nodes.some(n => n.id === SUITE_UNCLASSIFIED_ID);
    if (hasUnclassified) {
        positions.set(SUITE_UNCLASSIFIED_ID, { x: cx + crosscutSpread + 200, y: crosscutY + 56 });
    }

    let crossMinX = Infinity;
    let crossMaxX = -Infinity;
    let crossMinY = Infinity;
    let crossMaxY = -Infinity;
    const expandFor = (id: string) => {
        const pos = positions.get(id);
        const node = nodes.find(n => n.id === id);
        if (!pos || !node) return;
        const vb = suiteNodeVisualBBox(node, pos);
        crossMinX = Math.min(crossMinX, vb.left);
        crossMaxX = Math.max(crossMaxX, vb.right);
        crossMinY = Math.min(crossMinY, vb.top);
        crossMaxY = Math.max(crossMaxY, vb.bottom);
    };
    crosscutMemberIds.forEach(expandFor);
    if (hasUnclassified) expandFor(SUITE_UNCLASSIFIED_ID);

    const crossTitleH = 36;
    const crossPad = 18;
    bands.push({
        id: 'crosscut',
        label: 'Security / Workflow / Experience',
        accent: '#475569',
        x: crossMinX - BAND_PAD_X - crossPad,
        y: crossMinY - crossTitleH - crossPad,
        width: crossMaxX - crossMinX + 2 * (BAND_PAD_X + crossPad),
        height: crossMaxY - crossMinY + crossTitleH + 2 * crossPad + BAND_PAD_Y_BOTTOM,
    });

    return { positions, bands };
}

function suiteLayoutExtent(
    bands: SuiteBand[],
    positions: Map<string, { x: number; y: number }>,
    nodes: AnyNode[],
): { width: number; height: number } {
    let maxX = 0;
    let maxY = 0;
    for (const b of bands) {
        maxX = Math.max(maxX, b.x + b.width);
        maxY = Math.max(maxY, b.y + b.height);
    }
    for (const n of nodes) {
        const p = positions.get(n.id as string);
        if (!p) continue;
        const vb = suiteNodeVisualBBox(n, p);
        maxX = Math.max(maxX, vb.right + 32);
        maxY = Math.max(maxY, vb.bottom + 32);
    }
    return { width: maxX, height: maxY };
}

// ── Renderer ──────────────────────────────────────────────────────────────────

export function renderSuiteArchitecture(graphData: GraphData) {
    const hostId = getActiveGraphCanvasHostId();
    const container = document.getElementById(hostId);
    if (!container) return;
    container.innerHTML = '';

    const { width, height } = readGraphViewportSize(container);
    const { positions, bands } = computeSuiteLayout(graphData.nodes, width, height);
    const extent = suiteLayoutExtent(bands, positions, graphData.nodes);
    const vbW = Math.max(width, extent.width + 40);
    const vbH = Math.max(height, extent.height + 40);

    const svg = d3.select(`#${hostId}`)
        .append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('viewBox', `0 0 ${vbW} ${vbH}`);

    S.svg = svg as any;
    const g = svg.append('g');
    S.g = g as any;

    const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 3])
        .on('zoom', ev => {
            g.attr('transform', ev.transform);
            refreshMinimapForActiveCanvas();
        });
    svg.call(zoom);
    S.zoomBehavior = zoom;

    const bandGroup = g.append('g').attr('class', 'suite-bands');
    bandGroup.selectAll('g')
        .data(bands)
        .join('g')
        .each(function(band) {
            const sel = d3.select(this);
            sel.append('rect')
                .attr('class', 'suite-band-frame')
                .attr('x', band.x)
                .attr('y', band.y)
                .attr('width', band.width)
                .attr('height', band.height)
                .attr('rx', 24)
                .attr('fill', withAlpha(band.accent, 0.045))
                .attr('stroke', withAlpha(band.accent, 0.14))
                .attr('stroke-width', 1.2);
            sel.append('text')
                .attr('x', band.x + 18)
                .attr('y', band.y + 26)
                .attr('class', 'suite-band-title')
                .text(band.label);
        });

    const edgeGroup = g.append('g').attr('class', 'suite-edges');
    edgeGroup.selectAll('path')
        .data(graphData.edges.filter(e => positions.has(e.from as string) && positions.has(e.to as string)))
        .join('path')
        .attr('fill', 'none')
        .attr('stroke', e => EDGE_STYLES[e.type]?.color ?? '#a5b4c7')
        .attr('stroke-width', e => EDGE_STYLES[e.type]?.width ?? 1.2)
        .attr('stroke-dasharray', e => EDGE_STYLES[e.type]?.dash ?? null)
        .attr('stroke-opacity', 0.28)
        .attr('d', (e: AnyEdge) => {
            const source = positions.get(e.from as string)!;
            const target = positions.get(e.to as string)!;
            const dx = target.x - source.x;
            const curve = Math.max(28, Math.min(84, Math.abs(dx) * 0.16));
            const mx = (source.x + target.x) / 2;
            return `M${source.x},${source.y} C${mx - curve},${source.y} ${mx + curve},${target.y} ${target.x},${target.y}`;
        });

    const nodeGroup = g.append('g').attr('class', 'suite-nodes');
    const nodeGs = nodeGroup.selectAll<SVGGElement, AnyNode>('g')
        .data(graphData.nodes.filter(n => positions.has(n.id as string)))
        .join('g')
        .attr('class', 'suite-node')
        .attr('transform', (n: AnyNode) => {
            const position = positions.get(n.id as string)!;
            return `translate(${position.x},${position.y})`;
        })
        .style('cursor', 'pointer')
        .on('click', (_ev: MouseEvent, n: AnyNode) => handleSuiteNodeClick(n))
        .on('mouseover', (_ev: MouseEvent, n: AnyNode) => handleSuiteHover(n, nodeGs, edgeGroup, graphData, true))
        .on('mouseout', () => handleSuiteHover(null, nodeGs, edgeGroup, graphData, false));

    nodeGs.each(function(n: AnyNode) {
        const sel = d3.select(this);
        const { width: boxWidth, height: boxHeight, radius } = suiteNodeSize(n);
        const isCluster = n.type === 'MODULE_CLUSTER' && !n.isDebtBucket;
        const isDebt = Boolean(n.isDebtBucket);
        const isBackbone = n.anchorRole === 'backbone';
        const fillColor = isDebt
            ? '#64748b'
            : isCluster
                ? (MODULE_CLUSTER_COLORS[(n.moduleFamily as string) ?? ''] ?? NODE_COLORS.MODULE_CLUSTER)
                : (n.type === 'API_FACADE' ? NODE_COLORS.API_FACADE : NODE_COLORS.ARCH_ANCHOR);

        sel.append('rect')
            .attr('x', -boxWidth / 2)
            .attr('y', -boxHeight / 2)
            .attr('width', boxWidth)
            .attr('height', boxHeight)
            .attr('rx', radius)
            .attr('fill', withAlpha(fillColor, isBackbone ? 0.12 : 0.1))
            .attr('stroke', fillColor)
            .attr('stroke-width', isBackbone ? 2.6 : 1.8);

        sel.append('rect')
            .attr('x', -boxWidth / 2)
            .attr('y', -boxHeight / 2)
            .attr('width', boxWidth)
            .attr('height', 8)
            .attr('rx', radius)
            .attr('fill', withAlpha(fillColor, 0.85))
            .attr('stroke', 'none');

        const labelLines = String(n.label ?? '').split('\n');
        const title = sel.append('text')
            .attr('text-anchor', 'middle')
            .attr('y', n.subtitle ? -8 : 0)
            .attr('class', 'suite-node-label');

        labelLines.forEach((line, index) => {
            title.append('tspan')
                .attr('x', 0)
                .attr('dy', index === 0 ? 0 : '1.15em')
                .text(line);
        });

        if (n.subtitle) {
            sel.append('text')
                .attr('text-anchor', 'middle')
                .attr('y', labelLines.length > 1 ? 26 : 18)
                .attr('class', 'suite-node-subtitle')
                .text(truncateSubtitle(String(n.subtitle), isBackbone ? 42 : 34));
        }

        if (isBackbone) {
            sel.append('rect')
                .attr('x', boxWidth / 2 - 60)
                .attr('y', -boxHeight / 2 + 14)
                .attr('width', 46)
                .attr('height', 22)
                .attr('rx', 11)
                .attr('fill', withAlpha('#0b6cf2', 0.12))
                .attr('stroke', withAlpha('#0b6cf2', 0.25));
            sel.append('text')
                .attr('x', boxWidth / 2 - 37)
                .attr('y', -boxHeight / 2 + 29)
                .attr('class', 'suite-backbone-count')
                .text(String(n.objectCount ?? 0));
        }
    });
}

function handleSuiteNodeClick(n: AnyNode) {
    if (n.type === 'MODULE_CLUSTER' && n.moduleFamily && !isUnclassifiedFamily(n.moduleFamily)) {
        S.currentModule = n.moduleFamily as string;
        S.currentSubModule = 'ALL';
        S.currentViewKind = 'blueprint';
        refreshWorkspace();
        return;
    }
    if (n.anchorRole === 'backbone') {
        const targetFamily = normalizeFamily(n.moduleFamily);
        if (targetFamily && !isUnclassifiedFamily(targetFamily)) {
            S.currentModule = targetFamily;
            S.currentSubModule = 'ALL';
            S.currentViewKind = 'blueprint';
        } else {
            S.currentModule = 'ALL';
            S.currentSubModule = 'ALL';
            S.currentViewKind = 'drilldown';
        }
        refreshWorkspace();
        return;
    }
    if (n.anchorRole === 'platform' && normalizeFamily(n.moduleFamily) && !isUnclassifiedFamily(n.moduleFamily)) {
        S.currentModule = String(n.moduleFamily);
        S.currentSubModule = 'ALL';
        S.currentViewKind = 'blueprint';
        refreshWorkspace();
        return;
    }
    if (n.id === '__suite_rbp') {
        setActiveWorkspace('rbp-flow');
        return;
    }
    if (n.type === 'MODULE_CLUSTER' && n.isDebtBucket) {
        S.currentViewKind = 'drilldown';
        refreshWorkspace();
        return;
    }
    const t = String(n.type || '');
    if (
        n.id &&
        !String(n.id).startsWith('__suite') &&
        (t === 'BUSINESS_RULE' || t === 'MDF_OBJECT' || t === 'RBP_ROLE' || t === 'ODATA_ENTITY')
    ) {
        selectNode(String(n.id), { type: 'GRAPH', fromSearch: false });
    }
}

function handleSuiteHover(
    hoveredNode: AnyNode | null,
    nodeGs: d3.Selection<SVGGElement, AnyNode, SVGGElement, unknown>,
    edgeGroup: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>,
    graphData: GraphData,
    entering: boolean
) {
    if (!entering || !hoveredNode) {
        nodeGs.selectAll('rect').attr('opacity', 1);
        nodeGs.selectAll('text').attr('opacity', 1);
        edgeGroup.selectAll('path').attr('stroke-opacity', 0.28);
        return;
    }

    const connectedIds = new Set([hoveredNode.id as string]);
    graphData.edges.forEach((e: AnyEdge) => {
        if (e.from === hoveredNode.id) connectedIds.add(e.to as string);
        if (e.to === hoveredNode.id) connectedIds.add(e.from as string);
    });

    nodeGs.selectAll('rect')
        .attr('opacity', (n: any) => connectedIds.has(n.id) ? 1 : 0.38);
    nodeGs.selectAll('text')
        .attr('opacity', (n: any) => connectedIds.has(n.id) ? 1 : 0.34);
    edgeGroup.selectAll('path')
        .attr('stroke-opacity', (e: any) =>
            (connectedIds.has(e.from) || connectedIds.has(e.to)) ? 0.64 : 0.08
        );
}

function withAlpha(hex: string, alpha: number): string {
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

function truncateSubtitle(value: string, maxLength: number): string {
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

// tooltip content for suite nodes (used in inspector if wired)
export function suiteNodeTooltip(n: AnyNode): string {
    return `<strong>${escapeHtml(String(n.label ?? n.id))}</strong><br>${escapeHtml(String(n.subtitle ?? ''))}`;
}
