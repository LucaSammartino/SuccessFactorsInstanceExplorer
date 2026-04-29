import { appState as S } from '../store';
import type { PreparedInstanceModel } from '../prepared-instance';
import { escapeHtml } from '../utils';
import { selectNode } from '../node-selection';
import { renderToolbarState, renderWorkspaceTabs } from '../workspace';
import { deactivateRbpFlowMode } from '../view-kind';
import { parseFieldOverrideEntries } from './filters';
import { runPermMatrixExport } from './csv';
import type { PermMatrixEventListenerStats } from './diagnostics';

export type MatrixEventCallbacks = {
    rebuild: (container: any) => void;
    debouncedRebuild: (container: any) => void;
    virtualPaint: (container: any) => void;
    getInputs: () => { moduleFamily: any; sub: any; ranked: any[]; objects: any[] } | null;
};

export type PermissionDrawerTarget = 'single' | 'left-compare' | 'right-compare';

type ListenerBucket =
    | 'activeDocumentKeydown'
    | 'activeDrawerClose'
    | 'activeHostDelegated'
    | 'activeTableListeners'
    | 'activeFilterListeners';

type DrawerShellRefs = {
    drawer: HTMLElement;
    projectEl: HTMLElement | null;
    titleEl: HTMLElement;
    subtitleEl: HTMLElement;
    contentEl: HTMLElement;
};

const DRAWER_TARGETS: PermissionDrawerTarget[] = ['single', 'left-compare', 'right-compare'];

const drawerShellIds: Record<PermissionDrawerTarget, {
    drawerId: string;
    closeId: string;
    projectId: string;
    titleId: string;
    subtitleId: string;
    contentId: string;
}> = {
    single: {
        drawerId: 'perm-detail-drawer',
        closeId: 'perm-drawer-close',
        projectId: 'perm-drawer-project',
        titleId: 'perm-drawer-title',
        subtitleId: 'perm-drawer-subtitle',
        contentId: 'perm-drawer-content',
    },
    'left-compare': {
        drawerId: 'perm-detail-drawer-left',
        closeId: 'perm-drawer-close-left',
        projectId: 'perm-drawer-project-left',
        titleId: 'perm-drawer-title-left',
        subtitleId: 'perm-drawer-subtitle-left',
        contentId: 'perm-drawer-content-left',
    },
    'right-compare': {
        drawerId: 'perm-detail-drawer-right',
        closeId: 'perm-drawer-close-right',
        projectId: 'perm-drawer-project-right',
        titleId: 'perm-drawer-title-right',
        subtitleId: 'perm-drawer-subtitle-right',
        contentId: 'perm-drawer-content-right',
    },
};

const matrixEventListenerStats: PermMatrixEventListenerStats = {
    activeTotal: 0,
    totalAttached: 0,
    totalRemoved: 0,
    cleanupRuns: 0,
    activeDocumentKeydown: 0,
    activeDrawerClose: 0,
    activeHostDelegated: 0,
    activeTableListeners: 0,
    activeFilterListeners: 0,
};

function trackMatrixListener(
    target: any,
    type: string,
    listener: EventListener,
    bucket: ListenerBucket,
    options?: AddEventListenerOptions | boolean
) {
    target.addEventListener(type, listener, options);
    matrixEventListenerStats.activeTotal += 1;
    matrixEventListenerStats.totalAttached += 1;
    matrixEventListenerStats[bucket] += 1;
    let removed = false;
    return () => {
        if (removed) return;
        removed = true;
        target.removeEventListener(type, listener, options);
        matrixEventListenerStats.activeTotal = Math.max(0, matrixEventListenerStats.activeTotal - 1);
        matrixEventListenerStats.totalRemoved += 1;
        matrixEventListenerStats[bucket] = Math.max(0, matrixEventListenerStats[bucket] - 1);
    };
}

export function getPermissionMatrixEventListenerStats(): PermMatrixEventListenerStats {
    return { ...matrixEventListenerStats };
}

export function clearMatrixColHighlight(table: any) {
    table.querySelectorAll('.perm-col-highlight').forEach((el: any) => el.classList.remove('perm-col-highlight'));
}

function getDrawerShell(target: PermissionDrawerTarget): DrawerShellRefs | null {
    const ids = drawerShellIds[target];
    const drawer = document.getElementById(ids.drawerId) as HTMLElement | null;
    const titleEl = document.getElementById(ids.titleId) as HTMLElement | null;
    const subtitleEl = document.getElementById(ids.subtitleId) as HTMLElement | null;
    const contentEl = document.getElementById(ids.contentId) as HTMLElement | null;
    if (!drawer || !titleEl || !subtitleEl || !contentEl) return null;
    return {
        drawer,
        projectEl: document.getElementById(ids.projectId) as HTMLElement | null,
        titleEl,
        subtitleEl,
        contentEl,
    };
}

function getProjectNameForDrawerTarget(target: PermissionDrawerTarget): string | null {
    if (target === 'left-compare') {
        return S.activeProjectName || S.activeProjectId || 'Base';
    }
    if (target === 'right-compare') {
        return S.compareTargetProjectName || S.compareTargetProjectId || 'Target';
    }
    return null;
}

function buildPermissionDetailContent(
    roleId: any,
    objectId: any,
    prep?: PreparedInstanceModel | null
) {
    const perms = prep?.roleObjectPermissions ?? S.roleObjectPermissions;
    const nodeById = prep?.nodeById ?? S.nodeById;

    const permEntry = perms.find((e: any) => e.roleId === roleId && e.objectId === objectId);
    if (!permEntry) return null;

    const roleNode = nodeById.get(roleId);
    const objectNode = nodeById.get(objectId);
    if (!roleNode || !objectNode) return null;

    const roleLabel = roleNode.label || roleId;
    const objectLabel = objectNode.label || objectId;
    const permissions = permEntry.permissions || [];
    const categories = permEntry.categories || [];
    const structures = permEntry.structures || [];
    const fieldOverrides = permEntry.fieldOverrides || [];
    const fieldItems = permEntry.fieldItems || [];
    const populationAssignments = permEntry.populationAssignments || [];
    const normalizedFieldOverrides = parseFieldOverrideEntries(permEntry);

    let html = '';

    if (permissions.length > 0) {
        html += `<div class="perm-drawer-section"><h4 class="perm-drawer-section-title">Permission actions (${permissions.length})</h4><p class="perm-drawer-section-subtitle">Actions granted on this object in the role (from the RBP / role export).</p><div class="perm-drawer-pills">${permissions.map((p: any) => `<span class="perm-drawer-pill">${escapeHtml(p)}</span>`).join('')}</div></div>`;
    }

    if (categories.length > 0) {
        html += `<div class="perm-drawer-section"><h4 class="perm-drawer-section-title">Categories (${categories.length})</h4><div class="perm-drawer-pills">${categories.map((c: any) => `<span class="perm-drawer-pill">${escapeHtml(c)}</span>`).join('')}</div></div>`;
    }

    if (structures.length > 0) {
        html += `<div class="perm-drawer-section"><h4 class="perm-drawer-section-title">Structures (${structures.length})</h4><div class="perm-drawer-pills">${structures.map((s: any) => `<span class="perm-drawer-pill">${escapeHtml(s)}</span>`).join('')}</div></div>`;
    }

    if (fieldItems.length > 0) {
        html += `<div class="perm-drawer-section"><h4 class="perm-drawer-section-title">Field Actions (${fieldItems.length})</h4><table class="perm-drawer-table"><thead><tr><th>Field</th><th>Actions</th><th>Context</th></tr></thead><tbody>${fieldItems.slice(0, 60).map((item: any) => `<tr><td>${escapeHtml(item.fieldName || 'N/A')}</td><td>${escapeHtml((item.actions || []).join(' | ') || 'N/A')}</td><td>${escapeHtml(item.objectHint || 'N/A')}</td></tr>`).join('')}${fieldItems.length > 60 ? `<tr><td colspan="3" class="perm-drawer-empty">+${fieldItems.length - 60} more</td></tr>` : ''}</tbody></table></div>`;
    }

    if (populationAssignments.length > 0) {
        html += `<div class="perm-drawer-section"><h4 class="perm-drawer-section-title">Population Assignments (${populationAssignments.length})</h4><table class="perm-drawer-table"><thead><tr><th>ID</th><th>Name</th><th>Population</th></tr></thead><tbody>${populationAssignments.slice(0, 30).map((item: any) => `<tr><td>${escapeHtml(item.id || 'N/A')}</td><td>${escapeHtml(item.name || 'N/A')}</td><td>${escapeHtml(item.population || 'N/A')}</td></tr>`).join('')}${populationAssignments.length > 30 ? `<tr><td colspan="3" class="perm-drawer-empty">+${populationAssignments.length - 30} more</td></tr>` : ''}</tbody></table></div>`;
    }

    if (normalizedFieldOverrides.length > 0) {
        html += `<div class="perm-drawer-section"><h4 class="perm-drawer-section-title">Field Overrides (${normalizedFieldOverrides.length})</h4><table class="perm-drawer-table"><thead><tr><th>Field</th><th>Override</th></tr></thead><tbody>${normalizedFieldOverrides.slice(0, 50).map(fo => `<tr><td>${escapeHtml(fo.field || 'N/A')}</td><td>${escapeHtml(fo.value || 'N/A')}</td></tr>`).join('')}${normalizedFieldOverrides.length > 50 ? `<tr><td colspan="2" class="perm-drawer-empty">+${normalizedFieldOverrides.length - 50} more</td></tr>` : ''}</tbody></table></div>`;
    }

    if (!permissions.length && !categories.length && !structures.length && !normalizedFieldOverrides.length && !fieldItems.length && !populationAssignments.length) {
        html += `<div class="perm-drawer-section"><p class="perm-drawer-empty">No permission details available.</p></div>`;
    }

    void fieldOverrides;
    return { objectLabel, roleLabel, html };
}

export function openPermissionDetailDrawer(
    roleId: any,
    objectId: any,
    prep?: PreparedInstanceModel | null,
    target: PermissionDrawerTarget = 'single'
) {
    const shell = getDrawerShell(target);
    if (!shell) return;

    const content = buildPermissionDetailContent(roleId, objectId, prep);
    if (!content) return;

    const projectName = getProjectNameForDrawerTarget(target);
    if (shell.projectEl) {
        if (projectName) {
            shell.projectEl.textContent = projectName;
            shell.projectEl.removeAttribute('hidden');
        } else {
            shell.projectEl.textContent = '';
            shell.projectEl.setAttribute('hidden', '');
        }
    }

    shell.titleEl.textContent = `${content.objectLabel}`;
    shell.subtitleEl.textContent = `Role: ${content.roleLabel}`;
    shell.contentEl.innerHTML = content.html;
    shell.drawer.classList.add('is-open');
}

export function closePermissionDetailDrawer(target: PermissionDrawerTarget = 'single') {
    getDrawerShell(target)?.drawer.classList.remove('is-open');
}

export function closeAllPermissionDetailDrawers() {
    for (const target of DRAWER_TARGETS) {
        closePermissionDetailDrawer(target);
    }
}

export function attachPermissionMatrixEvents(container: any, cbs: MatrixEventCallbacks): () => void {
    const cleanups: Array<() => void> = [];
    const matrixHostEl = container as HTMLElement;
    const matrixDataset = matrixHostEl.dataset;
    const cleanupAll = () => {
        matrixEventListenerStats.cleanupRuns += 1;
        for (const cleanup of cleanups.splice(0).reverse()) cleanup();
        if (matrixDataset) {
            delete matrixDataset.permMatrixClickDelegated;
        }
    };

    const openNodeFromMatrix = (nodeId: any) => {
        if (!S.nodeById.has(nodeId)) return;
        S.activeWorkspace = 'graph';
        if (S.currentViewKind === 'rbp-flow') {
            deactivateRbpFlowMode();
        }
        renderWorkspaceTabs();
        if (location.hash !== '#graph') {
            history.replaceState(null, '', `${location.pathname}${location.search}#graph`);
        }
        selectNode(nodeId, { type: 'MATRIX', fromSearch: false, promoteModule: false, focusGraph: true });
    };

    const matrixPrep =
        matrixDataset?.matrixPane === 'target' ? S.compareTargetPrepared : null;
    const splitCompareVisible = Boolean(S.splitCompareMode && S.compareTargetPrepared && !S.splitCompareLayoutHidden);
    const drawerTarget: PermissionDrawerTarget =
        splitCompareVisible
            ? (matrixDataset?.matrixPane === 'target' ? 'right-compare' : 'left-compare')
            : 'single';

    if (matrixDataset && !matrixDataset.permMatrixClickDelegated) {
        matrixDataset.permMatrixClickDelegated = '1';
        cleanups.push(trackMatrixListener(matrixHostEl, 'click', (event: Event) => {
            const t = event.target as HTMLElement;
            const exportBtn = t.closest('[data-perm-export]');
            if (exportBtn) {
                event.preventDefault();
                const exKind = exportBtn.getAttribute('data-perm-export');
                if (exKind === 'long' || exKind === 'wide' || exKind === 'scope-long') {
                    runPermMatrixExport(matrixHostEl, exKind, cbs.getInputs, cbs.rebuild);
                }
                return;
            }
            if (matrixDataset.matrixPane === 'target') {
                return;
            }
            const rowH = t.closest('.perm-row-header[data-node-id]');
            if (rowH) {
                openNodeFromMatrix(rowH.getAttribute('data-node-id'));
                return;
            }
            const colH = t.closest('.perm-col-header[data-role-id]');
            if (colH) {
                openNodeFromMatrix(colH.getAttribute('data-role-id'));
            }
        }, 'activeHostDelegated'));
    }

    const table = container.querySelector('.perm-matrix-table');
    if (table) {
        let lastHighlightCol: string | null = null;
        cleanups.push(trackMatrixListener(table, 'mouseover', ((event: any) => {
            const columnTarget = (event.target as HTMLElement).closest('[data-col]');
            if (!columnTarget) {
                if (lastHighlightCol !== null) {
                    lastHighlightCol = null;
                    clearMatrixColHighlight(table);
                }
                return;
            }
            const colIdx = columnTarget.getAttribute('data-col');
            if (colIdx === lastHighlightCol) return;
            lastHighlightCol = colIdx;
            table.querySelectorAll('[data-col]').forEach((cell: any) => {
                cell.classList.toggle('perm-col-highlight', cell.getAttribute('data-col') === colIdx);
            });
        }) as EventListener, 'activeTableListeners'));

        cleanups.push(trackMatrixListener(table, 'mouseleave', (() => {
            lastHighlightCol = null;
            clearMatrixColHighlight(table);
        }) as EventListener, 'activeTableListeners'));
        cleanups.push(trackMatrixListener(table, 'click', ((event: any) => {
            const cell = (event.target as HTMLElement).closest('.perm-cell.has-perm');
            if (!cell) return;
            const roleId = cell.getAttribute('data-role-id');
            const objectId = cell.getAttribute('data-object-id');
            if (roleId && objectId) {
                openPermissionDetailDrawer(roleId, objectId, matrixPrep, drawerTarget);
            }
        }) as EventListener, 'activeTableListeners'));
    }

    const facetKinds = new Set(['roles', 'objects', 'permissions', 'fields']);

    const updateSelectedFilter = (kind: any) => {
        const checked = Array.from(
            container.querySelectorAll(`input[data-filter-option="${kind}"]:checked`)
        ).map(el => (el as HTMLInputElement).value);
        if (kind === 'roles') S.matrixSelectedRoleIds = checked;
        if (kind === 'objects') S.matrixSelectedObjectIds = checked;
        if (kind === 'permissions') S.matrixSelectedPermissionKeys = checked;
        if (kind === 'fields') S.matrixSelectedFieldKeys = checked;
        cbs.debouncedRebuild(container);
    };

    cleanups.push(trackMatrixListener(container, 'input', ((event: any) => {
        const input = (event.target as HTMLElement).closest('[data-filter-search]') as HTMLInputElement | null;
        if (!input) return;
        const filterRoot = input.closest('.perm-filter');
        const query = input.value.trim().toLowerCase();
        if (!filterRoot) return;
        filterRoot.querySelectorAll('.perm-filter-option').forEach((option: any) => {
            const label = option.getAttribute('data-option-label') || '';
            option.classList.toggle('hidden', Boolean(query) && !label.includes(query));
        });
    }) as EventListener, 'activeFilterListeners'));

    cleanups.push(trackMatrixListener(container, 'change', ((event: any) => {
        const target = event.target as HTMLInputElement;
        const filterKind = target.getAttribute?.('data-filter-option');
        if (filterKind) {
            updateSelectedFilter(filterKind);
            return;
        }

        const scopeKind = target.getAttribute?.('data-scope-option');
        if (!scopeKind) return;
        if (scopeKind === 'module') {
            S.matrixModule = target.value || 'ALL';
            S.matrixSubModule = 'ALL';
        } else if (scopeKind === 'submodule') {
            S.matrixSubModule = target.value || 'ALL';
        }
        cbs.rebuild(container);
    }) as EventListener, 'activeFilterListeners'));

    cleanups.push(trackMatrixListener(container, 'click', ((event: any) => {
        const t = event.target as HTMLElement;

        const selectAll = t.closest('[data-filter-select-all]') as HTMLElement | null;
        if (selectAll) {
            event.preventDefault();
            const kind = selectAll.getAttribute('data-filter-select-all');
            const values = Array.from(
                container.querySelectorAll(
                    `.perm-filter[data-filter-kind="${kind}"] .perm-filter-option:not(.hidden) input[data-filter-option="${kind}"]:not(:disabled)`
                )
            ).map((el: any) => (el as HTMLInputElement).value);
            if (kind === 'roles') S.matrixSelectedRoleIds = values;
            if (kind === 'objects') S.matrixSelectedObjectIds = values;
            if (kind === 'permissions') S.matrixSelectedPermissionKeys = values;
            if (kind === 'fields') S.matrixSelectedFieldKeys = values;
            if (kind && facetKinds.has(kind)) cbs.debouncedRebuild(container);
            return;
        }

        const clear = t.closest('[data-filter-clear]') as HTMLElement | null;
        if (clear) {
            event.preventDefault();
            const kind = clear.getAttribute('data-filter-clear');
            if (kind === 'roles') S.matrixSelectedRoleIds = [];
            if (kind === 'objects') S.matrixSelectedObjectIds = [];
            if (kind === 'permissions') S.matrixSelectedPermissionKeys = [];
            if (kind === 'fields') S.matrixSelectedFieldKeys = [];
            if (kind && facetKinds.has(kind)) cbs.debouncedRebuild(container);
            return;
        }

        const chipRemove = t.closest('[data-filter-chip-remove]') as HTMLElement | null;
        if (chipRemove) {
            event.preventDefault();
            event.stopPropagation();
            const kind = chipRemove.getAttribute('data-filter-chip-remove');
            const value = chipRemove.getAttribute('data-chip-value');
            if (!kind || !value) return;
            if (kind === 'roles') S.matrixSelectedRoleIds = S.matrixSelectedRoleIds.filter((item: any) => item !== value);
            if (kind === 'objects') S.matrixSelectedObjectIds = S.matrixSelectedObjectIds.filter((item: any) => item !== value);
            if (kind === 'permissions') S.matrixSelectedPermissionKeys = S.matrixSelectedPermissionKeys.filter((item: any) => item !== value);
            if (kind === 'fields') S.matrixSelectedFieldKeys = S.matrixSelectedFieldKeys.filter((item: any) => item !== value);
            if (facetKinds.has(kind)) cbs.debouncedRebuild(container);
            return;
        }

        const scopeClear = t.closest('[data-scope-clear]') as HTMLElement | null;
        if (scopeClear) {
            event.preventDefault();
            event.stopPropagation();
            const kind = scopeClear.getAttribute('data-scope-clear');
            if (kind === 'module') { S.matrixModule = 'ALL'; S.matrixSubModule = 'ALL'; }
            if (kind === 'submodule') S.matrixSubModule = 'ALL';
            cbs.rebuild(container);
            return;
        }

        if (t.closest('.perm-open-controls')) {
            S.controlsCollapsed = !S.controlsCollapsed;
            renderToolbarState();
            const controls = container.querySelector('.perm-matrix-controls');
            const btn = container.querySelector('.perm-open-controls');
            if (controls) controls.classList.toggle('is-collapsed', S.controlsCollapsed);
            if (btn) btn.textContent = S.controlsCollapsed ? 'Show Controls' : 'Hide Controls';
            return;
        }

        if (t.closest('.perm-hide-unallocated')) {
            S.matrixHideUnallocatedRows = !S.matrixHideUnallocatedRows;
            const wrap = container.querySelector('.perm-matrix-wrap');
            const btn = container.querySelector('.perm-hide-unallocated');
            if (wrap) wrap.classList.toggle('perm-hide-empty-rows', S.matrixHideUnallocatedRows);
            if (btn) {
                btn.classList.toggle('is-active', S.matrixHideUnallocatedRows);
                btn.textContent = S.matrixHideUnallocatedRows ? 'Show unallocated objects' : 'Hide unallocated objects';
            }
            cbs.virtualPaint(container);
            return;
        }

        if (t.closest('.perm-hide-unallocated-roles')) {
            S.matrixHideUnallocatedRoles = !S.matrixHideUnallocatedRoles;
            const wrap = container.querySelector('.perm-matrix-wrap');
            const btn = container.querySelector('.perm-hide-unallocated-roles');
            if (wrap) wrap.classList.toggle('perm-hide-empty-role-cols', S.matrixHideUnallocatedRoles);
            if (btn) {
                btn.classList.toggle('is-active', S.matrixHideUnallocatedRoles);
                btn.textContent = S.matrixHideUnallocatedRoles ? 'Show unallocated roles' : 'Hide unallocated roles';
            }
            cbs.virtualPaint(container);
        }
    }) as EventListener, 'activeFilterListeners'));

    for (const target of DRAWER_TARGETS) {
        const closeBtn = document.getElementById(drawerShellIds[target].closeId);
        if (closeBtn) {
            cleanups.push(trackMatrixListener(closeBtn, 'click', (() => closePermissionDetailDrawer(target)) as EventListener, 'activeDrawerClose'));
        }
    }

    const handleDrawerEscape = (event: any) => {
        if (event.key === 'Escape') {
            closeAllPermissionDetailDrawers();
        }
    };
    cleanups.push(trackMatrixListener(document, 'keydown', handleDrawerEscape as EventListener, 'activeDocumentKeydown'));

    return cleanupAll;
}
