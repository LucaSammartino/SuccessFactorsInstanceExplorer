import type { PermMatrixGridModel } from './layout';
import { isPermMatrixDebugEnabled } from './debug';

const PERM_MATRIX_AGENT_STORAGE_KEY = 'permMatrix.agentDiagnostics.v1';

export type PermMatrixModelTimings = Record<string, number>;

export type PermMatrixVirtualizerStats = {
    paintCount: number;
    scrollPaintCount: number;
    firstPaintMs: number;
    lastPaintMs: number;
    maxPaintMs: number;
    totalPaintMs: number;
    visibleRowsLast: number;
    renderedCellsLast: number;
    rowIndexCountLast: number;
};

export type PermMatrixEventListenerStats = {
    activeTotal: number;
    totalAttached: number;
    totalRemoved: number;
    cleanupRuns: number;
    activeDocumentKeydown: number;
    activeDrawerClose: number;
    activeHostDelegated: number;
    activeTableListeners: number;
    activeFilterListeners: number;
};

export type PermMatrixDomStats = {
    hostNodeCount: number;
    tableNodeCount: number;
    tbodyNodeCount: number;
    renderedRows: number;
    renderedCells: number;
};

export type PermMatrixRebuildStats = {
    schemaVersion: 1;
    timestamp: number;
    pane: 'base' | 'target' | 'embedded';
    buildHtmlMs: number;
    modelComputeMs: number;
    shellHtmlMs: number;
    innerHTMLMs: number;
    insertHTMLMs: number;
    attachEventsMs: number;
    firstVirtualPaintMs: number;
    virtualPaintCount: number;
    virtualScrollPaintCount: number;
    virtualMaxPaintMs: number;
    totalMs: number;
    htmlLengthChars: number;
    approxBodyRows: number;
    approxRoleColumns: number;
    approxRoleColumnsHidden: number;
    approxRoleColumnsWithVisibleCells: number;
    approxPermCells: number;
    approxPermTokens: number;
    hideUnallocatedRows: boolean;
    hideUnallocatedRoles: boolean;
    moduleScope: string;
    viewportWidth: number;
    viewportHeight: number;
    domStats: PermMatrixDomStats;
    heapUsedMB: number | null;
    modelTimings: PermMatrixModelTimings;
    eventListeners: PermMatrixEventListenerStats | null;
    cacheHit?: boolean;
    virtualized?: boolean;
};

export let lastPermMatrixRebuildStats: PermMatrixRebuildStats | null = null;

export function setLastPermMatrixRebuildStats(stats: PermMatrixRebuildStats | null) {
    lastPermMatrixRebuildStats = stats;
}

export function measurePermissionMatrixHtml(html: string) {
    const tbodyInner = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
    const approxBodyRows = tbodyInner ? (tbodyInner[1].match(/<tr\b/g) || []).length : 0;
    const approxRoleColumns = (html.match(/class="perm-col-header/g) || []).length;
    const approxRoleColumnsHidden = (html.match(/class="perm-col-header perm-col--no-visible"/g) || []).length;
    const approxPermCells = (html.match(/class="perm-cell has-perm"/g) || []).length;
    const approxPermTokens = (html.match(/class="perm-token /g) || []).length;
    return { approxBodyRows, approxRoleColumns, approxRoleColumnsHidden, approxPermCells, approxPermTokens };
}

export function persistPermMatrixAgentDiagnostics(stats: PermMatrixRebuildStats) {
    if (!isPermMatrixDebugEnabled()) return;
    try {
        const raw = sessionStorage.getItem(PERM_MATRIX_AGENT_STORAGE_KEY);
        const list: PermMatrixRebuildStats[] = raw ? JSON.parse(raw) : [];
        list.push(stats);
        sessionStorage.setItem(PERM_MATRIX_AGENT_STORAGE_KEY, JSON.stringify(list.slice(-25)));
    } catch (_) { /* sessionStorage may be unavailable */ }
}

/** Drop agent diagnostic history when matrix-debug is off (e.g. after disabling the flag). */
export function clearPermMatrixAgentDiagnosticsStorage() {
    if (typeof sessionStorage === 'undefined') return;
    try {
        sessionStorage.removeItem(PERM_MATRIX_AGENT_STORAGE_KEY);
    } catch (_) { /* ignore */ }
}

export function nowMs(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

export function roundMs(value: number): number {
    return +value.toFixed(2);
}

export function readHeapUsedMB(): number | null {
    const perf = typeof performance !== 'undefined' ? performance as any : null;
    const memory = perf?.memory;
    if (!memory || !Number.isFinite(memory.usedJSHeapSize)) return null;
    return +(memory.usedJSHeapSize / 1024 / 1024).toFixed(2);
}

export function collectPermMatrixDomStats(host: HTMLElement): PermMatrixDomStats {
    const table = host.querySelector('.perm-matrix-table');
    const tbody = host.querySelector('#perm-matrix-vtbody');
    return {
        hostNodeCount: host.querySelectorAll('*').length,
        tableNodeCount: table ? table.querySelectorAll('*').length : 0,
        tbodyNodeCount: tbody ? tbody.querySelectorAll('*').length : 0,
        renderedRows: tbody ? tbody.querySelectorAll('tr:not(.perm-v-spacer)').length : 0,
        renderedCells: tbody ? tbody.querySelectorAll('td,th').length : 0
    };
}

export function exportPermMatrixAgentDiagnostics(): string {
    try {
        const raw = sessionStorage.getItem(PERM_MATRIX_AGENT_STORAGE_KEY);
        if (!raw) return JSON.stringify({ error: 'No diagnostics recorded yet.' });
        const list = JSON.parse(raw);
        return JSON.stringify({ schemaVersion: 1, rebuilds: list }, null, 2);
    } catch (_) {
        return JSON.stringify({ error: 'Failed to read diagnostics.' });
    }
}

export function createEmptyVirtualizerStats(): PermMatrixVirtualizerStats {
    return {
        paintCount: 0,
        scrollPaintCount: 0,
        firstPaintMs: 0,
        lastPaintMs: 0,
        maxPaintMs: 0,
        totalPaintMs: 0,
        visibleRowsLast: 0,
        renderedCellsLast: 0,
        rowIndexCountLast: 0
    };
}

export function recordVirtualizerPaint(
    stats: PermMatrixVirtualizerStats,
    durationMs: number,
    reason: string,
    visibleRows: number,
    renderedCells: number,
    rowIndexCount: number
) {
    const rounded = roundMs(durationMs);
    stats.paintCount += 1;
    if (reason === 'scroll') stats.scrollPaintCount += 1;
    if (stats.paintCount === 1) stats.firstPaintMs = rounded;
    stats.lastPaintMs = rounded;
    stats.maxPaintMs = Math.max(stats.maxPaintMs, rounded);
    stats.totalPaintMs = roundMs(stats.totalPaintMs + durationMs);
    stats.visibleRowsLast = visibleRows;
    stats.renderedCellsLast = renderedCells;
    stats.rowIndexCountLast = rowIndexCount;
}

export function metricsFromGridModel(model: PermMatrixGridModel, shellHtmlLength: number) {
    const approxBodyRows = model.rows.length;
    const approxRoleColumns = model.displayRoles.length;
    const approxRoleColumnsHidden = model.roleColVisibleCount.filter(c => c === 0).length;
    let approxPermCells = 0;
    let approxPermTokens = 0;
    for (const row of model.rows) {
        for (let colIdx = 0; colIdx < model.displayRoles.length; colIdx++) {
            const role = model.displayRoles[colIdx];
            const key = `${role.roleId}|${row.obj.id}`;
            const permissionMeta = model.permMap.get(key);
            if (!permissionMeta) continue;
            const tags = Array.from(permissionMeta.filterTags || []) as string[];
            const matchesPermissionFilter = model.selectedPermissionSet.size === 0
                || tags.some(filterTag => model.selectedPermissionSet.has(filterTag));
            const fieldKeys: string[] = permissionMeta.fieldNameKeys
                ? Array.from(permissionMeta.fieldNameKeys as Set<string>)
                : [];
            const matchesFieldFilter = model.selectedFieldSet.size === 0
                || fieldKeys.some((fk: string) => model.selectedFieldSet.has(fk));
            if (!matchesPermissionFilter || !matchesFieldFilter) continue;
            approxPermCells += 1;
            const objectPerms = permissionMeta.objectPerms || [];
            const fieldPerms = permissionMeta.fieldPerms || [];
            const fo = permissionMeta.fieldOverrideEntries || [];
            approxPermTokens += Math.min(4, objectPerms.length) + Math.min(4, fo.length)
                + (fo.length ? 0 : Math.min(3, fieldPerms.length));
        }
    }
    return {
        approxBodyRows,
        approxRoleColumns,
        approxRoleColumnsWithVisibleCells: Math.max(0, approxRoleColumns - approxRoleColumnsHidden),
        approxRoleColumnsHidden,
        approxPermCells,
        approxPermTokens,
        htmlLengthChars: shellHtmlLength
    };
}
