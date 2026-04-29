import { refreshWorkspace } from '../workspace';
import { appState as S } from '../store';
import { escapeHtml } from '../utils';
import { renderProjectPickers } from './project-pickers';
import { clearCompareDetailCache } from './detail-panel';
import { renderOverviewPanel } from './overview-panel';
import { renderSearchBar, invalidateEntityIndex } from './search-bar';
import { renderEntityPanel, setSelectedEntityRow } from './entity-panel';
import type { EnrichedCompareResult } from '../../../src/core/CompareEnricher';

export const compareState = {
    baseId: null as string | null,
    targetId: null as string | null,
    result: null as EnrichedCompareResult | { error: string } | any,
    /** Split dashboards failed after a successful /compare; diff in `result` is still valid. */
    splitArmError: null as string | null,
};

let lastFetchedPairKey: string | null = null;

function pairKey(baseId: string | null, targetId: string | null): string | null {
    if (!baseId || !targetId) return null;
    return `${baseId}\0${targetId}`;
}

export async function mountCompareWorkspace(): Promise<void> {
    renderProjectPickers();
    renderCompareAlerts();
    renderCompleteWorkspace();
    // Always render entity panel (shows empty-state when no row selected)
    renderEntityPanel();
}

export async function fetchCompareData() {
    if (!compareState.baseId || !compareState.targetId) return;

    const pk = pairKey(compareState.baseId, compareState.targetId);
    if (pk !== lastFetchedPairKey) {
        clearCompareDetailCache();
        invalidateEntityIndex();
        setSelectedEntityRow(null);
        lastFetchedPairKey = pk;
    }

    compareState.splitArmError = null;

    const overviewMount = document.getElementById('compare-overview-mount');
    if (overviewMount) overviewMount.innerHTML = '<div class="empty-mini">Fetching comparison (this takes a few seconds)...</div>';

    const searchMount = document.getElementById('compare-search-mount');
    if (searchMount) searchMount.innerHTML = '';
    const worklistMount = document.getElementById('compare-worklist-mount');
    if (worklistMount) worklistMount.innerHTML = '';
    const heroMount = document.getElementById('compare-entity-hero-mount');
    if (heroMount) heroMount.innerHTML = '';
    const toolbarMount = document.getElementById('compare-action-toolbar-mount');
    if (toolbarMount) toolbarMount.innerHTML = '';
    const detailMount = document.getElementById('compare-detail-mount');
    if (detailMount) detailMount.innerHTML = '';

    try {
        const res = await fetch(`/api/projects/${compareState.baseId}/compare/${compareState.targetId}`);
        if (!res.ok) throw new Error(await res.text());
        compareState.result = await res.json();
    } catch (e) {
        compareState.result = { error: String(e) };
    }

    if (compareState.result && !compareState.result.error) {
        const { armSplitCompareAfterDiff } = await import('../split-compare');
        const arm = await armSplitCompareAfterDiff(compareState.baseId!, compareState.targetId!);
        if (!arm.ok) {
            compareState.splitArmError = arm.error;
        }
    }

    renderCompareAlerts();
    renderCompleteWorkspace();
    refreshWorkspace();
}

function renderCompareAlerts() {
    const mount = document.getElementById('compare-alerts-mount');
    if (!mount) return;

    const parts: string[] = [];

    const activeId = S.activeProjectId;
    const baseId = compareState.baseId;
    if (
        activeId &&
        baseId &&
        compareState.result &&
        !compareState.result.error &&
        activeId !== baseId
    ) {
        parts.push(`
            <div style="background: var(--ui5-message-warning-background); color: var(--ui5-message-warning-text-color); padding: 0.75rem 1rem; margin-bottom: 1rem; border-radius: 4px; border-left: 4px solid var(--ui5-message-warning-border-color); font-size: 0.875rem;">
                <strong>Active project differs from compare base.</strong>
                The graph and explorers reflect <strong>${escapeHtml(S.activeProjectName || activeId)}</strong>, but this diff is for base <strong>${escapeHtml(baseId)}</strong>.
                Reload the compare base project or run a new comparison.
            </div>
        `);
    }

    if (compareState.splitArmError && compareState.result && !compareState.result.error && baseId && compareState.targetId) {
        parts.push(`
            <div style="background: rgba(242, 153, 0, 0.12); border-left: 4px solid var(--compare-changed); padding: 1rem; border-radius: 4px; margin-bottom: 1rem;">
                <h3 style="margin-top: 0; color: var(--ui5-text-color); font-size: 1rem;">Split view could not be restored</h3>
                <p style="color: var(--ui5-text-color); margin: 0 0 0.75rem 0;">${escapeHtml(compareState.splitArmError)}</p>
                <p style="color: var(--ui5-text-color-secondary); font-size: 0.875rem; margin: 0 0 0.75rem 0;">The comparison below is still valid. You can retry loading both instances for side-by-side explorers without re-running the diff.</p>
                <ui5-button id="compare-restore-split-btn" design="Emphasized">Restore split view</ui5-button>
            </div>
        `);
    }

    mount.innerHTML = parts.join('');

    document.getElementById('compare-restore-split-btn')?.addEventListener('click', async () => {
        if (!compareState.baseId || !compareState.targetId) return;
        const btn = document.getElementById('compare-restore-split-btn') as HTMLElement | null;
        if (btn) (btn as any).disabled = true;
        const { restoreSplitCompareFromPair } = await import('../split-compare');
        const r = await restoreSplitCompareFromPair(compareState.baseId, compareState.targetId);
        if (r.ok) {
            compareState.splitArmError = null;
            renderCompareAlerts();
        } else {
            compareState.splitArmError = r.error;
            renderCompareAlerts();
        }
        if (btn) (btn as any).disabled = false;
        refreshWorkspace();
    });
}

export function renderCompleteWorkspace() {
    const overviewMount = document.getElementById('compare-overview-mount');
    if (compareState.result && compareState.result.error && overviewMount) {
        document.getElementById('compare-alerts-mount')!.innerHTML = '';
        overviewMount.innerHTML = `
            <div style="background:rgba(217,48,37,0.05); border-left: 4px solid var(--compare-removed); padding:1rem; border-radius:4px; margin-bottom: 2rem;">
                <h3 style="color:var(--compare-removed); margin-top:0;">Fetch Failed</h3>
                <p style="color:var(--ui5-text-color);">${escapeHtml(compareState.result.error)}</p>
                <ui5-button id="compare-retry-btn" design="Emphasized" style="margin-top: 0.5rem;">Retry</ui5-button>
            </div>
        `;
        document.getElementById('compare-retry-btn')!.addEventListener('click', () => fetchCompareData());

        const searchMount = document.getElementById('compare-search-mount');
        if (searchMount) searchMount.innerHTML = '';
        const worklistMount = document.getElementById('compare-worklist-mount');
        if (worklistMount) worklistMount.innerHTML = '';
        const heroMount = document.getElementById('compare-entity-hero-mount');
        if (heroMount) heroMount.innerHTML = '';
        const toolbarMount = document.getElementById('compare-action-toolbar-mount');
        if (toolbarMount) toolbarMount.innerHTML = '';
        const detailMount = document.getElementById('compare-detail-mount');
        if (detailMount) detailMount.innerHTML = '';
        return;
    }

    renderCompareAlerts();
    renderProjectPickers();
    renderOverviewPanel();
    renderSearchBar();
    renderEntityPanel();
}
