import { zoomIdentity } from 'd3-zoom';
import { appState as S } from './store';
import { ensureInspectorLoaded, showEntityDetails } from './lazy-loaders';
import { refreshWorkspace } from './workspace';
import type { SelectNodeContext } from './types';

function baseProjectLabel() {
    return S.activeProjectName || S.activeProjectId || 'Base';
}

function renderSelectionOnlyDetails(nodeId: string) {
    const node = S.nodeById.get(nodeId);
    if (!node) return;

    S.g?.selectAll('.graph-node')
        .select('.node-circle')
        .classed('is-selected', (d: any) => d?.id === nodeId);

    void ensureInspectorLoaded().then(() => {
        if (typeof document === 'undefined') return;
        showEntityDetails(node, {
            ...S.currentSelection,
            sourcePane: 'left',
            detailProjectLabel: baseProjectLabel(),
        });
    });
}

export function selectNode(nodeId: string, context: SelectNodeContext = {}) {
    const node = S.nodeById.get(nodeId);
    if (!node) return;
    S.currentWorkflowCode = null;
    S.currentSelection = { nodeId, type: context.type || 'NODE', fieldName: context.fieldName, permissionName: context.permissionName, fromSearch: Boolean(context.fromSearch) };
    let needsGraphRefresh = false;
    if (node.moduleFamily && node.moduleFamily !== 'Unclassified' && S.currentModule === 'ALL' && context.promoteModule !== false) {
        S.currentModule = node.moduleFamily as string;
        S.currentSubModule = node.subModule && node.subModule !== 'Unclassified' ? node.subModule as string : 'ALL';
        clearGraphFocus();
        needsGraphRefresh = true;
    } else if (context.focusGraph) {
        setGraphFocusNode(nodeId);
        needsGraphRefresh = true;
    }
    if (needsGraphRefresh) {
        S.focusRequestId = nodeId;
        refreshWorkspace();
        return;
    }
    S.focusRequestId = null;
    renderSelectionOnlyDetails(nodeId);
}

export function focusNode(nodeId: string | null, showDetails = true, pane: 'left' | 'right' = 'left') {
    const g = pane === 'right' ? S.graphRightG : S.g;
    const svg = pane === 'right' ? S.graphRightSvg : S.svg;
    const zoom = pane === 'right' ? S.graphRightZoomBehavior : S.zoomBehavior;
    const hostId = pane === 'right' ? 'graph-canvas-right' : 'graph-canvas';
    if (!g || !svg || !zoom) return;
    const nodeSelection = g.selectAll('.graph-node').filter((d: any) => d.id === nodeId);
    if (nodeSelection.empty()) return;
    const datum = nodeSelection.datum() as any;
    if (!datum || datum.x == null || datum.y == null) return;
    const container = document.getElementById(hostId);
    const width = container?.clientWidth || 1200;
    const height = container?.clientHeight || 800;
    const transform = zoomIdentity.translate(width / 2 - datum.x * 1.8, height / 2 - datum.y * 1.8).scale(1.8);
    svg.transition().duration(500).call(zoom.transform as any, transform);
    if (showDetails && nodeId) showEntityDetails(S.nodeById.get(nodeId), S.currentSelection || {});
}

export function setGraphFocusNode(nodeId: string | null, { append = false } = {}) {
    if (!nodeId) return;
    if (!append) S.currentGraphFocusNodeIds = [nodeId];
    else if (!S.currentGraphFocusNodeIds.includes(nodeId)) S.currentGraphFocusNodeIds.push(nodeId);
    S.currentGraphFocusNodeId = nodeId;
}

export function clearGraphFocus() { S.currentGraphFocusNodeId = null; S.currentGraphFocusNodeIds = []; }

export function removeGraphFocusNode(nodeId: string | null) {
    S.currentGraphFocusNodeIds = S.currentGraphFocusNodeIds.filter(id => id !== nodeId);
    if (S.currentGraphFocusNodeId === nodeId) {
        S.currentGraphFocusNodeId = S.currentGraphFocusNodeIds.length > 0 ? S.currentGraphFocusNodeIds[S.currentGraphFocusNodeIds.length - 1] : null;
    }
}

export function getFocusedNodeIds(): string[] {
    if (!S.currentGraphFocusNodeId) return [];
    const ids = S.currentGraphFocusNodeIds.length > 0 ? Array.from(new Set(S.currentGraphFocusNodeIds)) : [S.currentGraphFocusNodeId];
    if (!ids.includes(S.currentGraphFocusNodeId)) ids.push(S.currentGraphFocusNodeId);
    return ids.filter(id => S.nodeById.has(id) || (S.compareOverlay && S.compareTargetPrepared?.nodeById.has(id)));
}
