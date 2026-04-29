import { compareState } from './index';
import { escapeHtml } from '../utils';
import {
    diffStatusColorVar,
    diffStatusLabel,
    diffStatusSymbol,
    entityKindLabel,
    type EntityRow,
} from './entity-index';
import { renderDetailPanel } from './detail-panel';
import { renderActionToolbar } from './action-toolbar';

let selectedEntityRow: EntityRow | null = null;

export function getSelectedEntityRow(): EntityRow | null {
    return selectedEntityRow;
}

export function getSelectedEntityRowId(): string | null {
    return selectedEntityRow?.id ?? null;
}

export function setSelectedEntityRow(row: EntityRow | null) {
    selectedEntityRow = row;
}

function renderHero(row: EntityRow): string {
    const symbol = diffStatusSymbol(row.diffStatus);
    const moduleChip = row.moduleFamily
        ? `<span class="compare-row-chip compare-row-chip--module">${escapeHtml(row.moduleFamily)}</span>`
        : '';
    const parentLine = row.parentLabel
        ? `<div class="compare-entity-subtitle">on <strong>${escapeHtml(row.parentLabel)}</strong></div>`
        : '';
    const summary = row.changeSummary
        ? `<div class="compare-entity-summary">${escapeHtml(row.changeSummary)}</div>`
        : '';

    return `
        <div class="compare-entity-hero">
            <div class="compare-entity-hero-main">
                <div class="compare-entity-status" data-status="${row.diffStatus}">${symbol}</div>
                <div class="compare-entity-title-block">
                    <div class="compare-entity-title-row">
                        <h3>${escapeHtml(row.label)}</h3>
                        <span class="compare-row-chip">${escapeHtml(entityKindLabel(row.kind))}</span>
                        ${moduleChip}
                        <span class="compare-status-badge compare-status-badge--${row.diffStatus}">${symbol} ${escapeHtml(diffStatusLabel(row.diffStatus))}</span>
                    </div>
                    ${parentLine}
                    ${summary}
                    <div class="compare-entity-id">${escapeHtml(row.id)}</div>
                </div>
            </div>
            <ui5-button id="compare-entity-close-btn" design="Transparent">Close</ui5-button>
        </div>
    `;
}

function fieldMatches(field: any, fieldName: string): boolean {
    return String(field?.name ?? '').toLowerCase() === fieldName.toLowerCase()
        || String(field?.id ?? '').toLowerCase() === fieldName.toLowerCase()
        || String(field?.label ?? '').toLowerCase() === fieldName.toLowerCase();
}

function findFieldDefinition(attrs: any, fieldName: string): unknown {
    if (!attrs) return undefined;
    if (Array.isArray(attrs)) return attrs.find(field => fieldMatches(field, fieldName));
    if (typeof attrs === 'object') return attrs[fieldName];
    return undefined;
}

function renderFieldBody(row: EntityRow) {
    const mount = document.getElementById('compare-detail-mount');
    if (!mount) return;
    if (row.source.kind !== 'field') return;

    mount.style.display = 'block';

    const { parentObjectId, fieldName, fieldStatus } = row.source;

    mount.innerHTML = `<div class="compare-detail-loading">Loading field details...</div>`;

    fetch(`/api/projects/${compareState.baseId}/compare/${compareState.targetId}/nodes/${encodeURIComponent(parentObjectId)}`)
        .then(async res => {
            if (!res.ok) throw new Error(await res.text());
            return res.json();
        })
        .then(detail => {
            const baseField = findFieldDefinition(detail?.base?.attributes, fieldName);
            const targetField = findFieldDefinition(detail?.target?.attributes, fieldName);

            const dump = (val: unknown) => {
                if (val === undefined)
                    return `<span class="compare-muted">Not present</span>`;
                if (val === null) return `<code>null</code>`;
                if (typeof val !== 'object') return escapeHtml(String(val));
                return `<pre class="compare-technical-json">${escapeHtml(JSON.stringify(val, null, 2))}</pre>`;
            };

            mount.innerHTML = `
                <div class="compare-detail-card">
                    <section class="compare-detail-section-card">
                        <div class="compare-detail-section-head">
                            <div>
                                <h3>Field ${escapeHtml(fieldName)}</h3>
                                <p>on ${escapeHtml(row.parentLabel || parentObjectId)}</p>
                            </div>
                            <span class="detail-badge compare-field-status-${escapeHtml(fieldStatus)}">${escapeHtml(fieldStatus)}</span>
                        </div>
                        <div class="compare-field-definition-grid compare-diff-row--${escapeHtml(fieldStatus)}">
                            <div>
                                <div class="compare-field-definition-title">Base</div>
                                ${dump(baseField)}
                            </div>
                            <div>
                                <div class="compare-field-definition-title">Target</div>
                                ${dump(targetField)}
                            </div>
                        </div>
                    </section>
                </div>
            `;
        })
        .catch(e => {
            mount.innerHTML = `<div class="compare-detail-error">Failed to load field details: ${escapeHtml(String(e))}</div>`;
        });
}

export function renderEntityPanel() {
    const heroMount = document.getElementById('compare-entity-hero-mount');
    const detailMount = document.getElementById('compare-detail-mount');
    const panel = document.getElementById('compare-entity-panel') as HTMLElement | null;
    const toolbarMount = document.getElementById('compare-action-toolbar-mount');

    if (!heroMount || !detailMount) return;

    if (!selectedEntityRow) {
        heroMount.innerHTML = `
            <div class="compare-entity-panel-empty">
                <div class="compare-empty-illustration" aria-hidden="true">⊟</div>
                <h3>Select an entity</h3>
                <p>Pick a row from the worklist to see attribute, field, and permission diffs.</p>
            </div>
        `;
        if (toolbarMount) toolbarMount.innerHTML = '';
        detailMount.innerHTML = '';
        detailMount.style.display = 'none';
        if (panel) panel.classList.remove('has-detail');
        return;
    }

    if (panel) panel.classList.add('has-detail');

    heroMount.innerHTML = renderHero(selectedEntityRow);
    document.getElementById('compare-entity-close-btn')?.addEventListener('click', () => {
        setSelectedEntityRow(null);
        renderEntityPanel();
        // Re-render search bar so the active row is unhighlighted.
        import('./search-bar').then(m => m.renderSearchBar());
    });
    renderActionToolbar(selectedEntityRow);

    const row = selectedEntityRow;

    if (row.kind === 'FIELD') {
        renderFieldBody(row);
        return;
    }

    if (row.kind === 'RBP_ROLE') {
        const roleContext =
            row.source.kind === 'role-delta-only'
                ? row.source.delta
                : row.source.kind === 'node-changed' && row.source.roleDelta
                  ? row.source.roleDelta
                  : compareState.result?.rolePermissionDeltas?.[row.id] || null;
        renderDetailPanel(row.id, roleContext);
        return;
    }

    renderDetailPanel(row.id, null);
}
