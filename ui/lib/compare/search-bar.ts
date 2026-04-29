import { compareState } from './index';
import { escapeAttribute, escapeHtml } from '../utils';
import {
    ALL_DIFF_STATUSES,
    ALL_ENTITY_KINDS,
    buildEntityIndex,
    diffStatusColorVar,
    diffStatusLabel,
    diffStatusSymbol,
    entityKindLabel,
    filterEntityRows,
    makeDefaultEntityFilter,
    type EntityFilterState,
    type EntityKind,
    type EntityRow,
    type DiffStatus,
} from './entity-index';
import { renderEntityPanel, setSelectedEntityRow, getSelectedEntityRowId } from './entity-panel';

export const searchFilters: EntityFilterState = makeDefaultEntityFilter();

let cachedRows: EntityRow[] | null = null;
let cachedRowsKey: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const MAX_RESULTS = 250;

function rowsCacheKey(): string {
    return `${compareState.baseId ?? ''}\0${compareState.targetId ?? ''}`;
}

function getRows(): EntityRow[] {
    const key = rowsCacheKey();
    if (cachedRows && cachedRowsKey === key) return cachedRows;
    cachedRows = buildEntityIndex(compareState.result || null);
    cachedRowsKey = key;
    return cachedRows;
}

export function invalidateEntityIndex() {
    cachedRows = null;
    cachedRowsKey = null;
}

function kindChip(kind: EntityKind, on: boolean): string {
    return `<ui5-button class="compare-chip ${on ? 'is-on' : ''}" data-kind="${kind}" design="${on ? 'Emphasized' : 'Transparent'}">${escapeHtml(entityKindLabel(kind))}</ui5-button>`;
}

function statusChip(s: DiffStatus, on: boolean): string {
    return `<ui5-button class="compare-chip compare-status-chip compare-status-chip--${s} ${on ? 'is-on' : ''}" data-status="${s}" design="${on ? 'Emphasized' : 'Transparent'}">${diffStatusSymbol(s)} ${escapeHtml(diffStatusLabel(s))}</ui5-button>`;
}

function rowHtml(r: EntityRow): string {
    const isActive = getSelectedEntityRowId() === r.id;
    const symbol = diffStatusSymbol(r.diffStatus);
    const moduleChip = r.moduleFamily
        ? `<span class="compare-row-chip compare-row-chip--module">${escapeHtml(r.moduleFamily)}</span>`
        : '';
    const kindChipHtml = `<span class="compare-row-chip">${escapeHtml(entityKindLabel(r.kind))}</span>`;
    const parentLine = r.parentLabel
        ? `<div class="compare-row-parent">on ${escapeHtml(r.parentLabel)}</div>`
        : '';
    const summary = r.changeSummary
        ? `<div class="compare-row-summary">${escapeHtml(r.changeSummary)}</div>`
        : '';

    return `
        <div class="compare-entity-row compare-entity-row--${r.diffStatus} ${isActive ? 'is-active' : ''}" data-row-id="${escapeAttribute(r.id)}" tabindex="0" role="button">
            <div class="compare-row-status">${symbol}</div>
            <div class="compare-row-main">
                <div class="compare-row-title-line">
                    ${kindChipHtml}
                    <div class="compare-row-title">${escapeHtml(r.label)}</div>
                    ${moduleChip}
                </div>
                ${parentLine}
            </div>
            <div class="compare-row-trailing">${summary}</div>
        </div>
    `;
}

function renderResults() {
    const container = document.getElementById('compare-worklist-mount');
    if (!container) return;
    const rows = filterEntityRows(getRows(), searchFilters);
    const total = rows.length;

    if (!compareState.result) {
        container.innerHTML = '';
        return;
    }
    if (compareState.result.error) {
        container.innerHTML = '';
        return;
    }
    if (compareState.result.isEmpty) {
        container.innerHTML = `<div class="compare-empty-card"><h3>No differences between these projects</h3><p>The selected instances are identical.</p></div>`;
        return;
    }
    if (total === 0) {
        container.innerHTML = `<div class="compare-empty-card">No entities match your search.</div>`;
        return;
    }

    const truncated = rows.length > MAX_RESULTS;
    const shown = truncated ? rows.slice(0, MAX_RESULTS) : rows;

    container.innerHTML = `
        <div class="compare-worklist" role="listbox" aria-label="Changed entities">
            ${shown.map(rowHtml).join('')}
            ${truncated ? `<div class="compare-result-footer">Showing first ${MAX_RESULTS} of ${total} matches. Refine your search.</div>` : ''}
        </div>
    `;

    container.querySelectorAll('.compare-entity-row').forEach(el => {
        el.addEventListener('click', () => {
            const rid = (el as HTMLElement).getAttribute('data-row-id');
            if (!rid) return;
            const row = rows.find(r => r.id === rid) || null;
            setSelectedEntityRow(row);
            renderResults();
            renderEntityPanel();
        });
        el.addEventListener('keydown', (ev: Event) => {
            const e = ev as KeyboardEvent;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                (el as HTMLElement).click();
            }
        });
    });
}

export function renderSearchBar() {
    const mount = document.getElementById('compare-search-mount');
    const worklistMount = document.getElementById('compare-worklist-mount');
    if (!mount) return;

    if (!compareState.result || compareState.result.error || compareState.result.isEmpty) {
        mount.innerHTML = '';
        if (worklistMount) worklistMount.innerHTML = '';
        return;
    }

    const kindChips = ALL_ENTITY_KINDS.map(k => kindChip(k, searchFilters.kinds.has(k))).join('');
    const statusChips = ALL_DIFF_STATUSES.map(s => statusChip(s, searchFilters.statuses.has(s))).join('');

    mount.innerHTML = `
        <div class="compare-search-shell">
            <div class="compare-search-input-row">
                <ui5-input id="compare-entity-search-input" value="${escapeAttribute(searchFilters.query)}" placeholder="Search role, object, field, rule, workflow..." type="Search"></ui5-input>
            </div>
            <div class="compare-filter-row">
                <span class="compare-filter-label">Kind</span>
                ${kindChips}
                <span class="compare-filter-divider"></span>
                <span class="compare-filter-label">Status</span>
                ${statusChips}
            </div>
        </div>
    `;

    const input = mount.querySelector('#compare-entity-search-input') as HTMLInputElement | null;

    if (input) {
        input.addEventListener('input', () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                searchFilters.query = String((input as HTMLInputElement & { value?: string }).value ?? '');
                renderResults();
            }, 120);
        });
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape' && input.value) {
                input.value = '';
                searchFilters.query = '';
                renderResults();
            }
        });
    }

    mount.querySelectorAll('.compare-chip[data-kind]').forEach(el => {
        el.addEventListener('click', () => {
            const k = (el as HTMLElement).getAttribute('data-kind') as EntityKind;
            if (searchFilters.kinds.has(k)) searchFilters.kinds.delete(k);
            else searchFilters.kinds.add(k);
            renderSearchBar();
        });
    });
    mount.querySelectorAll('.compare-chip[data-status]').forEach(el => {
        el.addEventListener('click', () => {
            const s = (el as HTMLElement).getAttribute('data-status') as DiffStatus;
            if (searchFilters.statuses.has(s)) searchFilters.statuses.delete(s);
            else searchFilters.statuses.add(s);
            renderSearchBar();
        });
    });

    renderResults();
}
