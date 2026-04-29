import { renderExploreWorkspace } from './explore';
import { buildGraphScope, isAggregateRolesPickState } from './graph-data';
import {
    buildActiveScopeLabel,
    clearGraph,
    hideHoverPanel,
    markRightGraphDirty,
    renderCompareTargetGraphIfActive,
    renderGraph,
    renderGraphStatus,
    renderIsolatedToggle,
    renderRoleLinksToggle,
    showOverviewState,
    updateActiveScope
} from './graph-render';
import {
    ensureInspectorLoaded,
    ensureMatrixLoaded,
    hideEntityDetails,
    isInspectorReady,
    isMatrixReady,
    renderImportWorkspace,
    renderPermissionMatrix,
    renderProjectsPanel,
    showEntityDetails,
    showWorkflowDetails,
    syncWorkflowSplitDetailPanels
} from './lazy-loaders';
import { renderModuleBar, renderObjectClassBar, renderOverviewModules } from './module-bars';
import { renderGraphPaneControls } from './pane-graph-controls';
import { renderGraphFocusList, renderRoleRail, renderRolesGraphChrome, renderTargetRoleRail } from './role-rail';
import { renderSearchResults } from './search';
import { appState as S, patchAppState } from './store';
import { escapeHtml } from './utils';
import { activateRbpFlowMode, applyOverlays, deactivateRbpFlowMode, renderViewKindSwitcher } from './view-kind';
import { renderWorkflowList } from './workflow-panel';
import { renderSplitCompareStrip, syncSplitWorkspaceLayout, isSplitCompareLayoutVisible } from './split-compare';

function baseProjectLabel() {
    return S.activeProjectName || S.activeProjectId || 'Base';
}

function targetProjectLabel() {
    return S.compareTargetProjectName || S.compareTargetProjectId || 'Target';
}

/** Pane chrome: project names when split compare is active (graph, overview, explore, matrix). */
function renderSplitPaneInstanceLabels() {
    const on = isSplitCompareLayoutVisible();
    const baseName = baseProjectLabel();
    const targetName = targetProjectLabel();

    const apply = (blockId: string, name: string) => {
        const block = document.getElementById(blockId);
        if (!block) return;
        const nameEl = block.querySelector('.split-pane-instance-name');
        if (nameEl) nameEl.textContent = name;
        if (on) block.removeAttribute('hidden');
        else block.setAttribute('hidden', '');
    };

    apply('graph-split-label-left', baseName);
    apply('graph-split-label-right', targetName);
    apply('overview-split-label-left', baseName);
    apply('overview-split-label-right', targetName);
    apply('explore-split-label-left', baseName);
    apply('explore-split-label-right', targetName);
    apply('matrix-split-label-left', baseName);
    apply('matrix-split-label-right', targetName);
    apply('workflow-split-label-left', baseName);
    apply('workflow-split-label-right', targetName);
}

const VALID_WORKSPACES = new Set([
    'graph',
    'rbp-flow',
    'overview',
    'explore',
    'roles-matrix',
    'workflows',
    'import',
    'compare',
    'projects'
]);

export function isGraphWorkspaceRoute(workspace = S.activeWorkspace) {
    return workspace === 'graph' || workspace === 'rbp-flow';
}

function syncGraphViewKindForWorkspace(workspace: string) {
    if (workspace === 'rbp-flow') {
        if (S.currentViewKind !== 'rbp-flow') {
            activateRbpFlowMode();
        }
        if (S.compareTargetViewKind !== 'rbp-flow') {
            patchAppState({ compareTargetViewKind: 'rbp-flow' });
        }
        return;
    }

    if (workspace === 'graph' && S.currentViewKind === 'rbp-flow') {
        deactivateRbpFlowMode();
    }
    if (workspace === 'graph' && S.compareTargetViewKind === 'rbp-flow') {
        patchAppState({ compareTargetViewKind: S.currentViewKind === 'rbp-flow' ? 'suite' : S.currentViewKind });
    }
}

export function applyInitialWorkspaceFromHash() {
    let raw = (location.hash || '#overview').replace(/^#/, '');
    if (raw === 'search') {
        raw = 'explore';
        S.exploreDeepSearch = true;
        history.replaceState(null, '', `${location.pathname}${location.search}#explore`);
    } else if (!VALID_WORKSPACES.has(raw)) {
        raw = 'overview';
        const h = location.hash.replace(/^#/, '');
        if (h && h !== 'overview') {
            history.replaceState(null, '', `${location.pathname}${location.search}#overview`);
        }
    }
    S.activeWorkspace = raw;
    syncGraphViewKindForWorkspace(raw);
    renderWorkspaceTabs();
}

export function setActiveWorkspace(workspace: string) {
    if (!VALID_WORKSPACES.has(workspace)) return;
    const next = `#${workspace}`;
    if (location.hash !== next) {
        location.hash = next;
        return;
    }
    S.activeWorkspace = workspace;
    syncGraphViewKindForWorkspace(workspace);
    S.hoveredComponentId = null;
    hideHoverPanel();
    patchAppState({});
    renderWorkspaceTabs();
    refreshWorkspace();
}

export function renderWorkspaceTabs() {
    const exploreLabels: Record<string, string> = {
        objects: 'Objects',
        rules: 'Rules',
        roles: 'Roles',
        odata: 'OData',
        workflows: 'Workflows'
    };

    document.querySelectorAll('.workspace-tab').forEach(button => {
        const isExploreRoute = button.id === 'tab-explore' && ['explore', 'workflows'].includes(S.activeWorkspace);
        const isActive = (button as HTMLElement).dataset?.workspace === S.activeWorkspace || isExploreRoute;
        button.classList.toggle('active', isActive);
        if (button.id !== 'tab-explore') return;

        if (S.activeWorkspace === 'explore') button.textContent = `Explore: ${exploreLabels[S.activeExploreView] || 'Explore'} ▾`;
        else if (S.activeWorkspace === 'workflows') button.textContent = `Explore: ${exploreLabels.workflows} ▾`;
        else button.textContent = 'Explore ▾';
    });

    document.querySelectorAll('.workspace-panel').forEach(panel => {
        const panelKey = panel.id.replace('workspace-', '');
        if (panelKey === S.activeWorkspace || (panelKey === 'graph' && isGraphWorkspaceRoute())) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
    });
}

export function renderToolbarState() {
    const toolbar = document.querySelector('.workspace-toolbar');
    const toggle = document.getElementById('controls-toggle');
    const splitGraphControls = S.activeWorkspace === 'graph' && isSplitCompareLayoutVisible();
    if (toolbar) toolbar.classList.toggle('is-collapsed', S.controlsCollapsed);
    if (toolbar) toolbar.classList.toggle('is-rbp-flow', S.currentViewKind === 'rbp-flow');
    if (toolbar) toolbar.classList.toggle('is-split-compare', splitGraphControls);
    if (toggle) {
        toggle.textContent = S.controlsCollapsed ? 'Show Controls' : 'Hide Controls';
        (toggle as any).design = S.controlsCollapsed ? 'Transparent' : 'Default';
    }
}

export function renderLegendState() {
    const footers = ['graph-legend-footer', 'graph-legend-footer-right'];
    const hideBtns = ['legend-hide', 'legend-hide-right'];
    for (const id of footers) {
        const footer = document.getElementById(id);
        if (footer) footer.classList.toggle('is-collapsed', S.legendCollapsed);
    }
    for (const id of hideBtns) {
        const hideBtn = document.getElementById(id);
        if (hideBtn) hideBtn.textContent = S.legendCollapsed ? 'Show' : 'Hide';
    }
}

export function refreshCompareTargetGraphPane() {
    syncGraphViewKindForWorkspace(S.activeWorkspace);
    syncSplitWorkspaceLayout();
    renderSplitCompareStrip();
    renderSplitPaneInstanceLabels();
    renderToolbarState();
    renderGraphPaneControls();
    renderRolesGraphChrome();
    renderTargetRoleRail();
    renderLegendState();
    markRightGraphDirty();
    renderCompareTargetGraphIfActive();
}

export function renderInspectorPanelState() {
    // Inspector panel has been removed from the UI.
}

function activeWorkspaceTitle() {
    if (S.activeWorkspace === 'explore') return 'Explore';
    if (S.activeWorkspace === 'overview') return 'Overview';
    if (S.activeWorkspace === 'workflows') return 'Workflows';
    if (S.activeWorkspace === 'roles-matrix') return 'ROFP Matrix';
    if (S.activeWorkspace === 'import') return 'Import';
    if (S.activeWorkspace === 'compare') return 'Compare Instances';
    if (S.activeWorkspace === 'projects') return 'Projects';
    if (S.activeWorkspace === 'rbp-flow') return 'RBP Flow';
    return 'Graph';
}

function renderCurrentDetails() {
    if (S.activeWorkspace === 'workflows' && isSplitCompareLayoutVisible()) {
        syncWorkflowSplitDetailPanels();
    } else if (S.currentWorkflowCode && S.activeWorkspace === 'workflows') {
        showWorkflowDetails(S.workflowByCode.get(S.currentWorkflowCode), {
            sourcePane: 'left',
            detailProjectLabel: baseProjectLabel(),
        });
    } else if (
        S.currentWorkflowCodeRight &&
        S.activeWorkspace === 'workflows' &&
        S.compareTargetPrepared &&
        isSplitCompareLayoutVisible()
    ) {
        showWorkflowDetails(
            S.compareTargetPrepared.workflowByCode.get(S.currentWorkflowCodeRight),
            {
                sourcePane: 'right',
                detailProjectLabel: targetProjectLabel(),
            }
        );
    } else if (
        S.currentSelection?.nodeId &&
        !(
            S.activeWorkspace === 'explore' &&
            isSplitCompareLayoutVisible()
        )
    ) {
        const sid = S.currentSelection.nodeId;
        let detailNode = S.nodeById.get(sid);
        if (!detailNode) {
            const lower = sid.toLowerCase();
            for (const [k, v] of S.nodeById) {
                if (k.toLowerCase() === lower) {
                    detailNode = v;
                    break;
                }
            }
        }
        if (detailNode) {
            showEntityDetails(detailNode, {
                ...S.currentSelection,
                sourcePane: 'left',
                detailProjectLabel: baseProjectLabel(),
            });
        }
        else hideEntityDetails();
    } else if (S.currentWorkflowCode) {
        showWorkflowDetails(S.workflowByCode.get(S.currentWorkflowCode), {
            sourcePane: 'left',
            detailProjectLabel: baseProjectLabel(),
        });
    } else {
        hideEntityDetails();
    }
}

function resetWorkspaceChrome(scopeLabel: string) {
    clearGraph();
    renderGraphStatus(null);
    showOverviewState(false);
    document.getElementById('roles-graph-placeholder')?.classList.add('hidden');
    updateActiveScope(scopeLabel);
}

export function refreshWorkspace() {
    syncGraphViewKindForWorkspace(S.activeWorkspace);
    syncSplitWorkspaceLayout();
    renderSplitCompareStrip();
    renderSplitPaneInstanceLabels();
    void import('./compare/overlay').then(m => m.renderCompareOverlayBar());

    if (S.activeWorkspace === 'roles-matrix' && !isMatrixReady()) {
        void ensureMatrixLoaded().then(() => refreshWorkspace());
        return;
    }

    if (S.activeWorkspace === 'compare') {
        import('./lazy-loaders').then(({ isCompareWorkspaceReady, ensureCompareWorkspaceLoaded }) => {
            if (!isCompareWorkspaceReady()) {
                void ensureCompareWorkspaceLoaded().then(() => refreshWorkspace());
                return;
            }
        });
        // We'll return here if it was 'compare' but not ready? No, we need a slight adjustment so we don't proceed synchronously
        // Actually, just let it proceed and the fallback will catch it, or better:
    }

    const inspectorSkipped = ['import', 'projects', 'roles-matrix', 'compare'];
    const graphRoute = isGraphWorkspaceRoute();
    const needsInspector =
        !inspectorSkipped.includes(S.activeWorkspace) &&
        (
            !graphRoute ||
            Boolean(S.currentSelection?.nodeId || S.currentWorkflowCode || S.currentWorkflowCodeRight)
        );
    if (needsInspector && !isInspectorReady()) {
        // Explore lists and split inline detail load inspector via ensureInspectorLoaded locally;
        // don't block refresh here or the first paint never binds list delegation.
        if (S.activeWorkspace !== 'explore') {
            void ensureInspectorLoaded().then(() => refreshWorkspace());
            return;
        }
    }

    renderWorkspaceTabs();
    renderToolbarState();
    renderViewKindSwitcher();
    renderGraphPaneControls();
    renderModuleBar();
    renderObjectClassBar();
    renderOverviewModules();
    renderSearchResults();
    renderWorkflowList();
    renderRoleRail();
    renderTargetRoleRail();
    renderRolesGraphChrome();
    renderInspectorPanelState();
    renderGraphFocusList();
    renderLegendState();

    if (S.activeWorkspace === 'explore') {
        renderExploreWorkspace();
    }

    if (S.activeWorkspace === 'roles-matrix') {
        resetWorkspaceChrome('ROFP Matrix');
        const tr = document.getElementById('roles-matrix-title-right');
        if (tr && S.compareTargetProjectName) {
            tr.textContent = `ROFP Matrix · ${S.compareTargetProjectName}`;
        } else if (tr) {
            tr.textContent = 'ROFP Matrix (compare)';
        }
        renderPermissionMatrix();
        hideEntityDetails();
        return;
    }
    if (S.activeWorkspace === 'import') {
        resetWorkspaceChrome('Import');
        hideEntityDetails();
        renderImportWorkspace();
        return;
    }
    if (S.activeWorkspace === 'compare') {
        resetWorkspaceChrome('Compare Instances');
        hideEntityDetails();
        void import('./lazy-loaders').then(async mod => {
            await mod.ensureCompareWorkspaceLoaded();
            await mod.mountCompareWorkspace();
        });
        return;
    }
    if (S.activeWorkspace === 'projects') {
        resetWorkspaceChrome('Projects');
        hideEntityDetails();
        renderProjectsPanel();
        return;
    }
    if (!graphRoute) {
        resetWorkspaceChrome(activeWorkspaceTitle());
        renderCurrentDetails();
        return;
    }

    S.currentGraphData = buildGraphScope();
    updateActiveScope(buildActiveScopeLabel(S.currentGraphData));
    renderRoleLinksToggle();
    renderIsolatedToggle(S.currentGraphData);

    if (!S.currentGraphData) {
        showOverviewState(true);
        renderGraphStatus(null);
        clearGraph();
        document.getElementById('roles-graph-placeholder')?.classList.add('hidden');
        renderCurrentDetails();
        renderCompareTargetGraphIfActive();
        return;
    }

    const rolesPickEmpty = isAggregateRolesPickState() && S.currentGraphData.nodes.length === 0;
    document.getElementById('roles-graph-placeholder')?.classList.add('hidden');

    if (rolesPickEmpty) {
        showOverviewState(false);
        clearGraph();
        renderGraphStatus(S.currentGraphData);
        document.getElementById('roles-graph-placeholder')?.classList.remove('hidden');
        hideEntityDetails();
        renderCompareTargetGraphIfActive();
        return;
    }

    if (S.currentGraphData.nodes.length === 0) {
        showOverviewState(false);
        clearGraph();
        const graphCanvas = document.getElementById('graph-canvas');
        if (graphCanvas && S.currentGraphData.scopeLabel) {
            graphCanvas.innerHTML = `<div class="view-empty">${escapeHtml(S.currentGraphData.scopeLabel)}</div>`;
        }
        renderGraphStatus(S.currentGraphData);
        renderCurrentDetails();
        renderCompareTargetGraphIfActive();
        return;
    }

    showOverviewState(false);
    renderGraphStatus(S.currentGraphData);
    renderGraph(S.currentGraphData);
    applyOverlays();
    renderCurrentDetails();
    renderCompareTargetGraphIfActive();
}
