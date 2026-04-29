import { appState as S } from '../store';
import { getRankedRolesForRail, getRankedRolesForRailFromPrepared } from '../view-helpers';
import type { PreparedInstanceModel } from '../prepared-instance';
import { clearGraph, hideHoverPanel } from '../graph-render';
import { computePermissionMatrixGridModel, buildPermissionMatrixShellHTML } from './layout';
import { buildMatrixDataRowInnerHtml } from './cell';
import { attachPermissionMatrixEvents, closePermissionDetailDrawer, getPermissionMatrixEventListenerStats } from './drawer';
import {
    collectPermMatrixDomStats,
    createEmptyVirtualizerStats,
    persistPermMatrixAgentDiagnostics,
    exportPermMatrixAgentDiagnostics,
    metricsFromGridModel,
    nowMs,
    readHeapUsedMB,
    recordVirtualizerPaint,
    roundMs,
    setLastPermMatrixRebuildStats,
    clearPermMatrixAgentDiagnosticsStorage,
    type PermMatrixModelTimings,
    type PermMatrixVirtualizerStats,
} from './diagnostics';
import { isPermMatrixDebugEnabled } from './debug';
import { escapeHtml } from '../utils';
import { isSplitCompareLayoutVisible } from '../split-compare';

export type { PermMatrixRebuildStats } from './diagnostics';
export type { PermMatrixGridModel } from './layout';
export { lastPermMatrixRebuildStats } from './diagnostics';
export { exportPermMatrixAgentDiagnostics } from './diagnostics';

const PERM_MATRIX_ROW_HEIGHT = 76;
const PERM_MATRIX_OVERSCAN = 8;
const PERM_MATRIX_AGENT_STORAGE_KEY_SHELL = 'permMatrix.shell.unused';
void PERM_MATRIX_AGENT_STORAGE_KEY_SHELL;

const permMatrixVirtualizerCleanups = new Map<HTMLElement, () => void>();
const permMatrixVirtualizerStats = new Map<HTMLElement, PermMatrixVirtualizerStats>();
const permMatrixEventCleanups = new Map<HTMLElement, () => void>();
let matrixFacetRebuildTimer: ReturnType<typeof setTimeout> | null = null;

function teardownPermMatrixVirtualizerFor(host: HTMLElement) {
    permMatrixVirtualizerCleanups.get(host)?.();
    permMatrixVirtualizerCleanups.delete(host);
    permMatrixVirtualizerStats.delete(host);
}

function teardownPermMatrixEventsFor(host: HTMLElement) {
    permMatrixEventCleanups.get(host)?.();
    permMatrixEventCleanups.delete(host);
}

function teardownPermMatrixHostFor(host: HTMLElement) {
    teardownPermMatrixVirtualizerFor(host);
    teardownPermMatrixEventsFor(host);
}

function getPermMatrixBuildInputs():
    | {
        moduleFamily: string | null;
        sub: string | null;
        ranked: any[];
        objects: any[];
        roleObjectPermissions: any[];
        roleObjectByObject: Map<string, any[]>;
        dashboard: any;
        pane: 'base' | 'embedded';
    }
    | null {
    const moduleFamily = S.matrixModule !== 'ALL' ? S.matrixModule : null;
    const sub = S.matrixSubModule !== 'ALL' ? S.matrixSubModule : null;
    const ranked = getRankedRolesForRail(moduleFamily, sub);
    let objects = S.allNodes.filter((n: any) => n.type === 'MDF_OBJECT');
    if (moduleFamily) objects = objects.filter((n: any) => n.moduleFamily === moduleFamily);
    if (sub) objects = objects.filter((n: any) => n.subModule === sub);
    objects = objects.sort((a: any, b: any) => String(a.label || a.id).localeCompare(String(b.label || b.id)));
    if (ranked.length === 0 || objects.length === 0) return null;
    return {
        moduleFamily,
        sub,
        ranked,
        objects,
        roleObjectPermissions: S.roleObjectPermissions,
        roleObjectByObject: S.roleObjectByObject,
        dashboard: S.dashboard,
        pane: 'base'
    };
}

function getPermMatrixBuildInputsForPrepared(prep: PreparedInstanceModel):
    | {
        moduleFamily: string | null;
        sub: string | null;
        ranked: any[];
        objects: any[];
        roleObjectPermissions: any[];
        roleObjectByObject: Map<string, any[]>;
        dashboard: any;
        pane: 'target';
    }
    | null {
    const moduleFamily = S.matrixModule !== 'ALL' ? S.matrixModule : null;
    const sub = S.matrixSubModule !== 'ALL' ? S.matrixSubModule : null;
    const ranked = getRankedRolesForRailFromPrepared(prep, moduleFamily, sub);
    let objects = prep.allNodes.filter((n: any) => n.type === 'MDF_OBJECT');
    if (moduleFamily) objects = objects.filter((n: any) => n.moduleFamily === moduleFamily);
    if (sub) objects = objects.filter((n: any) => n.subModule === sub);
    objects = objects.sort((a: any, b: any) => String(a.label || a.id).localeCompare(String(b.label || b.id)));
    if (ranked.length === 0 || objects.length === 0) return null;
    return {
        moduleFamily,
        sub,
        ranked,
        objects,
        roleObjectPermissions: prep.roleObjectPermissions,
        roleObjectByObject: prep.roleObjectByObject,
        dashboard: prep.dashboard,
        pane: 'target'
    };
}

function setPermMatrixLoading(visible: boolean, message?: string, side: 'left' | 'right' = 'left') {
    const overlay = document.getElementById(
        side === 'right' ? 'perm-matrix-loading-overlay-right' : 'perm-matrix-loading-overlay'
    );
    const sub = document.getElementById(
        side === 'right' ? 'perm-matrix-loading-sub-right' : 'perm-matrix-loading-sub'
    );
    if (!overlay) return;
    if (visible) {
        overlay.removeAttribute('hidden');
        if (sub && message) sub.textContent = message;
    } else {
        overlay.setAttribute('hidden', '');
    }
}

function scheduleDebouncedMatrixRebuild(container: any) {
    if (matrixFacetRebuildTimer) clearTimeout(matrixFacetRebuildTimer);
    matrixFacetRebuildTimer = setTimeout(() => {
        matrixFacetRebuildTimer = null;
        rebuildMatrixInPlace(container);
    }, 40);
}

function scheduleRightMatrixRebuildLazy(host: HTMLElement) {
    const targetProjectId = S.compareTargetProjectId;
    const go = () => {
        // This render is intentionally deferred; by the time it runs we may have exited split mode.
        // If so, bail to avoid painting the target matrix into the hidden/secondary pane.
        const splitOn = isSplitCompareLayoutVisible();
        if (!splitOn) return;
        if (S.compareTargetProjectId !== targetProjectId) return;
        if (!host.isConnected) return;
        const splitRoot = host.closest('.workspace-split');
        if (splitRoot && !splitRoot.classList.contains('is-split')) return;
        rebuildMatrixInPlace(host);
    };
    if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => go(), { timeout: 750 });
    } else {
        setTimeout(go, 48);
    }
}

function teardownPermMatrixVirtualizer() {
    for (const h of [...new Set([...permMatrixVirtualizerCleanups.keys(), ...permMatrixEventCleanups.keys()])]) {
        teardownPermMatrixHostFor(h);
    }
}

function offsetTopBetween(child: HTMLElement, ancestor: HTMLElement): number {
    let top = 0;
    let n: HTMLElement | null = child;
    while (n && n !== ancestor) {
        top += n.offsetTop;
        n = n.offsetParent as HTMLElement | null;
    }
    return top;
}

function findMatrixScrollRoot(start: HTMLElement, preferred: HTMLElement): HTMLElement {
    const overflow = getComputedStyle(preferred).overflow + getComputedStyle(preferred).overflowY;
    if (overflow.includes('auto') || overflow.includes('scroll')) return preferred;
    let el: HTMLElement | null = start.parentElement;
    while (el) {
        const style = getComputedStyle(el);
        if (style.overflow.includes('auto') || style.overflow.includes('scroll') ||
            style.overflowY.includes('auto') || style.overflowY.includes('scroll')) return el;
        el = el.parentElement;
    }
    return preferred;
}

function collectOverflowScrollAncestors(start: HTMLElement): HTMLElement[] {
    const result: HTMLElement[] = [];
    let el: HTMLElement | null = start.parentElement;
    while (el) {
        const style = getComputedStyle(el);
        if (style.overflow.includes('auto') || style.overflow.includes('scroll') ||
            style.overflowY.includes('auto') || style.overflowY.includes('scroll')) {
            result.push(el);
        }
        el = el.parentElement;
    }
    return result;
}

function mountPermMatrixVirtualizer(
    container: HTMLElement,
    model: ReturnType<typeof computePermissionMatrixGridModel>
) {
    teardownPermMatrixVirtualizerFor(container);
    if (!model.hasVisibleMatrix || model.rows.length === 0) return;

    const scrollEl = container.querySelector('.perm-matrix-scroll') as HTMLElement | null;
    const tbody = container.querySelector('#perm-matrix-vtbody') as HTMLTableSectionElement | null;
    if (!scrollEl || !tbody) return;

    const colspan = model.displayRoles.length + 2;

    const appendSpacerRow = (frag: DocumentFragment, px: number) => {
        const tr = document.createElement('tr');
        tr.className = 'perm-v-spacer';
        const td = document.createElement('td');
        td.colSpan = colspan;
        td.style.padding = '0';
        td.style.border = 'none';
        td.setAttribute('aria-hidden', 'true');
        const fill = document.createElement('div');
        fill.className = 'perm-v-spacer-fill';
        fill.style.height = `${Math.max(0, px)}px`;
        td.appendChild(fill);
        tr.appendChild(td);
        frag.appendChild(tr);
    };

    const scrollCandidates = collectOverflowScrollAncestors(tbody);
    if (!scrollCandidates.includes(scrollEl)) {
        scrollCandidates.push(scrollEl);
    }

    const allRowIndices = model.rows.map((_, i) => i);
    const populatedRowIndices = allRowIndices.filter(i => model.rows[i].coverage > 0);
    const stats = createEmptyVirtualizerStats();
    permMatrixVirtualizerStats.set(container, stats);

    const paint = (reason = 'manual') => {
        const paintStart = nowMs();
        const rowIndices = S.matrixHideUnallocatedRows ? populatedRowIndices : allRowIndices;
        const n = rowIndices.length;
        if (n === 0) {
            tbody.replaceChildren();
            recordVirtualizerPaint(stats, nowMs() - paintStart, reason, 0, 0, 0);
            return;
        }
        const scrollRoot = findMatrixScrollRoot(tbody, scrollEl!);
        const tbodyTop = offsetTopBetween(tbody, scrollRoot);
        const vh = scrollRoot.clientHeight;
        const rawStBody = Math.max(0, scrollRoot.scrollTop - tbodyTop);
        const maxStBody = Math.max(0, n * PERM_MATRIX_ROW_HEIGHT - vh);
        const stBody = Math.min(rawStBody, maxStBody);
        if (rawStBody !== stBody) {
            scrollRoot.scrollTop = tbodyTop + stBody;
        }
        const start = Math.max(0, Math.floor(stBody / PERM_MATRIX_ROW_HEIGHT) - PERM_MATRIX_OVERSCAN);
        const end = Math.min(n, Math.ceil((stBody + vh) / PERM_MATRIX_ROW_HEIGHT) + PERM_MATRIX_OVERSCAN);
        const topPad = start * PERM_MATRIX_ROW_HEIGHT;
        const botPad = (n - end) * PERM_MATRIX_ROW_HEIGHT;

        const frag = document.createDocumentFragment();
        appendSpacerRow(frag, topPad);

        for (let k = start; k < end; k++) {
            const modelRowIdx = rowIndices[k]!;
            const tr = document.createElement('tr');
            const row = model.rows[modelRowIdx];
            const band = k % 2 === 0 ? 'perm-row--even' : 'perm-row--odd';
            const rowClass = [band, row.coverage === 0 ? 'perm-row--no-coverage' : ''].filter(Boolean).join(' ');
            tr.className = rowClass;
            tr.setAttribute('data-row-coverage', String(row.coverage));
            tr.innerHTML = buildMatrixDataRowInnerHtml(model, modelRowIdx);
            frag.appendChild(tr);
        }

        appendSpacerRow(frag, botPad);
        tbody.replaceChildren(frag);
        const visibleRows = Math.max(0, end - start);
        recordVirtualizerPaint(
            stats,
            nowMs() - paintStart,
            reason,
            visibleRows,
            visibleRows * (model.displayRoles.length + 2),
            rowIndices.length
        );
    };

    let raf = 0;
    let bootRaf = 0;
    const schedule = (reason = 'scroll') => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
            raf = 0;
            paint(reason);
        });
    };

    const scrollHandlers: Array<{ el: HTMLElement; handler: () => void }> = [];
    for (const r of scrollCandidates) {
        const handler = () => schedule('scroll');
        scrollHandlers.push({ el: r, handler });
        r.addEventListener('scroll', handler, { passive: true });
    }
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => schedule('resize')) : null;
    for (const r of scrollCandidates) {
        ro?.observe(r);
    }
    ro?.observe(scrollEl);
    ro?.observe(tbody);

    paint('initial');
    bootRaf = requestAnimationFrame(() => {
        bootRaf = 0;
        schedule('boot');
    });

    (container as HTMLElement & { __permMatrixVirtualSchedule?: (reason?: string) => void }).__permMatrixVirtualSchedule = schedule;

    const cleanup = () => {
        if (raf) cancelAnimationFrame(raf);
        if (bootRaf) cancelAnimationFrame(bootRaf);
        raf = 0;
        bootRaf = 0;
        delete (container as HTMLElement & { __permMatrixVirtualSchedule?: (reason?: string) => void }).__permMatrixVirtualSchedule;
        for (const { el, handler } of scrollHandlers) {
            el.removeEventListener('scroll', handler);
        }
        ro?.disconnect();
        permMatrixVirtualizerCleanups.delete(container);
        permMatrixVirtualizerStats.delete(container);
    };
    permMatrixVirtualizerCleanups.set(container, cleanup);
}

/** Cancel matrix virtualizer timers/listeners when rebuilding or tearing down the matrix. */
export function teardownPermissionMatrixVirtualizer() {
    teardownPermMatrixVirtualizer();
}

export function schedulePermMatrixVirtualPaint(container: HTMLElement) {
    (container as HTMLElement & { __permMatrixVirtualSchedule?: (reason?: string) => void }).__permMatrixVirtualSchedule?.('manual');
}

export function warmPermMatrixCacheIfIdle() {}

function getInputsForMatrixHost(host: HTMLElement) {
    const prep = host.dataset?.matrixPane === 'target' ? S.compareTargetPrepared : null;
    if (prep) return getPermMatrixBuildInputsForPrepared(prep);
    return getPermMatrixBuildInputs();
}

function targetMatrixEmptyHtml(prep: PreparedInstanceModel): string {
    const moduleFamily = S.matrixModule !== 'ALL' ? S.matrixModule : null;
    const sub = S.matrixSubModule !== 'ALL' ? S.matrixSubModule : null;
    const ranked = getRankedRolesForRailFromPrepared(prep, moduleFamily, sub);
    let objects = prep.allNodes.filter((n: any) => n.type === 'MDF_OBJECT');
    if (moduleFamily) objects = objects.filter((n: any) => n.moduleFamily === moduleFamily);
    if (sub) objects = objects.filter((n: any) => n.subModule === sub);
    const permRows = prep.roleObjectPermissions.length;
    const scopeLabel = moduleFamily
        ? `${moduleFamily}${sub ? ` / ${sub}` : ''}`
        : 'ALL modules';
    const tenant = S.compareTargetProjectName || S.compareTargetProjectId || 'target';
    const lines: string[] = [
        `<p><strong>${escapeHtml(tenant)}</strong> · scope <strong>${escapeHtml(scopeLabel)}</strong></p>`,
        `<p class="perm-matrix-hint-text">${permRows.toLocaleString()} permission row(s) in bundle · ${ranked.length} role(s) in scope · ${objects.length} MDF object(s) in scope.</p>`,
    ];
    if (permRows === 0) {
        lines.push(
            '<p class="perm-matrix-hint-text">This export has no role–object permission rows. Re-import the target project with RBP/permission sources.</p>'
        );
    } else if (ranked.length === 0 || objects.length === 0) {
        lines.push(
            '<p class="perm-matrix-hint-text">Filters exclude all roles or objects for the matrix. Set module pickers to <strong>ALL</strong> or choose a module present on the target.</p>'
        );
    }
    lines.push(
        '<p class="perm-matrix-hint-text">If the bundle should contain permissions, upload the correct CSV/JSON in Import and run Process again.</p>'
    );
    return `<div class="perm-matrix-empty">${lines.join('')}</div>`;
}

function matrixEmptyHtmlForHost(host: HTMLElement): string {
    if (host.dataset?.matrixPane === 'target' && S.compareTargetPrepared) {
        return targetMatrixEmptyHtml(S.compareTargetPrepared);
    }
    return `<div class="perm-matrix-empty"><p>No permission data for this scope.</p><p class="perm-matrix-hint-text">Upload RBP permission CSV files in Import to populate the matrix.</p></div>`;
}

function permMatrixLoadingSide(host: HTMLElement): 'left' | 'right' {
    return host.id === 'roles-matrix-container-right' ? 'right' : 'left';
}

export function renderPermissionMatrix() {
    const left = document.getElementById('roles-matrix-container');
    const right = document.getElementById('roles-matrix-container-right');
    const embedded = document.getElementById('graph-canvas');

    S.hoveredComponentId = null;
    hideHoverPanel();

    const primary = left || embedded;
    if (!primary) return;
    if (primary.id === 'graph-canvas') clearGraph();

    if (left) {
        left.dataset!.matrixPane = 'base';
    }

    if (!getInputsForMatrixHost(primary as HTMLElement)) {
        primary.innerHTML = matrixEmptyHtmlForHost(primary as HTMLElement);
        teardownPermMatrixHostFor(primary as HTMLElement);
    } else {
        rebuildMatrixInPlace(primary as HTMLElement);
    }

    if (right) {
        if (isSplitCompareLayoutVisible()) {
            closePermissionDetailDrawer('single');
            right.dataset!.matrixPane = 'target';
            if (!getInputsForMatrixHost(right)) {
                right.innerHTML = matrixEmptyHtmlForHost(right as HTMLElement);
                teardownPermMatrixHostFor(right);
            } else {
                scheduleRightMatrixRebuildLazy(right as HTMLElement);
            }
        } else {
            closePermissionDetailDrawer('left-compare');
            closePermissionDetailDrawer('right-compare');
            delete right.dataset!.matrixPane;
            right.innerHTML =
                S.splitCompareMode && S.compareTargetPrepared && S.splitCompareLayoutHidden
                    ? '<div class="empty-mini">Target pane is hidden. Choose <strong>Show target pane</strong> in the compare strip.</div>'
                    : '<div class="empty-mini">Use the Compare tab to load two projects side by side.</div>';
            teardownPermMatrixHostFor(right);
        }
    }
}

/**
 * Full matrix refresh. When `?matrix-debug=1` is present, timing is logged (filter "perm-matrix") and
 * diagnostics are available: `lastPermMatrixRebuildStats`, `sessionStorage['permMatrix.agentDiagnostics.v1']`,
 * `window.__permMatrixDiag.exportForAgent()`.
 */
export function rebuildMatrixInPlace(container?: HTMLElement) {
    const host = container || document.getElementById('roles-matrix-container') || document.getElementById('graph-canvas');
    if (!host) return;

    const hostEl = host as HTMLElement;
    const inputsEarly = getInputsForMatrixHost(hostEl);
    if (!inputsEarly) {
        teardownPermMatrixHostFor(hostEl);
        setPermMatrixLoading(false, undefined, permMatrixLoadingSide(hostEl));
        host.innerHTML = matrixEmptyHtmlForHost(hostEl);
        return;
    }

    const useOverlay =
        (host.id === 'roles-matrix-container' && !!document.getElementById('perm-matrix-loading-overlay')) ||
        (host.id === 'roles-matrix-container-right' && !!document.getElementById('perm-matrix-loading-overlay-right'));
    const slowPath = useOverlay;
    const loadSide = permMatrixLoadingSide(hostEl);

    const eventCbs = {
        rebuild: rebuildMatrixInPlace,
        debouncedRebuild: scheduleDebouncedMatrixRebuild,
        virtualPaint: schedulePermMatrixVirtualPaint,
        getInputs: () => getInputsForMatrixHost(hostEl),
    };

    const runRebuild = () => {
        teardownPermMatrixHostFor(hostEl);
        const t0 = nowMs();
        const inputs = getInputsForMatrixHost(hostEl);
        if (!inputs) {
            setPermMatrixLoading(false, undefined, loadSide);
            host.innerHTML = matrixEmptyHtmlForHost(hostEl);
            return;
        }
        const { moduleFamily, sub, ranked, objects } = inputs;
        const moduleScope = moduleFamily ? `${moduleFamily}${sub ? ` / ${sub}` : ''}` : 'ALL';

        const subEl = document.getElementById(
            loadSide === 'right' ? 'perm-matrix-loading-sub-right' : 'perm-matrix-loading-sub'
        );
        if (subEl && useOverlay) subEl.textContent = 'Computing grid…';

        const modelTimings: PermMatrixModelTimings = {};
        const modelStart = nowMs();
        const model = computePermissionMatrixGridModel(ranked, objects, moduleFamily, sub, {
            roleObjectPermissions: inputs.roleObjectPermissions,
            roleObjectByObject: inputs.roleObjectByObject,
            dashboard: inputs.dashboard,
            timings: modelTimings,
            synchronizeSelections: inputs.pane !== 'target'
        });
        const modelEnd = nowMs();
        const shellStart = nowMs();
        const shellHtml = buildPermissionMatrixShellHTML(model);
        const shellEnd = nowMs();
        const t1 = shellEnd;

        if (subEl && useOverlay) subEl.textContent = 'Rendering shell…';
        host.innerHTML = shellHtml;
        const t2 = nowMs();
        void t2;

        if (subEl && useOverlay && model.hasVisibleMatrix) subEl.textContent = 'Mounting visible rows…';
        mountPermMatrixVirtualizer(hostEl, model);
        const virtualStats = permMatrixVirtualizerStats.get(hostEl) ?? createEmptyVirtualizerStats();
        const t2b = nowMs();

        const eventCleanup = attachPermissionMatrixEvents(host, eventCbs);
        permMatrixEventCleanups.set(hostEl, eventCleanup);
        const t3 = nowMs();

        setPermMatrixLoading(false, undefined, loadSide);

        const buildHtmlMs = t1 - t0;
        const innerHTMLMs = t2b - t1;
        const attachEventsMs = t3 - t2b;
        const totalMs = t3 - t0;

        const innerRounded = +innerHTMLMs.toFixed(2);
        const metrics = metricsFromGridModel(model, shellHtml.length);
        const stats = {
            schemaVersion: 1 as const,
            timestamp: Date.now(),
            pane: host.id === 'roles-matrix-container-right'
                ? 'target' as const
                : (host.id === 'graph-canvas' ? 'embedded' as const : inputs.pane),
            buildHtmlMs: roundMs(buildHtmlMs),
            modelComputeMs: roundMs(modelEnd - modelStart),
            shellHtmlMs: roundMs(shellEnd - shellStart),
            innerHTMLMs: innerRounded,
            insertHTMLMs: innerRounded,
            attachEventsMs: roundMs(attachEventsMs),
            firstVirtualPaintMs: virtualStats.firstPaintMs,
            virtualPaintCount: virtualStats.paintCount,
            virtualScrollPaintCount: virtualStats.scrollPaintCount,
            virtualMaxPaintMs: virtualStats.maxPaintMs,
            totalMs: roundMs(totalMs),
            htmlLengthChars: metrics.htmlLengthChars,
            approxBodyRows: metrics.approxBodyRows,
            approxRoleColumns: metrics.approxRoleColumns,
            approxRoleColumnsHidden: metrics.approxRoleColumnsHidden,
            approxRoleColumnsWithVisibleCells: metrics.approxRoleColumnsWithVisibleCells,
            approxPermCells: metrics.approxPermCells,
            approxPermTokens: metrics.approxPermTokens,
            hideUnallocatedRows: S.matrixHideUnallocatedRows,
            hideUnallocatedRoles: S.matrixHideUnallocatedRoles,
            moduleScope,
            viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 0,
            viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
            domStats: collectPermMatrixDomStats(hostEl),
            heapUsedMB: readHeapUsedMB(),
            modelTimings,
            eventListeners: getPermissionMatrixEventListenerStats(),
            cacheHit: false,
            virtualized: true
        };
        if (isPermMatrixDebugEnabled()) {
            setLastPermMatrixRebuildStats(stats);
            persistPermMatrixAgentDiagnostics(stats);

            if (typeof window !== 'undefined') {
                const w = window as any;
                w.__permMatrixDiag = {
                    last: stats,
                    storageKey: 'permMatrix.agentDiagnostics.v1',
                    liveVirtualizers: () => Array.from(permMatrixVirtualizerStats.entries()).map(([el, s]) => ({
                        hostId: el.id || null,
                        ...s
                    })),
                    eventListeners: getPermissionMatrixEventListenerStats,
                    runRebuildLoop: async (count = 20) => {
                        const n = Math.max(1, Math.min(100, Number(count) || 20));
                        const out = [];
                        for (let i = 0; i < n; i += 1) {
                            rebuildMatrixInPlace(hostEl);
                            await new Promise(resolve => setTimeout(resolve, 0));
                            out.push({
                                i,
                                last: (window as any).__permMatrixDiag?.last,
                                eventListeners: getPermissionMatrixEventListenerStats()
                            });
                        }
                        return out;
                    },
                    logLast: () => console.info('[perm-matrix] rebuild', stats),
                    exportForAgent: exportPermMatrixAgentDiagnostics,
                    logExportForAgent: () => {
                        const s = exportPermMatrixAgentDiagnostics();
                        console.info('[perm-matrix] agent export (copy below)\n', s);
                        return s;
                    }
                };
            }

            if (typeof console !== 'undefined' && console.info) {
                console.info('[perm-matrix] rebuild', {
                    schemaVersion: stats.schemaVersion,
                    virtualized: stats.virtualized,
                    pane: stats.pane,
                    buildHtmlMs: stats.buildHtmlMs,
                    modelComputeMs: stats.modelComputeMs,
                    shellHtmlMs: stats.shellHtmlMs,
                    modelTimings: stats.modelTimings,
                    innerHTMLMs: stats.innerHTMLMs,
                    insertHTMLMs: stats.insertHTMLMs,
                    attachEventsMs: stats.attachEventsMs,
                    firstVirtualPaintMs: stats.firstVirtualPaintMs,
                    virtualPaintCount: stats.virtualPaintCount,
                    virtualMaxPaintMs: stats.virtualMaxPaintMs,
                    domStats: stats.domStats,
                    heapUsedMB: stats.heapUsedMB,
                    eventListeners: stats.eventListeners,
                    totalMs: stats.totalMs,
                    hideUnallocatedRows: stats.hideUnallocatedRows,
                    hideUnallocatedRoles: stats.hideUnallocatedRoles,
                    moduleScope: stats.moduleScope,
                    approxBodyRows: stats.approxBodyRows,
                    approxRoleColumns: stats.approxRoleColumns,
                    approxRoleColumnsHidden: stats.approxRoleColumnsHidden,
                    approxRoleColumnsWithVisibleCells: stats.approxRoleColumnsWithVisibleCells,
                    approxPermCells: stats.approxPermCells,
                    approxPermTokens: stats.approxPermTokens,
                    htmlLengthChars: stats.htmlLengthChars,
                    viewport: `${stats.viewportWidth}x${stats.viewportHeight}`,
                    agentExport: 'run __permMatrixDiag.logExportForAgent() for JSON bundle'
                });
            }
        } else {
            setLastPermMatrixRebuildStats(null);
            clearPermMatrixAgentDiagnosticsStorage();
            if (typeof window !== 'undefined') {
                try {
                    delete (window as any).__permMatrixDiag;
                } catch {
                    /* ignore */
                }
            }
        }
    };

    if (slowPath) {
        setPermMatrixLoading(true, 'Building table…', loadSide);
        requestAnimationFrame(() => {
            requestAnimationFrame(runRebuild);
        });
    } else {
        runRebuild();
    }
}
