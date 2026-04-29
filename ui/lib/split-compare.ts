import { applyPreparedModelToAppState, populateAnalytics } from './data-prepare';
import { buildPreparedInstanceModel } from './prepared-instance';
import {
    clampModuleFiltersToLoadedGraph,
    fetchProjects,
    resetExplorationStateForProjectSwitch,
    updateProjectBadge,
} from './project-api';
import { markRightGraphDirty } from './graph-render';
import { appState as S, patchAppState } from './store';
import type { AnyDashboard } from './types';
import { escapeHtml } from './utils';

function validateBundleProjectId(dashboard: AnyDashboard, expectedId: string): string | null {
    const bundle = dashboard.projectBundle as { projectId?: string } | undefined;
    if (bundle?.projectId && bundle.projectId !== expectedId) {
        return `Bundle is for a different project id (${bundle.projectId}). Re-ingest ${expectedId}.`;
    }
    return null;
}

/** True when both panes should be shown (armed + target loaded + layout not suspended). */
export function isSplitCompareLayoutVisible(): boolean {
    return Boolean(S.splitCompareMode && S.compareTargetPrepared && !S.splitCompareLayoutHidden);
}

/**
 * Load base + target dashboards and arm split compare (no GET /compare).
 * Used after a successful diff response and for "Restore split view" when only dashboard loads failed.
 */
export async function restoreSplitCompareFromPair(
    baseId: string,
    targetId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
    const [baseRes, targetRes] = await Promise.all([
        fetch(`/api/projects/${encodeURIComponent(baseId)}/data`),
        fetch(`/api/projects/${encodeURIComponent(targetId)}/data`),
    ]);
    if (!baseRes.ok) {
        return { ok: false, error: (await baseRes.text().catch(() => '')).slice(0, 500) || `Base load failed (${baseRes.status})` };
    }
    if (!targetRes.ok) {
        return { ok: false, error: (await targetRes.text().catch(() => '')).slice(0, 500) || `Target load failed (${targetRes.status})` };
    }
    const baseDash = (await baseRes.json()) as AnyDashboard;
    const targetDash = (await targetRes.json()) as AnyDashboard;

    const baseErr = validateBundleProjectId(baseDash, baseId);
    if (baseErr) return { ok: false, error: baseErr };
    const targetErr = validateBundleProjectId(targetDash, targetId);
    if (targetErr) return { ok: false, error: targetErr };

    const refreshedProjects = await fetchProjects();
    const baseMeta = refreshedProjects.find(p => p.id === baseId) ?? S.allProjects.find(p => p.id === baseId);
    const targetMeta = refreshedProjects.find(p => p.id === targetId) ?? S.allProjects.find(p => p.id === targetId);

    resetExplorationStateForProjectSwitch();
    const baseModel = buildPreparedInstanceModel(baseDash);
    const targetModel = buildPreparedInstanceModel(targetDash);
    applyPreparedModelToAppState(baseModel);
    clampModuleFiltersToLoadedGraph();

    patchAppState({
        activeProjectId: baseId,
        activeProjectName: baseMeta?.name ?? baseId,
        allProjects: refreshedProjects.length ? refreshedProjects : S.allProjects,
        compareTargetPrepared: targetModel,
        compareTargetProjectId: targetId,
        compareTargetProjectName: targetMeta?.name ?? targetId,
        compareTargetViewKind: S.currentViewKind,
        compareTargetModule: S.currentModule,
        compareTargetSubModule: S.currentSubModule,
        compareTargetView: S.currentView,
        compareTargetObjectClass: S.currentObjectClass,
        compareTargetIncludeRolePermissionLinks: S.includeRolePermissionLinks,
        compareTargetShowIsolated: S.showIsolated,
        splitCompareMode: true,
        splitCompareLayoutHidden: false,
        compareTargetGraphFocusNodeId: null,
        graphFocusAfterRenderHost: null,
        currentWorkflowQueryRight: '',
        currentWorkflowCodeRight: null,
        exploreLeftSelection: null,
        exploreRightSelection: null,
    });
    localStorage.setItem('sf_active_project', baseId);
    populateAnalytics(baseDash);
    updateProjectBadge();
    queueMicrotask(() => {
        import('./matrix').then(m => m.warmPermMatrixCacheIfIdle());
    });
    try {
        const u = new URL(location.href);
        u.searchParams.set('split', '1');
        history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`);
    } catch {
        /* ignore */
    }
    markRightGraphDirty();
    void import('./workspace').then(m => m.refreshWorkspace());
    return { ok: true };
}

/** After structural compare API succeeds: load full dashboards for base (left) and target (right) and enable split mode. */
export async function armSplitCompareAfterDiff(
    baseId: string,
    targetId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
    return restoreSplitCompareFromPair(baseId, targetId);
}

/** Hide the target pane without unloading the target instance (instant when returning to split). */
export function hideSplitCompareLayout() {
    if (!S.splitCompareMode || !S.compareTargetPrepared) return;
    void import('./graph-render').then(({ clearCompareTargetGraphCanvas }) => clearCompareTargetGraphCanvas());
    patchAppState({ splitCompareLayoutHidden: true });
    void import('./workspace').then(m => m.refreshWorkspace());
}

export function showSplitCompareLayout() {
    if (!S.splitCompareMode || !S.compareTargetPrepared) return;
    patchAppState({ splitCompareLayoutHidden: false });
    markRightGraphDirty();
    void import('./workspace').then(m => m.refreshWorkspace());
}

/** Drop target model and end the compare session (Compare tab diff may still be in memory). */
export function exitSplitCompareMode() {
    void import('./graph-render').then(({ clearCompareTargetGraphCanvas }) => clearCompareTargetGraphCanvas());
    patchAppState({
        splitCompareMode: false,
        splitCompareLayoutHidden: false,
        compareTargetPrepared: null,
        compareTargetProjectId: null,
        compareTargetProjectName: null,
        compareTargetViewKind: 'suite',
        compareTargetModule: 'ALL',
        compareTargetSubModule: 'ALL',
        compareTargetView: 'all',
        compareTargetObjectClass: 'ALL_OBJECTS',
        compareTargetIncludeRolePermissionLinks: false,
        compareTargetShowIsolated: false,
        compareTargetGraphFocusNodeId: null,
        graphFocusAfterRenderHost: null,
        currentWorkflowQueryRight: '',
        currentWorkflowCodeRight: null,
        exploreLeftSelection: null,
        exploreRightSelection: null,
    });
    try {
        const u = new URL(location.href);
        u.searchParams.delete('split');
        history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`);
    } catch {
        /* ignore */
    }
    void import('./workspace').then(m => m.refreshWorkspace());
}

/** Toggle `.is-split` on split wrappers; hide right column when off. */
export function syncSplitWorkspaceLayout() {
    const on = isSplitCompareLayoutVisible();
    document.querySelectorAll('.workspace-split').forEach(el => {
        el.classList.toggle('is-split', on);
        const rightPanes = Array.from(el.children).filter(
            (child): child is HTMLElement =>
                child instanceof HTMLElement && child.classList.contains('workspace-split-pane--right')
        );
        rightPanes.forEach(pane => {
            if (on) pane.removeAttribute('hidden');
            else pane.setAttribute('hidden', '');
        });
    });
    const graphSplit = document.getElementById('graph-canvas-split');
    if (graphSplit) graphSplit.classList.toggle('is-split', on);
}

export function renderSplitCompareStrip() {
    const el = document.getElementById('split-compare-strip');
    if (!el) return;

    if (!S.splitCompareMode || !S.compareTargetPrepared) {
        el.innerHTML = '';
        el.setAttribute('hidden', '');
        return;
    }

    const left = S.activeProjectName || S.activeProjectId || 'Base';
    const right = S.compareTargetProjectName || S.compareTargetProjectId || 'Target';
    const hidden = S.splitCompareLayoutHidden;
    const collapsed = S.splitCompareStripCollapsed;
    el.removeAttribute('hidden');
    el.classList.toggle('is-collapsed', collapsed);
    if (collapsed) {
        el.innerHTML = `
            <div class="split-compare-pill">
                <span class="split-compare-strip-label">Compare</span>
                <span class="split-compare-strip-pair" title="Left = base, right = target">
                    <strong>${escapeHtml(left)}</strong>
                    <span class="split-compare-vs">vs</span>
                    <strong>${escapeHtml(right)}</strong>
                </span>
                ${hidden ? '<span class="split-compare-strip-hint">Target pane hidden</span>' : ''}
                <button type="button" class="toolbar-chip" id="split-compare-show-strip">Show</button>
                <button type="button" class="toolbar-chip" id="split-compare-toggle-layout">${hidden ? 'Show target pane' : 'Hide target pane'}</button>
                <button type="button" class="toolbar-chip split-compare-exit" id="split-compare-exit">End compare session</button>
            </div>
        `;
        document.getElementById('split-compare-show-strip')?.addEventListener('click', () => {
            patchAppState({ splitCompareStripCollapsed: false });
            renderSplitCompareStrip();
        });
        document.getElementById('split-compare-toggle-layout')?.addEventListener('click', () => {
            if (S.splitCompareLayoutHidden) showSplitCompareLayout();
            else hideSplitCompareLayout();
        });
        document.getElementById('split-compare-exit')?.addEventListener('click', () => exitSplitCompareMode());
        return;
    }

    el.innerHTML = `
        <div class="split-compare-strip-inner">
            <span class="split-compare-strip-label">Compare session</span>
            <span class="split-compare-strip-pair" title="Left = base, right = target">
                <strong>${escapeHtml(left)}</strong>
                <span class="split-compare-vs">vs</span>
                <strong>${escapeHtml(right)}</strong>
            </span>
            ${hidden ? '<span class="split-compare-strip-hint">Target pane hidden</span>' : ''}
            <button type="button" class="toolbar-chip" id="split-compare-collapse-strip">Hide compare bar</button>
            <button type="button" class="toolbar-chip" id="split-compare-toggle-layout">${hidden ? 'Show target pane' : 'Hide target pane'}</button>
            <button type="button" class="toolbar-chip split-compare-exit" id="split-compare-exit">End compare session</button>
        </div>
    `;
    document.getElementById('split-compare-collapse-strip')?.addEventListener('click', () => {
        patchAppState({ splitCompareStripCollapsed: true });
        renderSplitCompareStrip();
    });
    document.getElementById('split-compare-toggle-layout')?.addEventListener('click', () => {
        if (S.splitCompareLayoutHidden) showSplitCompareLayout();
        else hideSplitCompareLayout();
    });
    document.getElementById('split-compare-exit')?.addEventListener('click', () => exitSplitCompareMode());
}
