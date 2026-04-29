import { appState as S, patchAppState } from '../store';
import { escapeHtml } from '../utils';
import { setActiveWorkspace } from '../workspace';
import { setGraphFocusNode } from '../node-selection';
import { activateRbpFlowMode } from '../view-kind';
import { activateCompareOverlay } from './overlay';
import { compareState } from './index';
import { buildEntityIndex, type EntityKind, type EntityRow } from './entity-index';

type ActionId =
    | 'open-drilldown'
    | 'open-rbp-flow'
    | 'open-rofp-matrix'
    | 'open-rule-explorer'
    | 'open-object-explorer'
    | 'open-workflows'
    | 'open-parent-object';

type ActionDef = {
    id: ActionId;
    label: string;
    handler: (row: EntityRow) => void;
};

function focusNodeIdForRow(row: EntityRow): string {
    if (row.kind === 'FIELD' && row.parentId) return row.parentId;
    return row.id;
}

function jumpToDrilldown(row: EntityRow) {
    const focusId = focusNodeIdForRow(row);
    activateCompareOverlay(focusId, row.id);
    S.currentViewKind = 'drilldown';
    setGraphFocusNode(focusId);
    setActiveWorkspace('graph');
}

function jumpToRbpFlow(row: EntityRow) {
    const focusId = focusNodeIdForRow(row);
    activateCompareOverlay(focusId, row.id);
    activateRbpFlowMode();
    setGraphFocusNode(focusId);
    setActiveWorkspace('rbp-flow');
}

function jumpToRofpMatrix(row: EntityRow) {
    const focusId = focusNodeIdForRow(row);
    activateCompareOverlay(focusId, row.id);
    if (row.kind === 'RBP_ROLE') {
        patchAppState({
            matrixSelectedRoleIds: [focusId],
            matrixSelectedObjectIds: [],
        });
    } else if (row.kind === 'MDF_OBJECT' || row.kind === 'FIELD') {
        patchAppState({
            matrixSelectedObjectIds: [focusId],
            matrixSelectedRoleIds: [],
        });
    }
    setActiveWorkspace('roles-matrix');
}

function jumpToExplore(row: EntityRow, view: 'rules' | 'objects' | 'roles' | 'odata') {
    const focusId = focusNodeIdForRow(row);
    activateCompareOverlay(focusId, row.id);

    const detailSelection = { nodeId: focusId, type: 'EXPLORE' as const, fromSearch: false };
    patchAppState({
        activeExploreView: view,
        currentExploreQuery: '',
        exploreSort: 'label',
        exploreModuleFilter: 'ALL',
        exploreObjectClassFilter: 'ALL',
        exploreNamespaceFilter: 'ALL',
        exploreDeepSearch: false,
        currentSelection: null,
        exploreLeftSelection: detailSelection,
        exploreRightSelection: detailSelection,
    });
    setActiveWorkspace('explore');
}

function jumpToWorkflows(row: EntityRow) {
    const focusId = focusNodeIdForRow(row);
    activateCompareOverlay(focusId, row.id);
    patchAppState({ currentWorkflowCode: focusId });
    setActiveWorkspace('workflows');
}

function jumpToParentObject(row: EntityRow) {
    if (row.kind !== 'FIELD' || !row.parentId) return;
    const rows = buildEntityIndex(compareState.result || null);
    const parentRow = rows.find(r => r.id === row.parentId && r.kind === 'MDF_OBJECT') || null;
    if (!parentRow) return;
    Promise.all([import('./entity-panel'), import('./search-bar')]).then(([ep, sb]) => {
        ep.setSelectedEntityRow(parentRow);
        ep.renderEntityPanel();
        sb.renderSearchBar();
    });
}

const COMMON_DRILLDOWN: ActionDef = {
    id: 'open-drilldown',
    label: 'Open in Drilldown Graph',
    handler: jumpToDrilldown,
};

function actionsFor(kind: EntityKind): ActionDef[] {
    switch (kind) {
        case 'RBP_ROLE':
            return [
                COMMON_DRILLDOWN,
                { id: 'open-rbp-flow', label: 'Open in RBP Flow', handler: jumpToRbpFlow },
                {
                    id: 'open-rofp-matrix',
                    label: 'Filter ROFP Matrix to this role',
                    handler: jumpToRofpMatrix,
                },
                {
                    id: 'open-object-explorer',
                    label: 'Open in Roles Explorer',
                    handler: r => jumpToExplore(r, 'roles'),
                },
            ];
        case 'MDF_OBJECT':
            return [
                COMMON_DRILLDOWN,
                {
                    id: 'open-object-explorer',
                    label: 'Open in Object Explorer',
                    handler: r => jumpToExplore(r, 'objects'),
                },
                {
                    id: 'open-rofp-matrix',
                    label: 'Filter ROFP Matrix to this object',
                    handler: jumpToRofpMatrix,
                },
            ];
        case 'BUSINESS_RULE':
            return [
                COMMON_DRILLDOWN,
                {
                    id: 'open-rule-explorer',
                    label: 'Open in Rule Explorer',
                    handler: r => jumpToExplore(r, 'rules'),
                },
            ];
        case 'WORKFLOW':
            return [
                COMMON_DRILLDOWN,
                { id: 'open-workflows', label: 'Open in Workflows', handler: jumpToWorkflows },
            ];
        case 'ODATA_ENTITY':
            return [
                COMMON_DRILLDOWN,
                {
                    id: 'open-object-explorer',
                    label: 'Open in OData Explorer',
                    handler: r => jumpToExplore(r, 'odata'),
                },
            ];
        case 'FIELD':
            return [
                {
                    id: 'open-parent-object',
                    label: 'Open parent object',
                    handler: jumpToParentObject,
                },
                {
                    id: 'open-drilldown',
                    label: 'Show parent in Drilldown',
                    handler: jumpToDrilldown,
                },
                {
                    id: 'open-rofp-matrix',
                    label: 'Filter ROFP Matrix to parent object',
                    handler: jumpToRofpMatrix,
                },
            ];
    }
}

export function renderActionToolbar(row: EntityRow) {
    const mount = document.getElementById('compare-action-toolbar-mount');
    if (!mount) return;

    const actions = actionsFor(row.kind);
    if (!actions.length) {
        mount.innerHTML = '';
        return;
    }

    mount.innerHTML = `
        <div class="compare-action-toolbar" role="toolbar" aria-label="Compare entity actions">
            ${actions
                .map(
                    a =>
                        `<ui5-button class="compare-action-btn" data-action-id="${a.id}" design="${a.id === 'open-drilldown' ? 'Emphasized' : 'Transparent'}">${escapeHtml(a.label)}</ui5-button>`
                )
                .join('')}
        </div>
    `;

    mount.querySelectorAll('.compare-action-btn').forEach(el => {
        el.addEventListener('click', () => {
            const id = (el as HTMLElement).getAttribute('data-action-id') as ActionId;
            const action = actions.find(a => a.id === id);
            if (action) action.handler(row);
        });
    });
}
