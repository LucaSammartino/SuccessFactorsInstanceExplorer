import * as d3 from 'd3';
import { appState as S, patchAppState } from './store';
import { applyPreparedModelToAppState } from './data-prepare';
import type { PreparedInstanceModel } from './prepared-instance';
import {
    applyGraphControlStateToActiveState,
    getBaseGraphControlState,
    getTargetGraphControlState,
} from './pane-graph-controls';
import { getActiveGraphCanvasHostId, resetGraphCanvasHostToPrimary, setActiveGraphCanvasHostId } from './graph-canvas-host';
import { NODE_COLORS, EDGE_STYLES, drilldownNodeCircleFill } from './constants';
import type { ConnectedComponent, SimGraphNode, GraphData, ViewKind } from './types';
import { escapeHtml, formatType, formatViewLabel, formatObjectClassLabel } from './utils';
import {
    buildGraphScope,
    buildHubSet, makeNodeRadiusFn, updateNodeTextLabels,
    isAggregateRolesPickState,
} from './graph-data';
import { shouldIncludeRoleLinks, canToggleRolePermissionLinks } from './view-helpers';
import { renderSuiteArchitecture } from './views/suite-architecture';
import { renderModuleBlueprint } from './views/module-blueprint';
import { renderRbpFlow } from './views/rbp-blast-radius';
import { initMinimap, destroyMinimap, refreshMinimap, type MinimapKind } from './render/minimap';
import { readGraphViewportSize } from './layout/graph-viewport';
import { applyPathFind, clearPathFindFn } from './view-kind';
import { clearGraphFocus, focusNode, selectNode, setGraphFocusNode } from './node-selection';
import { isSplitCompareLayoutVisible } from './split-compare';

/**
 * When true the right-pane graph needs a re-render.
 * Set to true on first arm, on right-pane control changes, or when split mode
 * is entered.  Reset to false after a successful render.  This prevents
 * left-pane control changes from inadvertently re-rendering (and resetting)
 * the right graph.
 */
let _rightGraphDirty = true;

export function markRightGraphDirty() {
    _rightGraphDirty = true;
}

export function markRightGraphClean() {
    _rightGraphDirty = false;
}

export function renderGraph(graphData: GraphData, opts?: { skipMinimap?: boolean }) {
    let vk: ViewKind = (graphData.viewKind ?? S.currentViewKind) as ViewKind;
    if ((vk as string) === 'rule-lineage') vk = 'suite';
    switch (vk) {
        case 'suite':
            clearGraph(); renderSuiteArchitecture(graphData); break;
        case 'blueprint':
            clearGraph(); renderModuleBlueprint(graphData); break;
        case 'rbp-flow':
            clearGraph(); renderRbpFlow(graphData); break;
        default:
            renderForceGraph(graphData);
    }
    if (!opts?.skipMinimap) {
        const kind: MinimapKind = getActiveGraphCanvasHostId() === 'graph-canvas-right' ? 'compare' : 'primary';
        // RBP Flow empty scope renders only an in-canvas placeholder; avoid adding a minimap canvas
        // because it changes the footer height between left/right panes.
        if (vk === 'rbp-flow' && graphData.nodes.length === 0) {
            destroyMinimap(kind);
        } else {
            initMinimap(kind);
        }
    }
}

export function bundleLinksForDisplay(links: any[]) {
    const map = new Map();
    for (const link of links) {
        const a = typeof link.source === 'object' ? link.source.id : link.source;
        const b = typeof link.target === 'object' ? link.target.id : link.target;
        const key = [a, b].sort().join('||');
        if (!map.has(key)) {
            map.set(key, { rep: link, count: 1, types: [link.type], diffStatuses: [link.diffStatus].filter(Boolean) });
        } else {
            const bnd = map.get(key);
            bnd.count++;
            bnd.types.push(link.type);
            if (link.diffStatus) bnd.diffStatuses.push(link.diffStatus);
        }
    }
    return Array.from(map.values());
}

function compareDiffStatus(statuses: string[] = []): 'added' | 'removed' | 'changed' | null {
    if (statuses.includes('removed')) return 'removed';
    if (statuses.includes('added')) return 'added';
    if (statuses.includes('changed')) return 'changed';
    return null;
}

function compareDiffColor(status: string | null | undefined): string | null {
    if (status === 'added') return 'var(--compare-added)';
    if (status === 'removed') return 'var(--compare-removed)';
    if (status === 'changed') return 'var(--compare-changed)';
    return null;
}

export function primaryBundleStyle(types: string[]) {
    const priority = ['PERMITS', 'TRIGGERED_BY', 'MODIFIES', 'EXPOSES', 'ASSOCIATION', 'GATEWAY'];
    const t = priority.find(p => types.includes(p)) || types[0];
    return EDGE_STYLES[t] || EDGE_STYLES.ASSOCIATION;
}

export function buildCurvePath(s: any, t: any, curvePx: number) {
    if (!s || !t) return null;
    const dx = t.x - s.x, dy = t.y - s.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
    return `M ${s.x},${s.y} Q ${mx - (dy / len) * curvePx},${my + (dx / len) * curvePx} ${t.x},${t.y}`;
}

export function attachBundledEdges(g: any, displayBundles: any[], opacity = 0.52) {
    const getBundleWidth = (b: any) => {
        const style = primaryBundleStyle(b.types);
        const rep = b.rep || {};
        if (b.types.includes('PERMITS')) {
            const weight = Number(rep.permissionWeight) || 1;
            return Math.max(1, Math.min(4.5, 0.9 + weight * 0.32));
        }
        return b.count > 1 ? Math.min(4, 1.2 + b.count * 0.5) : (style.width || 1.2);
    };

    const linkPath = g.append('g')
        .selectAll('path').data(displayBundles).join('path')
        .attr('fill', 'none')
        .attr('stroke', (b: any) => compareDiffColor(compareDiffStatus(b.diffStatuses)) || primaryBundleStyle(b.types).color)
        .attr('stroke-width', (b: any) => {
            const diff = compareDiffStatus(b.diffStatuses);
            return diff ? Math.max(getBundleWidth(b), diff === 'changed' ? 3.2 : 3.5) : getBundleWidth(b);
        })
        .attr('stroke-dasharray', (b: any) => {
            const diff = compareDiffStatus(b.diffStatuses);
            if (diff === 'removed') return '7 5';
            if (diff === 'changed') return '3 4';
            return primaryBundleStyle(b.types).dash || null;
        })
        .attr('stroke-opacity', (b: any) => compareDiffStatus(b.diffStatuses) ? 0.82 : opacity);

    if (displayBundles.some((b: any) => compareDiffStatus(b.diffStatuses))) {
        linkPath.attr('class', (b: any) => {
            const diff = compareDiffStatus(b.diffStatuses);
            return diff ? `graph-edge graph-edge--diff graph-edge--${diff}` : 'graph-edge';
        });
    }

    const bundgeLabels = g.append('g')
        .selectAll('g')
        .data([])
        .join('g');

    return { linkPath, bundgeLabels };
}

export function attachNodes(g: any, nodes: any[], nodeRadius: any, currentSelection: any) {
    const node = g.append('g').selectAll('g').data(nodes).join('g')
        .attr('class', (d: any) => {
            const diff = d.diffStatus && d.diffStatus !== 'unchanged' ? ` graph-node--diff graph-node--${d.diffStatus}` : '';
            return `graph-node${d.type === 'GATEWAY_NODE' ? ' gateway-node' : ''}${diff}`;
        })
        .call(d3.drag().on('start', dragStarted).on('drag', dragged).on('end', dragEnded));
    node.filter((d: any) => d.diffStatus && d.diffStatus !== 'unchanged')
        .append('circle')
        .attr('class', (d: any) => `node-diff-halo node-diff-halo--${d.diffStatus}`)
        .attr('r', (d: any) => nodeRadius(d) + 6);
    node.append('circle')
        .attr('class', (d: any) => `node-circle${currentSelection?.nodeId === d.id ? ' is-selected' : ''}${d.type === 'GATEWAY_NODE' ? ' gateway-node-circle' : ''}`)
        .attr('r', nodeRadius)
        .style('fill', (d: any) => drilldownNodeCircleFill(d))
        .style('stroke', (d: any) => compareDiffColor(d.diffStatus) || (d.type === 'GATEWAY_NODE' ? (NODE_COLORS[d.gatewayType] || '#8f9dae') : null))
        .style('stroke-width', (d: any) => d.diffStatus && d.diffStatus !== 'unchanged' ? '3px' : (d.type === 'GATEWAY_NODE' ? '2.5px' : null))
        .style('stroke-dasharray', (d: any) => d.diffStatus === 'removed' ? '5 3' : (d.type === 'GATEWAY_NODE' ? '5 3' : null))
        .style('opacity', (d: any) => d.diffStatus === 'removed' ? 0.78 : 1);
    node.append('title').text((d: any) => d.label || d.id);
    return node;
}

export function tickEdges(linkPath: any, bundgeLabels: any, curvePx = 10) {
    linkPath.attr('d', (b: any) => buildCurvePath(b.rep.source, b.rep.target, b.count > 1 ? curvePx + 12 : curvePx));
    bundgeLabels.attr('transform', (b: any) => {
        const s = b.rep.source, t = b.rep.target;
        if (!s || !t) return null;
        return `translate(${(s.x + t.x) / 2},${(s.y + t.y) / 2})`;
    });
}

export function applyEgoPrePositioning(nodes: any[], links: any[], width: number, height: number) {
    if (!S.currentGraphFocusNodeId) return;
    const focusNode = nodes.find(n => n.id === S.currentGraphFocusNodeId);
    if (!focusNode) return;
    focusNode.fx = width / 2;
    focusNode.fy = height / 2;
    const neighborIds = new Set<string>();
    links.forEach((l: any) => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        if (s === S.currentGraphFocusNodeId) neighborIds.add(t);
        if (t === S.currentGraphFocusNodeId) neighborIds.add(s);
    });
    const typeOrder = ['MDF_OBJECT', 'ODATA_ENTITY', 'BUSINESS_RULE', 'RBP_ROLE'];
    const byType: Record<string, any[]> = {};
    typeOrder.forEach((t: string) => { byType[t] = []; });
    nodes.forEach((n: any) => {
        if (n.id !== S.currentGraphFocusNodeId && neighborIds.has(n.id)) {
            (byType[n.type] || byType['MDF_OBJECT']).push(n);
        }
    });
    const activeTypes = typeOrder.filter(t => (byType[t] || []).length > 0);
    const sectorAngle = (Math.PI * 2) / Math.max(activeTypes.length, 1);
    const r = Math.min(width, height) * 0.3;
    activeTypes.forEach((type, ti) => {
        const grp = byType[type];
        const center = -Math.PI / 2 + ti * sectorAngle + sectorAngle / 2;
        const spread = Math.min(sectorAngle * 0.82, Math.PI * 0.85);
        grp.forEach((n, i) => {
            const angle = grp.length > 1 ? center - spread / 2 + (spread / (grp.length - 1)) * i : center;
            n.x = width / 2 + r * Math.cos(angle);
            n.y = height / 2 + r * Math.sin(angle);
        });
    });
}

export function renderForceGraph(graphData: GraphData) {
    const container = document.getElementById(getActiveGraphCanvasHostId());
    if (!container) return;
    clearGraph();
    if (graphData.nodes.length === 0) return;

    const { width, height } = readGraphViewportSize(container);
    const nodes = graphData.nodes.map(n => ({ ...n }));
    const links = graphData.edges.map(e => ({ ...e, source: e.from, target: e.to }));

    const degreeMap = graphData.visibleDegree || new Map();
    const visibleStats = graphData.visibleStats || new Map();
    const componentByNodeId = graphData.componentByNodeId || new Map();
    const componentById = new Map<string, ConnectedComponent>(
        (graphData.components || []).map(c => [c.id, c as ConnectedComponent])
    );
    const hubIds = buildHubSet(visibleStats, nodes.length);
    const nodeRadius = makeNodeRadiusFn(visibleStats, degreeMap, hubIds);

    const hostIdForZoom = getActiveGraphCanvasHostId();
    const minimapKind: MinimapKind = hostIdForZoom === 'graph-canvas-right' ? 'compare' : 'primary';
    S.svg = d3.select(`#${hostIdForZoom}`).append('svg').attr('width', '100%').attr('height', '100%').attr('viewBox', `0 0 ${width} ${height}`);
    S.g = S.svg.append('g');
    const zoomLayer = S.g;
    S.zoomBehavior = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.15, 5]).on('zoom', ev => {
        zoomLayer.attr('transform', ev.transform);
        refreshMinimap(minimapKind);
    });
    S.svg.call(S.zoomBehavior!);
    const restoredViewport = applyGatewayViewport(nodes);

    // Restore manually pinned positions for this scope
    const scopePins = S.pinnedPositions.get(graphData.scopeKey ?? 'drilldown');
    if (scopePins) {
        nodes.forEach((n: any) => {
            const pin = scopePins.get(n.id);
            if (pin) { n.x = pin.x; n.y = pin.y; n.fx = pin.x; n.fy = pin.y; }
        });
    }

    applyEgoPrePositioning(nodes, links, width, height);

    const showLabels = nodes.length <= 180;
    S.simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
        .force(
            'link',
            d3
                .forceLink(links as d3.SimulationLinkDatum<d3.SimulationNodeDatum>[])
                .id((n => (n as d3.SimulationNodeDatum & { id: string }).id))
                .distance(e => (e as { type?: string }).type === 'PERMITS' ? 110 : 140)
        )
        .force('charge', d3.forceManyBody().strength(nodes.length > 220 ? -145 : -220))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide(d => {
            const dn = d as SimGraphNode;
            return nodeRadius(dn) + (hubIds.has(dn.id) ? 18 : 10);
        }));
    if (restoredViewport) S.simulation.alpha(0.12).restart();

    const displayBundles = bundleLinksForDisplay(links);
    const { linkPath, bundgeLabels } = attachBundledEdges(S.g, displayBundles, 0.52);

    const node = attachNodes(S.g, nodes, nodeRadius, S.currentSelection);
    node.append('text')
        .attr('class', (d: any) => hubIds.has(d.id) ? 'hub-label' : 'node-label')
        .attr('y', (d: any) => nodeRadius(d) + 16);
    updateNodeTextLabels(node.select('text'), visibleStats, hubIds, showLabels);

    node.on('mouseover', (_event: any, hoveredNode: SimGraphNode) => {
        const componentId = componentByNodeId.get(hoveredNode.id);
        const component = componentId ? componentById.get(componentId) : undefined;
        const highlightedIds = new Set(component?.nodeIds || [hoveredNode.id]);
        S.hoveredComponentId = componentId || null;
        node.select('circle').attr('opacity', (n: any) => highlightedIds.has(n.id) ? 1 : 0.16);
        node.select('text').attr('opacity', (n: any) => highlightedIds.has(n.id) ? 1 : 0.08);
        updateNodeTextLabels(node.select('text'), visibleStats, hubIds, showLabels, highlightedIds);
        linkPath.attr('stroke-opacity', (b: any) => {
            const from = typeof b.rep.source === 'object' ? b.rep.source.id : b.rep.source;
            const to = typeof b.rep.target === 'object' ? b.rep.target.id : b.rep.target;
            return (highlightedIds.has(from) || highlightedIds.has(to)) ? 0.88 : 0.06;
        });
        renderHoverPanel(component, hoveredNode);
    });
    node.on('mouseout', () => {
        S.hoveredComponentId = null;
        node.select('circle').attr('opacity', 1);
        node.select('text').attr('opacity', 1);
        updateNodeTextLabels(node.select('text'), visibleStats, hubIds, showLabels);
        linkPath.attr('stroke-opacity', 0.52);
    });
    node.on('click', (_event: any, clickedNode: SimGraphNode) => {
        if (_event.shiftKey && clickedNode.type !== 'GATEWAY_NODE') {
            if (!S.pathFindStart || S.pathFindEnd) {
                clearPathFindFn();
                S.pathFindStart = clickedNode.id;
            } else if (S.pathFindStart !== clickedNode.id) {
                applyPathFind(S.pathFindStart, clickedNode.id);
                S.pathFindStart = null;
            } else {
                clearPathFindFn();
            }
            return;
        }
        if (clickedNode.type === 'GATEWAY_NODE') {
            toggleGateway(clickedNode.id);
        } else {
            selectNode(clickedNode.id, { type: 'GRAPH', fromSearch: false });
        }
    });

    node.on('contextmenu', (event: MouseEvent, clickedNode: SimGraphNode) => {
        event.preventDefault();
        event.stopPropagation();
        document.querySelectorAll('.graph-context-menu').forEach(el => el.remove());

        const menu = document.createElement('div');
        menu.className = 'graph-context-menu';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = `
<button type="button" class="graph-context-menu-item" data-gcm="detail" role="menuitem"${clickedNode.type === 'GATEWAY_NODE' ? ' disabled' : ''}>Open detail</button>`;
        document.body.appendChild(menu);
        const pad = 8;
        let left = event.clientX;
        let top = event.clientY;
        const place = () => {
            const r = menu.getBoundingClientRect();
            if (r.right > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - r.width - pad);
            if (r.bottom > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - r.height - pad);
            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;
        };
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        requestAnimationFrame(place);

        const close = () => {
            menu.remove();
            document.removeEventListener('click', close, true);
            document.removeEventListener('keydown', onEsc, true);
        };
        const onEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
        };
        setTimeout(() => {
            document.addEventListener('click', close, true);
            document.addEventListener('keydown', onEsc, true);
        }, 0);

        menu.querySelector('[data-gcm="detail"]')?.addEventListener('click', e => {
            e.stopPropagation();
            close();
            if (clickedNode.type === 'GATEWAY_NODE') return;
            selectNode(clickedNode.id, { type: 'GRAPH', fromSearch: false });
        });
    });

    S.simulation.on('tick', () => {
        tickEdges(linkPath, bundgeLabels, 10);
        node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
        refreshMinimap(minimapKind);
    });

    if (S.focusRequestId) {
        const id = S.focusRequestId;
        const pane = S.graphFocusAfterRenderHost === 'right' ? 'right' : 'left';
        window.setTimeout(() => {
            focusNode(id, false, pane);
            S.focusRequestId = null;
            S.graphFocusAfterRenderHost = null;
        }, 450);
    }
}

export function clearGraph() {
    const hostId = getActiveGraphCanvasHostId();
    const container = document.getElementById(hostId);

    if (hostId === 'graph-canvas-right') {
        S.graphRightSimulation?.stop();
        patchAppState({
            graphRightSimulation: null,
            graphRightSvg: null,
            graphRightG: null,
            graphRightZoomBehavior: null,
        });
        destroyMinimap('compare');
        if (container) container.innerHTML = '';
        hideHoverPanel();
        return;
    }

    S.simulation?.stop();
    S.simulation = null;
    destroyMinimap('primary');
    if (container) container.innerHTML = '';
    hideHoverPanel();
    S.svg = null;
    S.g = null;
    S.zoomBehavior = null;
}

function snapshotPrimaryGraphModel(): PreparedInstanceModel {
    return {
        dashboard: S.dashboard!,
        allNodes: S.allNodes,
        allEdges: S.allEdges,
        nodeById: S.nodeById,
        edgesByNode: S.edgesByNode,
        roleObjectPermissions: S.roleObjectPermissions,
        roleSystemPermissions: S.roleSystemPermissions,
        roleObjectByRole: S.roleObjectByRole,
        roleObjectByObject: S.roleObjectByObject,
        roleSystemByRole: S.roleSystemByRole,
        workflowEntries: S.workflowEntries,
        workflowByCode: S.workflowByCode,
        searchEntries: S.searchEntries,
    };
}

type PrimaryGraphFocusState = {
    currentGraphFocusNodeId: string | null;
    currentGraphFocusNodeIds: string[];
};

function snapshotPrimaryGraphFocusState(): PrimaryGraphFocusState {
    return {
        currentGraphFocusNodeId: S.currentGraphFocusNodeId,
        currentGraphFocusNodeIds: [...S.currentGraphFocusNodeIds],
    };
}

function restorePrimaryGraphModel(m: PreparedInstanceModel) {
    applyPreparedModelToAppState(m);
}

export function clearCompareTargetGraphCanvas() {
    S.graphRightSimulation?.stop();
    destroyMinimap('compare');
    patchAppState({
        graphRightSimulation: null,
        graphRightSvg: null,
        graphRightG: null,
        graphRightZoomBehavior: null,
    });
    document.getElementById('graph-canvas-right')?.replaceChildren();
    const st = document.getElementById('graph-status-right');
    if (st) {
        st.classList.add('hidden');
        st.innerHTML = '';
    }
}

export function renderCompareTargetGraphIfActive(retry = 0) {
    if (!isSplitCompareLayoutVisible()) {
        clearCompareTargetGraphCanvas();
        return;
    }

    const rightHost = document.getElementById('graph-canvas-right');
    const hasRenderedRightGraph = Boolean(S.graphRightSvg) && Boolean(rightHost?.querySelector('svg'));

    /* Skip the expensive snapshot/swap/render/restore cycle when the right
       graph is already rendered and nothing on the right side has changed. */
    if (!_rightGraphDirty && hasRenderedRightGraph) return;

    const layoutOk =
        (rightHost?.clientWidth ?? 0) >= 4 &&
        (rightHost?.clientHeight ?? 0) >= 4;
    if (!layoutOk && retry < 10) {
        requestAnimationFrame(() => renderCompareTargetGraphIfActive(retry + 1));
        return;
    }

    const savedModel = snapshotPrimaryGraphModel();
    const savedSvg = S.svg;
    const savedG = S.g;
    const savedZoom = S.zoomBehavior;
    const savedSim = S.simulation;
    const savedFocus = snapshotPrimaryGraphFocusState();
    const savedControls = getBaseGraphControlState();

    S.graphRightSimulation?.stop();

    if (!S.compareTargetPrepared) return;
    applyPreparedModelToAppState(S.compareTargetPrepared);
    applyGraphControlStateToActiveState(getTargetGraphControlState());
    S.focusRequestId = null;
    S.graphFocusAfterRenderHost = null;
    const trid = S.compareTargetGraphFocusNodeId;
    if (trid && S.nodeById.get(trid)?.type === 'RBP_ROLE') {
        setGraphFocusNode(trid);
        S.focusRequestId = trid;
        S.graphFocusAfterRenderHost = 'right';
    } else {
        clearGraphFocus();
    }

    setActiveGraphCanvasHostId('graph-canvas-right');
    const rightCanvas = document.getElementById('graph-canvas-right');
    if (rightCanvas) rightCanvas.replaceChildren();

    showOverviewStateRight(false);
    document.getElementById('roles-graph-placeholder-right')?.classList.add('hidden');

    try {
        const data = buildGraphScope();
        if (!data) {
            showOverviewStateRight(true);
            renderGraphStatusForHost(null, 'graph-status-right');
            return;
        }

        if (isAggregateRolesPickState() && data.nodes.length === 0) {
            showOverviewStateRight(false);
            document.getElementById('roles-graph-placeholder-right')?.classList.remove('hidden');
            renderGraphStatusForHost(data, 'graph-status-right');
            return;
        }

        document.getElementById('roles-graph-placeholder-right')?.classList.add('hidden');
        renderGraph(data, { skipMinimap: false });
        renderGraphStatusForHost(data, 'graph-status-right');
        patchAppState({
            graphRightSvg: S.svg,
            graphRightG: S.g,
            graphRightZoomBehavior: S.zoomBehavior,
            graphRightSimulation: S.simulation,
        });
    } finally {
        _rightGraphDirty = false;
        resetGraphCanvasHostToPrimary();
        restorePrimaryGraphModel(savedModel);
        applyGraphControlStateToActiveState(savedControls);
        patchAppState({
            svg: savedSvg,
            g: savedG,
            zoomBehavior: savedZoom,
            simulation: savedSim,
            currentGraphFocusNodeId: savedFocus.currentGraphFocusNodeId,
            currentGraphFocusNodeIds: savedFocus.currentGraphFocusNodeIds,
        });
    }
}

export function showOverviewStateRight(visible: boolean) {
    document.getElementById('overview-state-right')?.classList.toggle('hidden', !visible);
}

function renderGraphStatusForHost(graphData: GraphData | null, statusElementId: string) {
    const status = document.getElementById(statusElementId);
    if (!status) return;

    if (!graphData) {
        status.classList.add('hidden');
        status.innerHTML = '';
        return;
    }

    status.classList.remove('hidden');
    const isDrilldownView = (graphData.viewKind ?? S.currentViewKind) === 'drilldown';
    const lowSignalNote = graphData.hiddenLowSignalNodeCount > 0
        ? ` · ${graphData.hiddenLowSignalNodeCount} low-signal hidden`
        : '';
    const objectClassNote = S.currentObjectClass !== 'ALL_OBJECTS'
        ? ` · ${formatObjectClassLabel(S.currentObjectClass)}`
        : '';
    const roleNote =
        S.currentView === 'all' && !shouldIncludeRoleLinks()
            ? ' · RBP permission overlay off'
            : '';
    const rolesPickNote =
        isDrilldownView && isAggregateRolesPickState() && graphData.nodes.length === 0
            ? ` · Select a role in the list to draw its graph`
            : '';

    const viewLabel = isDrilldownView
        ? formatViewLabel(S.currentView)
        : ({
            suite: 'Suite',
            blueprint: 'Blueprint',
            'rbp-flow': 'RBP Flow',
        } as Record<string, string>)[graphData.viewKind ?? S.currentViewKind] || formatViewLabel(S.currentView);

    const statusText = `${graphData.scopeLabel} · ${graphData.nodes.length} nodes · ${graphData.edges.length} edges · ${viewLabel}${objectClassNote}${roleNote}${rolesPickNote}${lowSignalNote}`;

    status.classList.toggle('is-collapsed', S.graphStatusCollapsed);
    status.innerHTML = S.graphStatusCollapsed
        ? `
            <button type="button" class="graph-status-toggle" data-graph-status-toggle="expand" aria-label="Show graph status">
                Status
            </button>
        `
        : `
            <div class="graph-status-text">${escapeHtml(statusText)}</div>
            <button type="button" class="graph-status-toggle" data-graph-status-toggle="collapse" aria-label="Hide graph status">
                Hide
            </button>
        `;

    status.querySelector('[data-graph-status-toggle]')?.addEventListener('click', () => {
        S.graphStatusCollapsed = !S.graphStatusCollapsed;
        renderGraphStatusForHost(graphData, statusElementId);
    });
}

export function renderGraphStatus(graphData: GraphData | null) {
    const status = document.getElementById('graph-status');
    if (!status) return;

    if (!graphData) {
        status.classList.add('hidden');
        status.innerHTML = '';
        return;
    }

    status.classList.remove('hidden');
    const isDrilldownView = (graphData.viewKind ?? S.currentViewKind) === 'drilldown';
    const lowSignalNote = graphData.hiddenLowSignalNodeCount > 0
        ? ` · ${graphData.hiddenLowSignalNodeCount} low-signal hidden`
        : '';
    const objectClassNote = S.currentObjectClass !== 'ALL_OBJECTS'
        ? ` · ${formatObjectClassLabel(S.currentObjectClass)}`
        : '';
    const roleNote =
        S.currentView === 'all' && !shouldIncludeRoleLinks()
            ? ' · RBP permission overlay off'
            : '';
    const rolesPickNote =
        isDrilldownView && isAggregateRolesPickState() && graphData.nodes.length === 0
            ? ' · Select a role in the list to draw its graph'
            : '';

    const viewLabel = isDrilldownView
        ? formatViewLabel(S.currentView)
        : ({
            suite: 'Suite',
            blueprint: 'Blueprint',
            'rbp-flow': 'RBP Flow',
        } as Record<string, string>)[graphData.viewKind ?? S.currentViewKind] || formatViewLabel(S.currentView);

    const statusText = `${graphData.scopeLabel} · ${graphData.nodes.length} nodes · ${graphData.edges.length} edges · ${viewLabel}${objectClassNote}${roleNote}${rolesPickNote}${lowSignalNote}`;

    status.classList.toggle('is-collapsed', S.graphStatusCollapsed);
    status.innerHTML = S.graphStatusCollapsed
        ? `
            <button type="button" class="graph-status-toggle" data-graph-status-toggle="expand" aria-label="Show graph status">
                Status
            </button>
        `
        : `
            <div class="graph-status-text">${escapeHtml(statusText)}</div>
            <button type="button" class="graph-status-toggle" data-graph-status-toggle="collapse" aria-label="Hide graph status">
                Hide
            </button>
        `;

    status.querySelector('[data-graph-status-toggle]')?.addEventListener('click', () => {
        S.graphStatusCollapsed = !S.graphStatusCollapsed;
        renderGraphStatus(graphData);
    });
}

export function renderIsolatedToggle(graphData: GraphData | null) {
    const button = document.getElementById('toggle-isolated');
    if (!button) return;

    if (!graphData) {
        (button as any).disabled = true;
        button.classList.remove('is-active');
        button.innerText = 'Show hidden low-signal nodes';
        return;
    }

    const hiddenCount = graphData.hiddenLowSignalNodeCount || 0;
    (button as any).disabled = hiddenCount === 0 && !S.showIsolated;
    button.classList.toggle('is-active', S.showIsolated);

    if (S.showIsolated) {
        button.innerText = hiddenCount > 0
            ? `Hide low-signal nodes (${hiddenCount} restored)`
            : 'Hide low-signal nodes';
        return;
    }

    button.innerText = hiddenCount > 0
        ? `Show hidden low-signal nodes (${hiddenCount} hidden)`
        : 'No hidden low-signal nodes';
}

export function renderRoleLinksToggle() {
    const button = document.getElementById('toggle-role-links');
    if (!button) return;

    const show = canToggleRolePermissionLinks();
    button.classList.toggle('hidden', !show);
    if (!show) return;

    const forcedOn = S.currentView === 'RBP_ROLE';
    (button as any).disabled = forcedOn;
    const visuallyOn = forcedOn || S.includeRolePermissionLinks;
    button.classList.toggle('is-active', visuallyOn);

    if (forcedOn) {
        button.innerText = 'Role links (on in Roles view)';
        return;
    }

    button.innerText = S.includeRolePermissionLinks
        ? 'Hide role permission links'
        : 'Show role permission links';
}

export function updateActiveScope(label: string) {
    const el = document.getElementById('active-scope');
    if (el) el.innerText = label;
}

export function buildActiveScopeLabel(graphData: GraphData | null) {
    if (S.currentWorkflowCode && S.workflowByCode.has(S.currentWorkflowCode)) {
        const workflow = S.workflowByCode.get(S.currentWorkflowCode);
        return `${workflow!.name || workflow!.code} · Workflow`;
    }

    if (!graphData) {
        return S.currentObjectClass === 'ALL_OBJECTS'
            ? 'Overview'
            : `Overview · ${formatObjectClassLabel(S.currentObjectClass)}`;
    }

    const parts = [graphData.scopeLabel];
    if (S.currentObjectClass !== 'ALL_OBJECTS') {
        parts.push(formatObjectClassLabel(S.currentObjectClass));
    }
    if (S.currentView !== 'all') {
        parts.push(formatViewLabel(S.currentView));
    } else if (!shouldIncludeRoleLinks()) {
        parts.push('no RBP overlay');
    }
    if (isAggregateRolesPickState() && graphData.nodes.length === 0) {
        parts.push('pick a role');
    }
    return parts.join(' · ');
}

export function showOverviewState(visible: boolean) {
    document.getElementById('overview-state')?.classList.toggle('hidden', !visible);
}

export function renderHoverPanel(component: any, hoveredNode: any) {
    void component;
    void hoveredNode;
}

export function hideHoverPanel() {
    S.hoveredComponentId = null;
    S.inspectorHasContent = false;
    S.rightSidebarCollapsed = true;
}

export function renderScopeLabel() {
    // placeholder if needed
}

export function dragStarted(event: any) {
    if (!event.active) S.simulation!.alphaTarget(0.25).restart();
    event.subject.fx = event.subject.x;
    event.subject.fy = event.subject.y;
}

export function dragged(event: any) {
    event.subject.fx = event.x;
    event.subject.fy = event.y;
}

export function dragEnded(event: any) {
    if (!event.active) S.simulation!.alphaTarget(0);
    // Pin the node at its dropped position — don't release it back to simulation.
    // Save to pinnedPositions so the pin survives scope re-renders.
    const scopeKey = S.currentGraphData?.scopeKey ?? 'drilldown';
    if (!S.pinnedPositions.has(scopeKey)) S.pinnedPositions.set(scopeKey, new Map());
    S.pinnedPositions.get(scopeKey)!.set(event.subject.id, {
        x: event.subject.fx as number,
        y: event.subject.fy as number,
    });
}

export function resetLayout() {
    const scopeKey = S.currentGraphData?.scopeKey ?? 'drilldown';
    S.pinnedPositions.delete(scopeKey);
    S.currentGraphData = buildGraphScope();
    if (S.currentGraphData) renderGraph(S.currentGraphData);
}

export function toggleGateway(gatewayId: string) {
    S.pendingGatewayViewport = captureGatewayViewport(gatewayId);
    S.gatewayState.set(gatewayId, !(S.gatewayState.get(gatewayId) ?? false));
    S.currentGraphData = buildGraphScope();
    renderGraph(S.currentGraphData!);
}

export function captureGatewayViewport(anchorNodeId: string) {
    const transform = (S.svg && S.zoomBehavior) ? d3.zoomTransform(S.svg.node()!) : d3.zoomIdentity;
    const nodePositions = new Map<string, any>();
    if (S.simulation) {
        S.simulation.nodes().forEach((n: any) => {
            nodePositions.set((n as SimGraphNode).id, {
                x: n.x,
                y: n.y,
                vx: n.vx || 0,
                vy: n.vy || 0,
                fx: n.fx,
                fy: n.fy
            });
        });
    }
    return {
        anchorNodeId,
        transform,
        nodePositions
    };
}

export function applyGatewayViewport(nodes: any[]) {
    const snapshot = S.pendingGatewayViewport;
    if (!snapshot) return false;

    let restored = false;
    nodes.forEach((n: any) => {
        const prev = snapshot.nodePositions?.get(n.id);
        if (!prev) return;
        n.x = prev.x;
        n.y = prev.y;
        n.vx = prev.vx;
        n.vy = prev.vy;
        n.fx = prev.fx;
        n.fy = prev.fy;
        restored = true;
    });

    if (S.svg && S.zoomBehavior && snapshot.transform) {
        S.svg.call(S.zoomBehavior.transform, snapshot.transform);
    }

    if (restored && snapshot.anchorNodeId && nodes.some((n: any) => n.id === snapshot.anchorNodeId)) {
        S.focusRequestId = snapshot.anchorNodeId;
    }

    S.pendingGatewayViewport = null;
    return restored;
}
