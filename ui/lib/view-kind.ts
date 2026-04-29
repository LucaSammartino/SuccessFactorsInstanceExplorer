import { appState as S, patchAppState } from './store';
import type { ViewKind } from './types';
import { findShortestPath, applyPathHighlight, clearPathHighlight } from './interactions/path-find';
import { clearGraphFocus, setGraphFocusNode } from './node-selection';

const DEFAULT_STANDARD_GRAPH_VIEW: ViewKind = 'suite';

export function rememberStandardGraphView(kind: ViewKind) {
    if (kind === 'rbp-flow') return;
    S.lastNonRbpGraphView = kind;
}

export function enterRbpFlowMode() {
    if (S.currentViewKind !== 'rbp-flow') {
        rememberStandardGraphView(S.currentViewKind);
    }
    S.currentViewKind = 'rbp-flow';
}

export function exitRbpFlowMode() {
    const next = S.lastNonRbpGraphView === 'rbp-flow'
        ? DEFAULT_STANDARD_GRAPH_VIEW
        : (S.lastNonRbpGraphView || DEFAULT_STANDARD_GRAPH_VIEW);
    S.currentViewKind = next;
}

export function toggleRbpFlowMode() {
    if (S.currentViewKind === 'rbp-flow') {
        exitRbpFlowMode();
        return;
    }
    enterRbpFlowMode();
}

export function activateRbpFlowMode({ jumpToGraphWorkspace = false }: { jumpToGraphWorkspace?: boolean } = {}) {
    const selectedId = S.currentSelection?.nodeId ?? null;
    const focusedId = S.currentGraphFocusNodeId ?? null;

    if (jumpToGraphWorkspace) {
        S.activeWorkspace = 'rbp-flow';
    }

    enterRbpFlowMode();
    S.focusRequestId = null;
    S.currentSelection = null;
    S.currentWorkflowCode = null;
    S.currentWorkflowCodeRight = null;

    const roleId = [selectedId, focusedId].find(id => id && S.nodeById.get(id)?.type === 'RBP_ROLE');
    if (roleId) {
        setGraphFocusNode(roleId);
    } else {
        clearGraphFocus();
        patchAppState({ compareTargetGraphFocusNodeId: null });
    }
}

export function deactivateRbpFlowMode() {
    exitRbpFlowMode();
    if (S.activeWorkspace === 'rbp-flow') {
        S.activeWorkspace = 'graph';
    }
    S.focusRequestId = null;
    S.currentSelection = null;
    S.currentWorkflowCode = null;
    S.currentWorkflowCodeRight = null;
    clearGraphFocus();
    patchAppState({ compareTargetGraphFocusNodeId: null });
}

export function renderViewKindSwitcher() {
    if ((S.currentViewKind as string) === 'rule-lineage') {
        S.currentViewKind = 'suite';
    }

    document.querySelectorAll('#view-kind-switcher .view-kind-btn').forEach(btn => {
        const kind = ((btn as HTMLElement).dataset?.viewKind ?? '') as ViewKind;
        btn.classList.toggle('active', kind === S.currentViewKind);
    });

    // Show drilldown-specific controls only in drilldown view
    const isDrilldown = S.currentViewKind === 'drilldown';
    document.getElementById('drilldown-toggles')?.classList.toggle('hidden', !isDrilldown);

    // Breadcrumb
    const bc = document.getElementById('view-breadcrumb');
    if (bc) {
        const labels: Record<ViewKind, string> = {
            suite: 'Suite Architecture',
            blueprint: S.currentModule !== 'ALL' ? `Blueprint: ${S.currentModule}` : 'Module Blueprint',
            drilldown: 'Object Drilldown',
            'rbp-flow': 'RBP Blast Radius',
        };
        bc.textContent = labels[S.currentViewKind] ?? '';
    }
}

/** Legacy no-ops: Workflow Heat and Blast Radius overlays were removed from the product UI. */
export function applyBlastRadius(_nodeId: string) {}

export function clearBlastRadiusFn() {}

export function applyPathFind(startId: string, endId: string) {
    const result = findShortestPath(startId, endId);
    S.pathFindStart = startId;
    S.pathFindEnd = endId;
    S.pathFindNodes = result.nodeIds;
    if (result.found) applyPathHighlight(result.nodeIds, result.edgeIds);
}

export function clearPathFindFn() {
    S.pathFindStart = null;
    S.pathFindEnd = null;
    S.pathFindNodes = [];
    clearPathHighlight();
}

export function applyOverlays() {
    /* no-op: graph overlays removed */
}
