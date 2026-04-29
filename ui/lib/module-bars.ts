import { appState as S } from './store';
import type { ViewKind } from './types';
import { clearGraphFocus } from './node-selection';
import { refreshWorkspace } from './workspace';
import { escapeHtml, escapeAttribute } from './utils';

const MODULE_BAR_VIEW_KINDS: ViewKind[] = ['suite', 'blueprint', 'drilldown'];

/** Selecting a concrete module from Suite has no effect on the suite board; switch to Blueprint so module scope applies. */
export function applyGraphModuleSelection(moduleFamily: string) {
    S.currentModule = moduleFamily;
    S.currentSubModule = 'ALL';
    S.currentSelection = null;
    clearGraphFocus();
    S.currentWorkflowCode = null;
    S.focusRequestId = null;
    if (S.currentViewKind === 'suite' && moduleFamily !== 'ALL') {
        S.currentViewKind = 'blueprint';
    }
    refreshWorkspace();
}

export function renderModuleBar() {
    const moduleBar = document.getElementById('module-bar');
    if (!moduleBar) return;
    const submoduleBar = document.getElementById('submodule-bar');
    const shouldShow = S.activeWorkspace === 'graph' && MODULE_BAR_VIEW_KINDS.includes(S.currentViewKind);
    moduleBar.classList.toggle('hidden', !shouldShow);
    if (!shouldShow) {
        submoduleBar?.classList.add('hidden');
        return;
    }
    if (!S.dashboard) {
        moduleBar.innerHTML = '';
        submoduleBar?.classList.add('hidden');
        return;
    }
    const families = S.dashboard?.stats?.moduleBreakdown?.families ?? [];
    const items = [{ family: 'ALL', label: 'All Modules', nodeCount: S.allNodes.length }, ...families];
    moduleBar.innerHTML = items.map(item => `<button class="module-button${S.currentModule === item.family ? ' active' : ''}" data-module-family="${escapeAttribute(item.family)}" type="button">${escapeHtml(item.label || item.family)}<small>${(item.nodeCount || 0).toLocaleString()} nodes</small></button>`).join('');
    moduleBar.querySelectorAll('[data-module-family]').forEach(button => {
        button.addEventListener('click', () => {
            applyGraphModuleSelection(button.getAttribute('data-module-family') ?? '');
        });
    });
    renderSubModuleBar();
}

export function renderSubModuleBar() {
    const bar = document.getElementById('submodule-bar');
    if (!bar) return;
    if (S.currentModule === 'ALL') { bar.classList.add('hidden'); return; }
    const subMods = S.dashboard?.stats?.moduleBreakdown?.subModulesByFamily?.[S.currentModule] || [];
    if (subMods.length <= 1) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const allItem = { subModule: 'ALL', nodeCount: S.allNodes.filter(n => n.moduleFamily === S.currentModule).length };
    const items = [allItem, ...subMods];
    bar.innerHTML = items.map(item => `<button class="submodule-button${S.currentSubModule === item.subModule ? ' active' : ''}" data-submodule="${escapeAttribute(item.subModule)}" type="button">${escapeHtml(item.subModule === 'ALL' ? 'All Sub-Modules' : item.subModule)}<small>${(item.nodeCount || 0).toLocaleString()}</small></button>`).join('');
    bar.querySelectorAll('[data-submodule]').forEach(button => {
        button.addEventListener('click', () => { S.currentSubModule = button.getAttribute('data-submodule') ?? ''; S.currentSelection = null; clearGraphFocus(); S.focusRequestId = null; refreshWorkspace(); });
    });
}

export function renderObjectClassBar() {
    const container = document.getElementById('object-class-bar');
    if (!container) return;
    const items = [{ value: 'ALL_OBJECTS', label: 'All Objects' }, { value: 'FOUNDATION', label: 'Foundation' }, { value: 'MDF', label: 'MDF' }, { value: 'GENERIC', label: 'Generic' }];
    container.innerHTML = items.map(item => `<button type="button" class="object-class-button${S.currentObjectClass === item.value ? ' active' : ''}" data-object-class="${escapeAttribute(item.value)}">${escapeHtml(item.label)}</button>`).join('');
    container.querySelectorAll('[data-object-class]').forEach(button => {
        button.addEventListener('click', () => { S.currentObjectClass = button.getAttribute('data-object-class') ?? ''; S.currentSelection = null; clearGraphFocus(); S.focusRequestId = null; refreshWorkspace(); });
    });
}

export function renderOverviewModules() {
    const container = document.getElementById('overview-modules');
    if (!container) return;
    if (!S.dashboard) { container.innerHTML = '<div class="empty-mini">No project loaded. Go to <strong>Import</strong> to load a SuccessFactors instance.</div>'; return; }
    const overviewFamilies = S.dashboard.stats?.moduleBreakdown?.families ?? [];
    container.innerHTML = overviewFamilies.map((module: any) => `<div class="module-card" data-module-family="${escapeAttribute(module.family)}"><h3>${escapeHtml(module.family)}</h3><p>${module.nodeCount.toLocaleString()} nodes · ${module.objectCount.toLocaleString()} objects · ${module.ruleCount.toLocaleString()} rules</p></div>`).join('');
    container.querySelectorAll('[data-module-family]').forEach(card => {
        card.addEventListener('click', () => {
            const fam = card.getAttribute('data-module-family') ?? '';
            document.getElementById('module-bar')?.classList.remove('hidden');
            const t = document.getElementById('modules-toggle');
            if (t) (t as any).design = 'Emphasized';
            applyGraphModuleSelection(fam);
        });
    });
}

export function renderModuleBreakdown(families: any) {
    const container = document.getElementById('module-breakdown');
    if (!container) return;
    if (!S.dashboard) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = families.map((module: any) => {
        const subMods = (S.dashboard?.stats?.moduleBreakdown?.subModulesByFamily?.[module.family] || []).slice(0, 5);
        const subPills = subMods.map((sm: any) => `<span class="module-sub-pill" data-module-family="${escapeAttribute(module.family)}" data-submodule="${escapeAttribute(sm.subModule)}" title="${sm.nodeCount} nodes">${escapeHtml(sm.subModule)}</span>`).join('');
        return `<div class="module-summary-item" data-module-family="${escapeAttribute(module.family)}"><div class="module-summary-main"><div class="module-summary-title">${escapeHtml(module.family)}</div><div class="module-summary-stats">${module.objectCount.toLocaleString()} objects · ${module.ruleCount.toLocaleString()} rules · ${module.roleCount.toLocaleString()} roles</div>${subPills ? `<div class="module-sub-pills">${subPills}</div>` : ''}</div><span class="module-summary-badge">${module.nodeCount.toLocaleString()}</span></div>`;
    }).join('');
    container.querySelectorAll('[data-module-family]').forEach(item => {
        item.addEventListener('click', event => {
            const pillTarget = (event.target as HTMLElement)?.closest('[data-submodule]');
            const fam = item.getAttribute('data-module-family') ?? '';
            document.getElementById('module-bar')?.classList.remove('hidden');
            const t = document.getElementById('modules-toggle');
            if (t) (t as any).design = 'Emphasized';
            S.currentModule = fam;
            S.currentSubModule = pillTarget ? pillTarget.getAttribute('data-submodule') ?? 'ALL' : 'ALL';
            S.currentSelection = null;
            clearGraphFocus();
            S.currentWorkflowCode = null;
            S.focusRequestId = null;
            if (S.currentViewKind === 'suite' && fam !== 'ALL') {
                S.currentViewKind = 'blueprint';
            }
            refreshWorkspace();
        });
    });
}
