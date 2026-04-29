import { compareState } from './index';
import { escapeHtml } from '../utils';
import {
    buildEntityIndex,
    diffStatusColorVar,
    diffStatusSymbol,
    entityKindLabel,
    type EntityRow,
} from './entity-index';
import { setSelectedEntityRow } from './entity-panel';
import { renderEntityPanel } from './entity-panel';
import { renderSearchBar } from './search-bar';

let collapsed = true;
const HOT_SPOT_LIMIT = 10;

function buildHotSpots(): EntityRow[] {
    const rows = buildEntityIndex(compareState.result || null);
    // Score: prefer entities with high affectsCount, then those with rich change summaries.
    return rows
        .slice()
        .sort((a, b) => {
            const ac = a.affectsCount ?? 0;
            const bc = b.affectsCount ?? 0;
            if (bc !== ac) return bc - ac;
            const al = (a.changeSummary || '').length;
            const bl = (b.changeSummary || '').length;
            return bl - al;
        })
        .filter(r => r.kind !== 'FIELD') // hot spots are entity-level
        .slice(0, HOT_SPOT_LIMIT);
}

type CounterTone = 'added' | 'removed' | 'changed' | 'neutral';

function counterCard(label: string, value: string, tone: CounterTone = 'neutral'): string {
    const toneClass = tone === 'neutral' ? '' : ` is-${tone}`;
    return `
        <div class="compare-counter-card">
            <div class="compare-counter-value${toneClass}">${value}</div>
            <div class="compare-counter-label">${escapeHtml(label)}</div>
        </div>
    `;
}

export function renderOverviewPanel() {
    const mount = document.getElementById('compare-overview-mount');
    if (!mount) return;

    if (!compareState.result || compareState.result.error) {
        mount.innerHTML = '';
        return;
    }
    if (compareState.result.isEmpty) {
        mount.innerHTML = `<div class="compare-empty-card"><h3>No differences</h3><p>The selected instances are identical.</p></div>`;
        return;
    }

    const { totals, baseProject, targetProject } = compareState.result;
    const permCellChanges =
        totals.objectVerbs.added +
        totals.objectVerbs.removed +
        totals.fieldPerms.added +
        totals.fieldPerms.removed +
        totals.fieldOverrides.added +
        totals.fieldOverrides.removed +
        totals.fieldOverrides.changed +
        totals.systemPerms.added +
        totals.systemPerms.removed;

    const baseGen = baseProject.generatedAt ? new Date(baseProject.generatedAt).getTime() : null;
    const targetGen = targetProject.generatedAt
        ? new Date(targetProject.generatedAt).getTime()
        : null;
    let skewWarning = '';
    if (baseGen && targetGen) {
        const diffDays = Math.abs((targetGen - baseGen) / (1000 * 60 * 60 * 24));
        if (diffDays > 30) {
            skewWarning = `
                <div style="background-color: var(--ui5-message-warning-background); color: var(--ui5-message-warning-text-color); padding: 0.5rem 0.75rem; margin: 0.75rem 0 0 0; border-radius: 4px; border-left: 4px solid var(--ui5-message-warning-border-color); font-size: 0.85rem;">
                    <strong>Data Skew:</strong> Base was ingested ${Math.round(diffDays)} days before Target — diff may include engine drift.
                </div>
            `;
        }
    }

    const hot = buildHotSpots();
    const hotRows = hot
        .map(r => {
            const color = `var(${diffStatusColorVar(r.diffStatus)})`;
            const symbol = diffStatusSymbol(r.diffStatus);
            return `
                <div class="overview-hot-row compare-entity-row--${r.diffStatus}" data-row-id="${escapeHtml(r.id)}" tabindex="0" role="button">
                    <span style="width: 14px; text-align:center; font-weight: bold; color: ${color};">${symbol}</span>
                    <span class="compare-row-chip">${escapeHtml(entityKindLabel(r.kind))}</span>
                    <span class="overview-hot-title">${escapeHtml(r.label)}</span>
                    <span class="compare-row-summary">affects ${r.affectsCount ?? 0}</span>
                </div>
            `;
        })
        .join('');

    const summaryLine = `Base: <strong>${escapeHtml(baseProject.name || baseProject.id)}</strong>${baseProject.generatedAt ? ` <span style="color: var(--ui5-text-color-secondary)">(${escapeHtml(baseProject.generatedAt)})</span>` : ''} · Target: <strong>${escapeHtml(targetProject.name || targetProject.id)}</strong>${targetProject.generatedAt ? ` <span style="color: var(--ui5-text-color-secondary)">(${escapeHtml(targetProject.generatedAt)})</span>` : ''}`;

    mount.innerHTML = `
        <div class="compare-overview">
            <button id="compare-overview-toggle" class="compare-overview-toggle" type="button">
                <span class="compare-overview-caret ${collapsed ? '' : 'is-open'}">▶</span>
                <strong>Overview</strong>
                <span class="compare-overview-summary">${totals.totalChanges} total changes · ${totals.nodes.added}+ / ${totals.nodes.removed}- nodes · ${permCellChanges} perm cells</span>
                <span class="compare-overview-spacer"></span>
                <a class="compare-export-link" href="/api/projects/${encodeURIComponent(compareState.baseId || '')}/compare/${encodeURIComponent(compareState.targetId || '')}/report.md" download="compare.md" onclick="event.stopPropagation();">Markdown</a>
                <a class="compare-export-link" href="/api/projects/${encodeURIComponent(compareState.baseId || '')}/compare/${encodeURIComponent(compareState.targetId || '')}/report.csv" download="compare.csv" onclick="event.stopPropagation();">CSV</a>
            </button>
            <div id="compare-overview-body" class="compare-overview-body ${collapsed ? 'is-collapsed' : ''}">
                <div class="compare-overview-line">${summaryLine}</div>
                <div class="compare-counter-grid">
                    ${counterCard('Total Changes', String(totals.totalChanges))}
                    ${counterCard('Nodes Added', `+${totals.nodes.added}`, 'added')}
                    ${counterCard('Nodes Removed', `−${totals.nodes.removed}`, 'removed')}
                    ${counterCard('Nodes Changed', `~${totals.nodes.changed}`, 'changed')}
                    ${counterCard('Perm Cell Changes', String(permCellChanges))}
                </div>
                <h4 class="compare-overview-subtitle">Hot spots <span>(top ${HOT_SPOT_LIMIT} by impact)</span></h4>
                <div class="compare-hot-list">
                    ${hotRows || '<div class="compare-empty-inline">No hot spots. Every change is local.</div>'}
                </div>
                ${skewWarning}
            </div>
        </div>
    `;

    document.getElementById('compare-overview-toggle')?.addEventListener('click', () => {
        collapsed = !collapsed;
        renderOverviewPanel();
    });

    mount.querySelectorAll('.overview-hot-row').forEach(el => {
        el.addEventListener('click', () => {
            const rid = (el as HTMLElement).getAttribute('data-row-id');
            if (!rid) return;
            const row = hot.find(r => r.id === rid) || null;
            if (!row) return;
            setSelectedEntityRow(row);
            renderEntityPanel();
            renderSearchBar();
            // Scroll selected row into view via the search bar.
            document
                .querySelector(`.compare-entity-row[data-row-id="${CSS.escape(rid)}"]`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    });
}
