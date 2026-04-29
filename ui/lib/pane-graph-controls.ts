import { appState as S, patchAppState } from './store';
import type { AnyDashboard, AnyNode, ViewKind } from './types';
import { clearGraphFocus } from './node-selection';
import { isSplitCompareLayoutVisible } from './split-compare';
import { refreshCompareTargetGraphPane, refreshWorkspace } from './workspace';
import { escapeAttribute, escapeHtml } from './utils';
import { updatePaneSearchResults, hidePaneSearchResults } from './search';
import { zoomIdentity } from 'd3-zoom';

type GraphPane = 'left' | 'right';

export type GraphControlState = {
    viewKind: ViewKind;
    module: string;
    subModule: string;
    view: string;
    objectClass: string;
    includeRolePermissionLinks: boolean;
    showIsolated: boolean;
};

const STANDARD_VIEW_KINDS: ViewKind[] = ['suite', 'blueprint', 'drilldown'];
const DRILLDOWN_NODE_TYPES = [
    { value: 'all', label: 'All' },
    { value: 'MDF_OBJECT', label: 'Objects' },
    { value: 'BUSINESS_RULE', label: 'Rules' },
    { value: 'RBP_ROLE', label: 'Roles' },
    { value: 'ODATA_ENTITY', label: 'OData' },
];
const OBJECT_CLASSES = [
    { value: 'ALL_OBJECTS', label: 'All Objects' },
    { value: 'FOUNDATION', label: 'Foundation' },
    { value: 'MDF', label: 'MDF' },
    { value: 'GENERIC', label: 'Generic' },
];

export function getBaseGraphControlState(): GraphControlState {
    return {
        viewKind: S.currentViewKind,
        module: S.currentModule,
        subModule: S.currentSubModule,
        view: S.currentView,
        objectClass: S.currentObjectClass,
        includeRolePermissionLinks: S.includeRolePermissionLinks,
        showIsolated: S.showIsolated,
    };
}

export function getTargetGraphControlState(): GraphControlState {
    return {
        viewKind: S.activeWorkspace === 'rbp-flow' || S.currentViewKind === 'rbp-flow'
            ? 'rbp-flow'
            : S.compareTargetViewKind,
        module: S.compareTargetModule,
        subModule: S.compareTargetSubModule,
        view: S.compareTargetView,
        objectClass: S.compareTargetObjectClass,
        includeRolePermissionLinks: S.compareTargetIncludeRolePermissionLinks,
        showIsolated: S.compareTargetShowIsolated,
    };
}

export function getPaneGraphControlState(pane: GraphPane): GraphControlState {
    return pane === 'right' ? getTargetGraphControlState() : getBaseGraphControlState();
}

export function applyGraphControlStateToActiveState(state: GraphControlState) {
    S.currentViewKind = state.viewKind;
    S.currentModule = state.module;
    S.currentSubModule = state.subModule;
    S.currentView = state.view;
    S.currentObjectClass = state.objectClass;
    S.includeRolePermissionLinks = state.includeRolePermissionLinks;
    S.showIsolated = state.showIsolated;
}

function setPaneGraphControlState(pane: GraphPane, next: Partial<GraphControlState>) {
    if (pane === 'left') {
        if (next.viewKind !== undefined) S.currentViewKind = next.viewKind;
        if (next.module !== undefined) S.currentModule = next.module;
        if (next.subModule !== undefined) S.currentSubModule = next.subModule;
        if (next.view !== undefined) S.currentView = next.view;
        if (next.objectClass !== undefined) S.currentObjectClass = next.objectClass;
        if (next.includeRolePermissionLinks !== undefined) S.includeRolePermissionLinks = next.includeRolePermissionLinks;
        if (next.showIsolated !== undefined) S.showIsolated = next.showIsolated;
        return;
    }

    patchAppState({
        ...(next.viewKind !== undefined ? { compareTargetViewKind: next.viewKind } : {}),
        ...(next.module !== undefined ? { compareTargetModule: next.module } : {}),
        ...(next.subModule !== undefined ? { compareTargetSubModule: next.subModule } : {}),
        ...(next.view !== undefined ? { compareTargetView: next.view } : {}),
        ...(next.objectClass !== undefined ? { compareTargetObjectClass: next.objectClass } : {}),
        ...(next.includeRolePermissionLinks !== undefined
            ? { compareTargetIncludeRolePermissionLinks: next.includeRolePermissionLinks }
            : {}),
        ...(next.showIsolated !== undefined ? { compareTargetShowIsolated: next.showIsolated } : {}),
    });
}

function resetPaneFocus(pane: GraphPane) {
    if (pane === 'left') {
        S.currentSelection = null;
        S.currentWorkflowCode = null;
        S.focusRequestId = null;
        clearGraphFocus();
        return;
    }

    patchAppState({
        compareTargetGraphFocusNodeId: null,
        currentWorkflowCodeRight: null,
        graphFocusAfterRenderHost: null,
    });
}

function dashboardForPane(pane: GraphPane): AnyDashboard | null {
    return pane === 'right' ? S.compareTargetPrepared?.dashboard ?? null : S.dashboard;
}

function nodesForPane(pane: GraphPane): AnyNode[] {
    return pane === 'right' ? S.compareTargetPrepared?.allNodes ?? [] : S.allNodes;
}

function canToggleRolePermissionLinks(state: GraphControlState): boolean {
    return !(state.viewKind === 'drilldown' && state.module === 'ALL');
}

function paneFromDataset(element: Element): GraphPane {
    if (!(element instanceof HTMLElement)) return 'left';
    const dataset = element.dataset ?? {};
    return dataset.graphPane === 'right' ? 'right' : 'left';
}

function dataValue(element: Element, key: string, fallback: string): string {
    if (!(element instanceof HTMLElement)) return fallback;
    const dataset = element.dataset ?? {};
    return dataset[key] ?? fallback;
}

function viewKindLabel(kind: ViewKind): string {
    if (kind === 'suite') return 'Suite';
    if (kind === 'blueprint') return 'Blueprint';
    if (kind === 'drilldown') return 'Drilldown';
    return 'RBP Flow';
}

function renderViewKindButtons(state: GraphControlState, pane: GraphPane) {
    return STANDARD_VIEW_KINDS.map(kind => `
        <button
            class="graph-pane-control-btn${state.viewKind === kind ? ' active' : ''}"
            data-graph-pane="${pane}"
            data-pane-view-kind="${kind}"
            type="button"
        >${viewKindLabel(kind)}</button>
    `).join('');
}

function renderModuleButtons(state: GraphControlState, pane: GraphPane, dashboard: AnyDashboard | null, nodes: AnyNode[]) {
    const families = dashboard?.stats?.moduleBreakdown?.families ?? [];
    const items = [{ family: 'ALL', label: 'All Modules', nodeCount: nodes.length }, ...families];
    return items.map(item => `
        <button
            class="graph-pane-chip${state.module === item.family ? ' active' : ''}"
            data-graph-pane="${pane}"
            data-pane-module="${escapeAttribute(item.family)}"
            type="button"
        >
            <span>${escapeHtml(item.label || item.family)}</span>
            <small>${(item.nodeCount || 0).toLocaleString()} nodes</small>
        </button>
    `).join('');
}

function renderSubModuleButtons(state: GraphControlState, pane: GraphPane, dashboard: AnyDashboard | null, nodes: AnyNode[]) {
    if (state.module === 'ALL') return '';
    const subMods = dashboard?.stats?.moduleBreakdown?.subModulesByFamily?.[state.module] || [];
    if (subMods.length <= 1) return '';
    const allItem = {
        subModule: 'ALL',
        nodeCount: nodes.filter(n => n.moduleFamily === state.module).length,
    };
    return [allItem, ...subMods].map(item => `
        <button
            class="graph-pane-chip graph-pane-chip--sub${state.subModule === item.subModule ? ' active' : ''}"
            data-graph-pane="${pane}"
            data-pane-submodule="${escapeAttribute(item.subModule)}"
            type="button"
        >
            <span>${escapeHtml(item.subModule === 'ALL' ? 'All Sub-Modules' : item.subModule)}</span>
            <small>${(item.nodeCount || 0).toLocaleString()}</small>
        </button>
    `).join('');
}

function renderDrilldownControls(state: GraphControlState, pane: GraphPane) {
    if (state.viewKind !== 'drilldown') return '';
    const roleLinksCanToggle = canToggleRolePermissionLinks(state);
    const roleLinksOn = state.view === 'RBP_ROLE' || state.includeRolePermissionLinks;
    const roleLinkLabel = state.view === 'RBP_ROLE'
        ? 'Role links on'
        : state.includeRolePermissionLinks
            ? 'Hide role links'
            : 'Show role links';

    return `
        <div class="graph-pane-controls-row graph-pane-controls-row--drilldown">
            <div class="graph-pane-segmented" aria-label="${pane} graph node type filter">
                ${DRILLDOWN_NODE_TYPES.map(item => `
                    <button
                        class="graph-pane-control-btn${state.view === item.value ? ' active' : ''}"
                        data-graph-pane="${pane}"
                        data-pane-node-view="${escapeAttribute(item.value)}"
                        type="button"
                    >${escapeHtml(item.label)}</button>
                `).join('')}
            </div>
            <div class="graph-pane-segmented" aria-label="${pane} graph object class filter">
                ${OBJECT_CLASSES.map(item => `
                    <button
                        class="graph-pane-control-btn${state.objectClass === item.value ? ' active' : ''}"
                        data-graph-pane="${pane}"
                        data-pane-object-class="${escapeAttribute(item.value)}"
                        type="button"
                    >${escapeHtml(item.label)}</button>
                `).join('')}
            </div>
            <button
                class="graph-pane-control-btn${roleLinksOn ? ' active' : ''}${roleLinksCanToggle ? '' : ' hidden'}"
                data-graph-pane="${pane}"
                data-pane-toggle-role-links="1"
                type="button"
                ${state.view === 'RBP_ROLE' ? 'disabled' : ''}
            >${escapeHtml(roleLinkLabel)}</button>
            <button
                class="graph-pane-control-btn${state.showIsolated ? ' active' : ''}"
                data-graph-pane="${pane}"
                data-pane-toggle-isolated="1"
                type="button"
            >${state.showIsolated ? 'Hide low-signal' : 'Show low-signal'}</button>
        </div>
    `;
}

function renderPaneControls(container: HTMLElement, pane: GraphPane) {
    const state = getPaneGraphControlState(pane);
    const dashboard = dashboardForPane(pane);
    const nodes = nodesForPane(pane);
    const subModulesHtml = renderSubModuleButtons(state, pane, dashboard, nodes);
    const title = pane === 'right' ? 'Target graph controls' : 'Base graph controls';
    const viewLabel = state.viewKind === 'blueprint' && state.module !== 'ALL'
        ? `Blueprint: ${state.module}`
        : viewKindLabel(state.viewKind);

    const collapsed = pane === 'left' ? S.paneControlsCollapsedLeft : S.paneControlsCollapsedRight;
    const query = pane === 'left' ? S.paneSearchQueryLeft : S.paneSearchQueryRight;
    const collapseIcon = collapsed ? '▸' : '▾';
    const collapseLabel = collapsed ? 'Show controls' : 'Hide controls';

    container.classList.toggle('is-collapsed', collapsed);

    if (collapsed) {
        container.innerHTML = `
            <div class="graph-pane-controls-collapsed-strip">
                <span class="graph-pane-controls-title">${escapeHtml(title)}</span>
                <span class="graph-pane-controls-current">${escapeHtml(viewLabel)}</span>
                <span class="graph-pane-controls-spacer"></span>
                <div class="graph-pane-zoom-group" aria-label="Zoom ${pane} pane">
                    <button type="button" class="graph-pane-zoom-btn" data-graph-pane="${pane}" data-pane-zoom="in" title="Zoom in">➕</button>
                    <button type="button" class="graph-pane-zoom-btn" data-graph-pane="${pane}" data-pane-zoom="out" title="Zoom out">➖</button>
                    <button type="button" class="graph-pane-zoom-btn" data-graph-pane="${pane}" data-pane-zoom="reset" title="Reset zoom">↺</button>
                </div>
                <button type="button" class="graph-pane-collapse-toggle" data-graph-pane="${pane}" data-pane-collapse-toggle="1" title="${collapseLabel}">${collapseIcon} ${escapeHtml(collapseLabel)}</button>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="graph-pane-controls-row">
            <span class="graph-pane-controls-title">${escapeHtml(title)}</span>
            <div class="graph-pane-segmented" aria-label="${pane} graph visualization">
                ${renderViewKindButtons(state, pane)}
            </div>
            <span class="graph-pane-controls-current">${escapeHtml(viewLabel)}</span>
            <span class="graph-pane-controls-spacer"></span>
            <div class="graph-pane-zoom-group" aria-label="Zoom ${pane} pane">
                <button type="button" class="graph-pane-zoom-btn" data-graph-pane="${pane}" data-pane-zoom="in" title="Zoom in">➕</button>
                <button type="button" class="graph-pane-zoom-btn" data-graph-pane="${pane}" data-pane-zoom="out" title="Zoom out">➖</button>
                <button type="button" class="graph-pane-zoom-btn" data-graph-pane="${pane}" data-pane-zoom="reset" title="Reset zoom">↺</button>
            </div>
            <button type="button" class="graph-pane-collapse-toggle" data-graph-pane="${pane}" data-pane-collapse-toggle="1" title="${collapseLabel}">${collapseIcon} ${escapeHtml(collapseLabel)}</button>
        </div>
        <div class="graph-pane-search-row">
            <div class="graph-pane-search-shell">
                <input type="search" class="graph-pane-search-input" id="graph-pane-search-input-${pane}"
                       placeholder="Find node in graph..." autocomplete="off"
                       data-graph-pane="${pane}"
                       value="${escapeAttribute(query)}" />
                <button type="button" class="graph-pane-search-clear" data-graph-pane="${pane}" data-pane-search-clear="1">Clear</button>
            </div>
            <div class="graph-pane-search-results graph-finder-results hidden" id="graph-pane-search-results-${pane}"></div>
        </div>
        <div class="graph-pane-chip-row" aria-label="${pane} graph modules">
            ${renderModuleButtons(state, pane, dashboard, nodes)}
        </div>
        ${subModulesHtml ? `<div class="graph-pane-chip-row graph-pane-chip-row--submodules" aria-label="${pane} graph submodules">${subModulesHtml}</div>` : ''}
        ${renderDrilldownControls(state, pane)}
    `;
}

function bindPaneControlEvents(container: HTMLElement) {
    const refreshPane = (pane: GraphPane) => {
        if (pane === 'right') {
            refreshCompareTargetGraphPane();
            return;
        }
        refreshWorkspace();
    };

    container.querySelectorAll('[data-pane-view-kind]').forEach(button => {
        button.addEventListener('click', () => {
            const pane = paneFromDataset(button);
            const viewKind = dataValue(button, 'paneViewKind', 'suite') as ViewKind;
            const current = getPaneGraphControlState(pane);
            if (current.viewKind === viewKind) return;
            setPaneGraphControlState(pane, { viewKind });
            resetPaneFocus(pane);
            refreshPane(pane);
        });
    });

    container.querySelectorAll('[data-pane-module]').forEach(button => {
        button.addEventListener('click', () => {
            const pane = paneFromDataset(button);
            const module = dataValue(button, 'paneModule', 'ALL');
            const current = getPaneGraphControlState(pane);
            const viewKind = current.viewKind === 'suite' && module !== 'ALL' ? 'blueprint' : current.viewKind;
            setPaneGraphControlState(pane, { module, subModule: 'ALL', viewKind });
            resetPaneFocus(pane);
            refreshPane(pane);
        });
    });

    container.querySelectorAll('[data-pane-submodule]').forEach(button => {
        button.addEventListener('click', () => {
            const pane = paneFromDataset(button);
            const subModule = dataValue(button, 'paneSubmodule', 'ALL');
            setPaneGraphControlState(pane, { subModule });
            resetPaneFocus(pane);
            refreshPane(pane);
        });
    });

    container.querySelectorAll('[data-pane-node-view]').forEach(button => {
        button.addEventListener('click', () => {
            const pane = paneFromDataset(button);
            const view = dataValue(button, 'paneNodeView', 'all');
            setPaneGraphControlState(pane, { view });
            resetPaneFocus(pane);
            refreshPane(pane);
        });
    });

    container.querySelectorAll('[data-pane-object-class]').forEach(button => {
        button.addEventListener('click', () => {
            const pane = paneFromDataset(button);
            const objectClass = dataValue(button, 'paneObjectClass', 'ALL_OBJECTS');
            setPaneGraphControlState(pane, { objectClass });
            resetPaneFocus(pane);
            refreshPane(pane);
        });
    });

    container.querySelectorAll('[data-pane-toggle-role-links]').forEach(button => {
        button.addEventListener('click', () => {
            const pane = paneFromDataset(button);
            const current = getPaneGraphControlState(pane);
            if (current.view === 'RBP_ROLE') return;
            setPaneGraphControlState(pane, {
                includeRolePermissionLinks: !current.includeRolePermissionLinks,
            });
            refreshPane(pane);
        });
    });

    container.querySelectorAll('[data-pane-toggle-isolated]').forEach(button => {
        button.addEventListener('click', () => {
            const pane = paneFromDataset(button);
            const current = getPaneGraphControlState(pane);
            setPaneGraphControlState(pane, { showIsolated: !current.showIsolated });
            refreshPane(pane);
        });
    });

    /* ── collapse toggle ── */
    container.querySelectorAll('[data-pane-collapse-toggle]').forEach(button => {
        button.addEventListener('click', () => {
            const pane = paneFromDataset(button);
            if (pane === 'left') {
                S.paneControlsCollapsedLeft = !S.paneControlsCollapsedLeft;
            } else {
                S.paneControlsCollapsedRight = !S.paneControlsCollapsedRight;
            }
            renderGraphPaneControls();
        });
    });

    /* ── per-pane search ── */
    container.querySelectorAll('.graph-pane-search-input').forEach(input => {
        const pane = paneFromDataset(input);
        input.addEventListener('input', () => {
            const value = (input as HTMLInputElement).value;
            if (pane === 'left') S.paneSearchQueryLeft = value;
            else S.paneSearchQueryRight = value;
            updatePaneSearchResults(pane);
        });
        input.addEventListener('keydown', (e) => {
            if ((e as KeyboardEvent).key === 'Escape') {
                (input as HTMLInputElement).value = '';
                if (pane === 'left') S.paneSearchQueryLeft = '';
                else S.paneSearchQueryRight = '';
                hidePaneSearchResults(pane);
            }
        });
    });

    container.querySelectorAll('[data-pane-search-clear]').forEach(button => {
        button.addEventListener('click', () => {
            const pane = paneFromDataset(button);
            const input = container.querySelector(`#graph-pane-search-input-${pane}`) as HTMLInputElement | null;
            if (input) input.value = '';
            if (pane === 'left') {
                S.paneSearchQueryLeft = '';
                S.paneSearchResultsLeft = [];
            } else {
                S.paneSearchQueryRight = '';
                S.paneSearchResultsRight = [];
            }
            hidePaneSearchResults(pane);
        });
    });

    /* ── per-pane zoom ── */
    container.querySelectorAll('[data-pane-zoom]').forEach(button => {
        button.addEventListener('click', () => {
            const pane = paneFromDataset(button);
            const action = dataValue(button, 'paneZoom', '');
            const refs = pane === 'right'
                ? { svg: S.graphRightSvg, zoom: S.graphRightZoomBehavior }
                : { svg: S.svg, zoom: S.zoomBehavior };
            if (!refs.svg || !refs.zoom) return;
            if (action === 'in') refs.svg.transition().call(refs.zoom.scaleBy as any, 1.25);
            else if (action === 'out') refs.svg.transition().call(refs.zoom.scaleBy as any, 0.8);
            else if (action === 'reset') refs.svg.transition().call(refs.zoom.transform as any, zoomIdentity);
        });
    });
}

export function renderGraphPaneControls() {
    const shouldShow = S.activeWorkspace === 'graph' && isSplitCompareLayoutVisible() && !S.controlsCollapsed;
    (['left', 'right'] as GraphPane[]).forEach(pane => {
        const container = document.getElementById(`graph-pane-controls-${pane}`);
        if (!container) return;
        if (!shouldShow || (pane === 'right' && !S.compareTargetPrepared)) {
            container.setAttribute('hidden', '');
            container.innerHTML = '';
            return;
        }
        container.removeAttribute('hidden');
        renderPaneControls(container, pane);
        bindPaneControlEvents(container);
    });

    /* Hide main toolbar graph-finder when split compare is visible */
    const graphFinderShell = document.querySelector('.graph-finder-shell') as HTMLElement | null;
    if (graphFinderShell) {
        graphFinderShell.classList.toggle('hidden', shouldShow);
    }
}
