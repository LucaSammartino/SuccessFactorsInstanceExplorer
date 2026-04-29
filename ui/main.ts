import { zoomIdentity } from 'd3-zoom';
import '@ui5/webcomponents-fiori/dist/ShellBar.js';
import '@ui5/webcomponents/dist/Button.js';
import '@ui5/webcomponents/dist/Panel.js';
import '@ui5/webcomponents/dist/Popover.js';
import '@ui5/webcomponents/dist/List.js';
import '@ui5/webcomponents/dist/ListItemStandard.js';
import '@ui5/webcomponents/dist/SegmentedButton.js';
import '@ui5/webcomponents/dist/SegmentedButtonItem.js';
import '@ui5/webcomponents/dist/Select.js';
import '@ui5/webcomponents/dist/Option.js';
import '@ui5/webcomponents/dist/Input.js';
import '@ui5/webcomponents/dist/MessageStrip.js';
import '@ui5/webcomponents/dist/Token.js';
import '@ui5/webcomponents/dist/Card.js';
import '@ui5/webcomponents/dist/CardHeader.js';

import './lib/register-app-icons';

import type { AnyDashboard } from './lib/types';
import { detectServer, fetchProjects, loadProject } from './lib/project-api';
import { appState as S, patchAppState } from './lib/store';
import { fetchJson, escapeHtml } from './lib/utils';
import { updateGraphFinderResults, hideGraphFinderResults } from './lib/search';
import { hideHoverPanel, renderGraphStatus, resetLayout } from './lib/graph-render';
import type { ViewKind } from './lib/types';
import { bindExploreControls } from './lib/explore';
import { prepareData, populateAnalytics } from './lib/data-prepare';
import {
    renderViewKindSwitcher,
    applyPathFind,
    clearPathFindFn,
    rememberStandardGraphView,
} from './lib/view-kind';
import { selectNode, setGraphFocusNode, clearGraphFocus } from './lib/node-selection';
import { renderRoleRail, renderTargetRoleRail, shouldShowRoleRail } from './lib/role-rail';
import { bindWorkflowDetailCloseButtons, renderWorkflowList } from './lib/workflow-panel';
import { bindDropZones, bindExportLogButtons, ensureProjectsPanelLoaded, handleCreateProject, handleDetectProfile, handleImportSubmit, renderProjectsPanel, showNewProjectForm } from './lib/lazy-loaders';
import { applyInitialWorkspaceFromHash, refreshWorkspace, renderInspectorPanelState, renderLegendState, renderToolbarState, setActiveWorkspace } from './lib/workspace';
import { renderGraphPaneControls } from './lib/pane-graph-controls';
import { isSplitCompareLayoutVisible } from './lib/split-compare';

// ── Init ──────────────────────────────────────────────────────────────────────

function renderFatalLoadError(err: Error): void {
    console.error('[main] Could not load ./data.json:', err);
    const message = `${err.name}: ${err.message}`;
    document.body.innerHTML = `
        <div style="padding: 2rem; max-width: 640px; margin: 4rem auto; font-family: system-ui, sans-serif;">
            <h1 style="margin: 0 0 1rem; color: #c0392b;">Could not load <code>./data.json</code></h1>
            <p>The UI is running in static mode and expects a generated <code>data.json</code> beside <code>index.html</code>. Generate it via <code>npm run main</code>, then reload.</p>
            <p style="font-size: 0.85em; color: #666;">${escapeHtml(message)}</p>
        </div>
    `;
}

async function init() {
    await ensureProjectsPanelLoaded();
    const usingServer = await detectServer();

    if (usingServer) {
        S.allProjects = await fetchProjects();
        const lastProjectId = localStorage.getItem('sf_active_project');
        const candidate = lastProjectId && S.allProjects.find(p => p.id === lastProjectId);
        if (candidate) {
            await loadProject(candidate.id, candidate.name);
        } else if (S.allProjects.length > 0) {
            await loadProject(S.allProjects[0].id, S.allProjects[0].name);
        } else {
            setActiveWorkspace('import');
            renderProjectsPanel();
            applyInitialWorkspaceFromHash();
            if (!location.hash) {
                history.replaceState(null, '', `${location.pathname}${location.search}#import`);
            }
            bindControls();
            void import('./dashboard/bootstrap').then(m => m.mountDashboardApp());
            refreshWorkspace();
            return;
        }
    } else {
        let dashboard: AnyDashboard;
        try {
            dashboard = await fetchJson<AnyDashboard>('./data.json');
        } catch (err) {
            renderFatalLoadError(err as Error);
            return;
        }
        patchAppState({ dashboard });
        prepareData(dashboard);
        populateAnalytics(dashboard);
    }

    applyInitialWorkspaceFromHash();
    if (!location.hash) {
        history.replaceState(null, '', `${location.pathname}${location.search}#overview`);
    }
    bindControls();
    void import('./dashboard/bootstrap').then(m => m.mountDashboardApp());
    refreshWorkspace();
}

// ── Workspace orchestration ───────────────────────────────────────────────────

function bindControls() {
    const bindZoomControls = (ids: { inId: string; outId: string; resetId: string; pane: 'left' | 'right' }) => {
        const getZoomRefs = () => ids.pane === 'right'
            ? { svg: S.graphRightSvg, zoom: S.graphRightZoomBehavior }
            : { svg: S.svg, zoom: S.zoomBehavior };

        document.getElementById(ids.inId)?.addEventListener('click', () => {
            const { svg, zoom } = getZoomRefs();
            if (svg && zoom) svg.transition().call(zoom.scaleBy as any, 1.25);
        });
        document.getElementById(ids.outId)?.addEventListener('click', () => {
            const { svg, zoom } = getZoomRefs();
            if (svg && zoom) svg.transition().call(zoom.scaleBy as any, 0.8);
        });
        document.getElementById(ids.resetId)?.addEventListener('click', () => {
            const { svg, zoom } = getZoomRefs();
            if (svg && zoom) svg.transition().call(zoom.transform as any, zoomIdentity);
        });
    };

document.getElementById('controls-toggle')?.addEventListener('click', () => {
        S.controlsCollapsed = !S.controlsCollapsed;
        renderToolbarState();
        renderGraphPaneControls();
        if (isSplitCompareLayoutVisible()) return;
        refreshWorkspace();
    });

    document.getElementById('modules-toggle')?.addEventListener('click', () => {
        const bar = document.getElementById('module-bar');
        const btn = document.getElementById('modules-toggle');
        const isHidden = bar?.classList.toggle('hidden');
        if (btn) (btn as any).design = isHidden ? 'Default' : 'Emphasized';
    });

    document.getElementById('view-switcher')?.addEventListener('selection-change', event => {
        const detail = (event as CustomEvent<{ selectedItems?: HTMLElement[] }>).detail;
        const selected = detail?.selectedItems?.[0];
        if (!selected) return;
        S.currentView = selected.dataset?.view ?? '';
        S.currentSelection = null;
        S.currentWorkflowCode = null;
        S.focusRequestId = null;
        clearGraphFocus();
        S.hoveredComponentId = null;
        hideHoverPanel();
        refreshWorkspace();
    });

    document.getElementById('graph-finder-input')?.addEventListener('input', event => {
        S.currentGraphFinderQuery = (event.target as HTMLInputElement).value.trim();
        updateGraphFinderResults();
    });

    document.getElementById('graph-finder-input')?.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); hideGraphFinderResults(); }
    });

    document.getElementById('graph-finder-clear')?.addEventListener('click', () => {
        S.currentGraphFinderQuery = '';
        S.currentGraphFinderResults = [];
        const input = document.getElementById('graph-finder-input') as HTMLInputElement | null;
        if (input) input.value = '';
        hideGraphFinderResults();
    });

    bindDropZones();
    bindExportLogButtons();
    document.getElementById('import-form')?.addEventListener('submit', handleImportSubmit);
    document.getElementById('import-detect-btn')?.addEventListener('click', handleDetectProfile);
    document.getElementById('import-switch-project')?.addEventListener('click', () => setActiveWorkspace('projects'));
    document.getElementById('import-new-project')?.addEventListener('click', () => { setActiveWorkspace('projects'); showNewProjectForm(); });
    document.getElementById('import-log-dismiss')?.addEventListener('click', () => { document.getElementById('import-log')?.classList.add('hidden'); });
    document.getElementById('import-load-project')?.addEventListener('click', async () => {
        if (!S.activeProjectId) return;
        const loaded = await loadProject(S.activeProjectId, S.activeProjectName);
        if (loaded) setActiveWorkspace('graph');
    });

    document.getElementById('projects-new-btn')?.addEventListener('click', showNewProjectForm);
    document.getElementById('new-project-create')?.addEventListener('click', handleCreateProject);
    document.getElementById('new-project-cancel')?.addEventListener('click', () => { document.getElementById('new-project-form')?.classList.add('hidden'); });
    document.getElementById('new-project-name')?.addEventListener('keydown', event => { if (event.key === 'Enter') handleCreateProject(); });

    document.getElementById('workflow-search')?.addEventListener('input', event => {
        S.currentWorkflowQuery = (event.target as HTMLInputElement).value.trim().toLowerCase();
        renderWorkflowList();
    });
    document.getElementById('workflow-search-right')?.addEventListener('input', event => {
        S.currentWorkflowQueryRight = (event.target as HTMLInputElement).value.trim().toLowerCase();
        renderWorkflowList();
    });
    bindWorkflowDetailCloseButtons();

    const bindLegendToggle = (id: string) => {
        document.getElementById(id)?.addEventListener('click', () => {
            S.legendCollapsed = !S.legendCollapsed;
            renderLegendState();
        });
    };
    bindLegendToggle('legend-hide');
    bindLegendToggle('legend-hide-right');

    bindZoomControls({ inId: 'zoom-in', outId: 'zoom-out', resetId: 'reset-zoom', pane: 'left' });
    bindZoomControls({ inId: 'graph-zoom-in-left', outId: 'graph-zoom-out-left', resetId: 'graph-zoom-reset-left', pane: 'left' });
    bindZoomControls({ inId: 'graph-zoom-in-right', outId: 'graph-zoom-out-right', resetId: 'graph-zoom-reset-right', pane: 'right' });

    // View-kind switcher — standard graph views only. RBP Flow has its own workspace tab.
    document.getElementById('view-kind-switcher')?.addEventListener('click', event => {
        const btn = (event.target as HTMLElement).closest('[data-view-kind]') as HTMLElement | null;
        if (!btn) return;
        const kind = (btn.dataset?.viewKind ?? '') as ViewKind;
        if (!kind || kind === S.currentViewKind) return;

        rememberStandardGraphView(kind);
        S.currentViewKind = kind;
        S.focusRequestId = null;
        clearPathFindFn();
        S.currentSelection = null;
        clearGraphFocus();
        patchAppState({ compareTargetGraphFocusNodeId: null });

        renderViewKindSwitcher();
        refreshWorkspace();
    });

    document.addEventListener('keydown', event => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        if (event.key === 'Escape') {
            clearPathFindFn();
        }
    });

    document.getElementById('detail-page-body')?.addEventListener('click', event => {
        const focusTarget = (event.target as HTMLElement)?.closest('[data-focus-node-id]');
        if (focusTarget) {
            const nodeId = focusTarget.getAttribute('data-focus-node-id')!;
            if (S.nodeById.has(nodeId)) {
                setGraphFocusNode(nodeId);
                S.currentSelection = null;
                S.currentWorkflowCode = null;
                S.focusRequestId = nodeId;
                refreshWorkspace();
            }
            return;
        }
        const target = (event.target as HTMLElement)?.closest('[data-node-id]');
        if (!target) return;
        const nodeId = target.getAttribute('data-node-id')!;
        if (S.nodeById.has(nodeId)) selectNode(nodeId, { type: 'DETAIL_LINK', fromSearch: false });
    });

    document.getElementById('detail-back')?.addEventListener('click', () => {
        S.currentSelection = null;
        S.currentWorkflowCode = null;
        S.currentWorkflowCodeRight = null;
        refreshWorkspace();
    });
    document.getElementById('inspector-toggle')?.addEventListener('click', () => { S.rightSidebarCollapsed = !S.rightSidebarCollapsed; renderInspectorPanelState(); });
    document.getElementById('toggle-isolated')?.addEventListener('click', () => { S.showIsolated = !S.showIsolated; refreshWorkspace(); });
    document.getElementById('reset-layout')?.addEventListener('click', () => { resetLayout(); });
    document.getElementById('toggle-role-links')?.addEventListener('click', () => {
        if (S.currentView === 'RBP_ROLE') return;
        S.includeRolePermissionLinks = !S.includeRolePermissionLinks;
        refreshWorkspace();
    });
    document.getElementById('role-rail-hide')?.addEventListener('click', () => {
        S.roleRailCollapsed = true;
        refreshWorkspace();
    });
    document.getElementById('role-rail-hide-target')?.addEventListener('click', () => {
        S.roleRailCollapsed = true;
        refreshWorkspace();
    });
    document.getElementById('role-rail-show')?.addEventListener('click', () => {
        S.roleRailCollapsed = false;
        refreshWorkspace();
    });
    document.getElementById('role-rail-search')?.addEventListener('input', event => {
        S.currentRoleRailQueryBase = (event.target as HTMLInputElement).value;
        renderRoleRail();
    });
    document.getElementById('role-rail-search-target')?.addEventListener('input', event => {
        S.currentRoleRailQueryTarget = (event.target as HTMLInputElement).value;
        renderTargetRoleRail();
    });
    document.getElementById('role-rail-clear-focus')?.addEventListener('click', () => {
        if (!shouldShowRoleRail()) return;
        clearGraphFocus();
        S.focusRequestId = null;
        refreshWorkspace();
    });
    document.getElementById('role-rail-clear-focus-target')?.addEventListener('click', () => {
        if (!shouldShowRoleRail() || !isSplitCompareLayoutVisible()) return;
        patchAppState({ compareTargetGraphFocusNodeId: null });
        refreshWorkspace();
    });

    document.querySelectorAll('.workspace-tab').forEach(button => {
        const tab = button as HTMLElement;
        tab.addEventListener('click', () => {
            if (tab.dataset?.workspace === 'explore') {
                const popover = document.getElementById('explore-popover') as any;
                if (popover) { popover.opener = tab; popover.open = true; }
            } else {
                setActiveWorkspace(tab.dataset?.workspace ?? '');
            }
        });
    });

    bindExploreControls();

    window.addEventListener('hashchange', () => {
        applyInitialWorkspaceFromHash();
        patchAppState({});
        refreshWorkspace();
    });
}

init();
