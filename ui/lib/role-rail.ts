import { appState as S, patchAppState } from './store';
import { escapeHtml, escapeAttribute } from './utils';
import { getRankedRolesForRail, getRankedRolesForRailFromPrepared } from './view-helpers';
import { getFocusedNodeIds, setGraphFocusNode, removeGraphFocusNode, clearGraphFocus } from './node-selection';
import { refreshCompareTargetGraphPane, refreshWorkspace } from './workspace';
import { isSplitCompareLayoutVisible } from './split-compare';

function getRoleRailScopeFilters(pane: 'left' | 'right' = 'left') {
    const viewKind = pane === 'right' && S.currentViewKind === 'rbp-flow'
        ? 'rbp-flow'
        : pane === 'right'
            ? S.compareTargetViewKind
            : S.currentViewKind;
    const moduleFamily = pane === 'right' ? S.compareTargetModule : S.currentModule;
    const subModule = pane === 'right' ? S.compareTargetSubModule : S.currentSubModule;
    if (viewKind === 'rbp-flow') {
        return { moduleFamily: null, subModule: null };
    }
    return {
        moduleFamily: moduleFamily === 'ALL' ? null : moduleFamily,
        subModule: subModule !== 'ALL' ? subModule : null,
    };
}

export function shouldShowRoleRail(): boolean {
    if (S.activeWorkspace !== 'graph' && S.activeWorkspace !== 'rbp-flow') return false;
    if (S.currentViewKind === 'rbp-flow') return true;
    return S.currentViewKind === 'drilldown' && S.currentView === 'RBP_ROLE';
}

function shouldShowTargetRoleRail(): boolean {
    if (S.activeWorkspace !== 'graph' && S.activeWorkspace !== 'rbp-flow') return false;
    if (S.activeWorkspace === 'rbp-flow') return true;
    if (S.currentViewKind === 'rbp-flow') return true;
    if (S.compareTargetViewKind === 'rbp-flow') return true;
    return S.compareTargetViewKind === 'drilldown' && S.compareTargetView === 'RBP_ROLE';
}

export function renderRolesGraphChrome() {
    const rail = document.getElementById('role-rail');
    const showButton = document.getElementById('role-rail-show');
    const railTarget = document.getElementById('role-rail-target');
    if (!rail || !showButton) return;
    const available = shouldShowRoleRail();
    const targetAvailable = shouldShowTargetRoleRail();
    rail.classList.toggle('hidden', !available || S.roleRailCollapsed);
    showButton.classList.toggle('hidden', !(available || targetAvailable) || !S.roleRailCollapsed);
    showButton.setAttribute('aria-expanded', String(!S.roleRailCollapsed));
    if (railTarget) {
        const showTarget = Boolean(targetAvailable && isSplitCompareLayoutVisible());
        railTarget.classList.toggle('hidden', !showTarget || S.roleRailCollapsed);
    }
}

interface RoleRailPaneConfig {
    listId: string;
    metricsId: string;
    searchId: string;
    dataAttr: string;
    permissionRowCount: number;
    queryValue: string;
    isItemActive: (roleId: string) => boolean;
    onSelect: (roleId: string, item: Element) => void;
}

function renderRoleRailImpl(
    config: RoleRailPaneConfig,
    ranked: Array<{ roleId: string; label: string; count: number }>,
    moduleFamily: string | null,
    subModule: string | null
): void {
    const list = document.getElementById(config.listId);
    const metrics = document.getElementById(config.metricsId);
    const search = document.getElementById(config.searchId) as HTMLInputElement | null;
    if (!list || !metrics) return;

    const scopeSuffix = subModule ? ` · ${subModule}` : '';
    metrics.innerText = `${ranked.length} role${ranked.length === 1 ? '' : 's'}${moduleFamily ? ` in ${moduleFamily}${scopeSuffix}` : ''} · ${config.permissionRowCount.toLocaleString()} permission rows`;

    if (search && search.value !== config.queryValue) {
        search.value = config.queryValue;
    }
    const query = config.queryValue.trim().toLowerCase();
    const filtered = query
        ? ranked.filter(row => `${row.label} ${row.roleId}`.toLowerCase().includes(query))
        : ranked;

    if (filtered.length === 0) {
        list.innerHTML = '<div class="empty-mini">No roles match the filter.</div>';
        return;
    }

    list.innerHTML = filtered.slice(0, 150).map(row => `
        <button type="button" class="role-rail-item${config.isItemActive(row.roleId) ? ' active' : ''}" ${config.dataAttr}="${escapeAttribute(row.roleId)}">
            <span class="role-rail-item-title">${escapeHtml(row.label)}</span>
            <span class="role-rail-item-meta">${row.count.toLocaleString()} object permissions</span>
        </button>
    `).join('');

    const attrSelector = `[${config.dataAttr}]`;
    const attrName = config.dataAttr;
    list.querySelectorAll(attrSelector).forEach(item => {
        item.addEventListener('click', () => {
            const roleId = item.getAttribute(attrName);
            if (!roleId) return;
            config.onSelect(roleId, item);
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
    });
}

export function renderRoleRail() {
    if (!shouldShowRoleRail() || S.roleRailCollapsed) return;
    const { moduleFamily, subModule } = getRoleRailScopeFilters();
    const ranked = getRankedRolesForRail(moduleFamily, subModule);
    renderRoleRailImpl(
        {
            listId: 'role-rail-list',
            metricsId: 'role-rail-metrics',
            searchId: 'role-rail-search',
            dataAttr: 'data-role-id',
            permissionRowCount: S.roleObjectPermissions.length,
            queryValue: S.currentRoleRailQueryBase,
            isItemActive: roleId => getFocusedNodeIds().includes(roleId),
            onSelect: roleId => {
                setGraphFocusNode(roleId);
                S.currentSelection = null;
                S.currentWorkflowCode = null;
                S.focusRequestId = roleId;
                S.graphFocusAfterRenderHost = null;
                refreshWorkspace();
            }
        },
        ranked,
        moduleFamily,
        subModule
    );
}

export function renderTargetRoleRail() {
    if (!shouldShowTargetRoleRail() || S.roleRailCollapsed || !isSplitCompareLayoutVisible()) return;
    const prep = S.compareTargetPrepared;
    if (!prep) return;
    const { moduleFamily, subModule } = getRoleRailScopeFilters('right');
    const ranked = getRankedRolesForRailFromPrepared(prep, moduleFamily, subModule);
    const activeId = S.compareTargetGraphFocusNodeId;
    renderRoleRailImpl(
        {
            listId: 'role-rail-list-target',
            metricsId: 'role-rail-metrics-target',
            searchId: 'role-rail-search-target',
            dataAttr: 'data-role-id-target',
            permissionRowCount: prep.roleObjectPermissions.length,
            queryValue: S.currentRoleRailQueryTarget,
            isItemActive: roleId => activeId === roleId,
            onSelect: roleId => {
                patchAppState({ compareTargetGraphFocusNodeId: roleId });
                S.currentSelection = null;
                S.currentWorkflowCode = null;
                refreshCompareTargetGraphPane();
            }
        },
        ranked,
        moduleFamily,
        subModule
    );
}

export function renderGraphFocusList() {
    const container = document.getElementById('graph-focus-list');
    if (!container) return;
    const focusedIds = getFocusedNodeIds();
    if (focusedIds.length === 0 || (S.activeWorkspace !== 'graph' && S.activeWorkspace !== 'rbp-flow')) { container.classList.add('hidden'); container.innerHTML = ''; return; }

    const chipsHtml = focusedIds.map(nodeId => {
        const node = S.nodeById.get(nodeId);
        if (!node) return '';
        return `<button type="button" class="graph-focus-chip" data-focus-chip="${escapeAttribute(nodeId)}"><span class="graph-focus-chip-label">${escapeHtml(node.label || node.id)}</span><span class="graph-focus-chip-remove" data-focus-remove="${escapeAttribute(nodeId)}">×</span></button>`;
    }).join('');

    container.innerHTML = `<div class="graph-focus-list-head"><span class="graph-focus-list-title">Added nodes (${focusedIds.length})</span><button type="button" class="perm-filter-action" data-focus-clear-all="1">Clear all</button></div><div class="graph-focus-chip-list">${chipsHtml}</div>`;
    container.classList.remove('hidden');

    container.querySelectorAll('[data-focus-chip]').forEach(item => {
        item.addEventListener('click', event => {
            if ((event.target as HTMLElement)?.closest('[data-focus-remove]')) return;
            const nodeId = item.getAttribute('data-focus-chip');
            if (!nodeId || !S.nodeById.has(nodeId)) return;
            setGraphFocusNode(nodeId);
            S.focusRequestId = nodeId;
            refreshWorkspace();
        });
    });
    container.querySelectorAll('[data-focus-remove]').forEach(item => {
        item.addEventListener('click', event => {
            event.stopPropagation();
            removeGraphFocusNode(item.getAttribute('data-focus-remove'));
            refreshWorkspace();
        });
    });
    container.querySelector('[data-focus-clear-all]')?.addEventListener('click', () => { clearGraphFocus(); refreshWorkspace(); });
}
