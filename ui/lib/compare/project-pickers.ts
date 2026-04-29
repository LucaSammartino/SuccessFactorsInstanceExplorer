import { appState as S } from '../store';
import { compareState, fetchCompareData } from './index';
import { escapeHtml } from '../utils';

function projectById(id: string | null): { id: string; name?: string; generatedAt?: string } | null {
    if (!id) return null;
    const p = S.allProjects.find(p => p.id === id);
    if (!p) return null;
    const result = compareState.result;
    let generatedAt: string | undefined;
    if (result && !result.error) {
        if (result.baseProject?.id === id) generatedAt = result.baseProject.generatedAt;
        else if (result.targetProject?.id === id) generatedAt = result.targetProject.generatedAt;
    }
    if (!generatedAt && p.lastProcessed) generatedAt = p.lastProcessed;
    return { id: p.id, name: p.name, generatedAt };
}

function pickerChip(side: 'base' | 'target'): string {
    const id = side === 'base' ? compareState.baseId : compareState.targetId;
    const proj = projectById(id);
    const sideLabel = side === 'base' ? 'Base' : 'Target';
    const name = proj?.name || proj?.id || '— Select project —';
    const dateText = proj?.generatedAt ? proj.generatedAt.slice(0, 10) : '';
    const date = dateText
        ? `<span class="compare-picker-date">${escapeHtml(dateText)}</span>`
        : '';
    return `
        <label class="compare-picker compare-picker--${side}" for="compare-${side}-select">
            <span class="compare-picker-label">${sideLabel}</span>
            <span class="compare-picker-name">${escapeHtml(name)}</span>
            ${date}
            <span class="compare-picker-caret" aria-hidden="true">▾</span>
            <ui5-select id="compare-${side}-select" class="compare-picker-select" aria-label="${sideLabel} instance">${buildOptions()}</ui5-select>
        </label>
    `;
}

function buildOptions(): string {
    let options = '<ui5-option value="">— Select project —</ui5-option>';
    S.allProjects.forEach(p => {
        const safeName = escapeHtml(p.name || p.id);
        options += `<ui5-option value="${escapeHtml(p.id)}">${safeName}</ui5-option>`;
    });
    return options;
}

function statusText(): { dotClass: string; text: string } {
    const result = compareState.result;
    if (!compareState.baseId || !compareState.targetId) {
        return { dotClass: 'is-idle', text: 'Pick base and target to compare' };
    }
    if (!result) return { dotClass: 'is-idle', text: 'Ready to compare' };
    if (result.error) return { dotClass: 'is-error', text: 'Comparison failed' };
    if (result.isEmpty) return { dotClass: 'is-ok', text: 'No differences · ready' };
    const totals = result.totals;
    const totalChanges = totals?.totalChanges ?? 0;
    return { dotClass: 'is-ok', text: `${totalChanges} differences · ready` };
}

export function renderProjectPickers() {
    const mount = document.getElementById('compare-pickers-mount');
    if (!mount) return;

    let warning = '';
    if (S.allProjects.length < 2) {
        warning = `<ui5-message-strip class="compare-message-strip" design="Warning">At least two projects are needed for comparison. Ingest another project in the Dashboard.</ui5-message-strip>`;
    }

    const status = statusText();

    mount.innerHTML = `
        ${warning}
        <div class="compare-strip">
            <div class="compare-strip-pickers">
                ${pickerChip('base')}
                <span class="compare-strip-arrow" aria-hidden="true">→</span>
                ${pickerChip('target')}
            </div>
            <div class="compare-strip-status">
                <span class="compare-status-dot ${status.dotClass}"></span>
                <span>${escapeHtml(status.text)}</span>
            </div>
            <div class="compare-strip-actions">
                <ui5-button id="compare-load-btn" design="Emphasized" class="compare-strip-btn compare-strip-btn--primary">Compare instances</ui5-button>
                <ui5-button id="compare-refresh-btn" design="Default" class="compare-strip-btn" title="Re-run diff and reload split view">Refresh comparison</ui5-button>
            </div>
        </div>
    `;

    const baseSel = document.getElementById('compare-base-select') as any;
    const targetSel = document.getElementById('compare-target-select') as any;

    const setSelection = (sel: any, val: string) => {
        if (!sel) return;
        Array.from(sel.children).forEach((opt: any) => {
            if (opt.value === val) opt.selected = true;
        });
    };

    if (compareState.baseId) setSelection(baseSel, compareState.baseId);
    if (compareState.targetId) setSelection(targetSel, compareState.targetId);

    baseSel?.addEventListener('change', (e: any) => {
        compareState.baseId = e.target.selectedOption?.value || null;
        renderProjectPickers();
    });
    targetSel?.addEventListener('change', (e: any) => {
        compareState.targetId = e.target.selectedOption?.value || null;
        renderProjectPickers();
    });

    const runCompare = () => fetchCompareData();
    document.getElementById('compare-load-btn')?.addEventListener('click', runCompare);
    document.getElementById('compare-refresh-btn')?.addEventListener('click', runCompare);
}
