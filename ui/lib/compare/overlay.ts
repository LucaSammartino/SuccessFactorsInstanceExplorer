import { compareState } from './index';
import { appState as S } from '../store';
import { escapeHtml } from '../utils';
import { setActiveWorkspace } from '../workspace';

/**
 * Activates the compare overlay around a specific entity. The destination views
 * (drilldown, inspector, matrix, explore) read `S.compareOverlay` to render diff-aware
 * highlights. `focusNodeId` is the actual graph node to focus (for FIELD rows this
 * is the parent object id).
 */
export function activateCompareOverlay(focusNodeId: string, sourceRowId: string) {
    if (!compareState.baseId || !compareState.targetId) return;
    S.compareOverlay = {
        baseId: compareState.baseId,
        targetId: compareState.targetId,
        focusNodeId,
        sourceRowId,
    };
}

export function deactivateCompareOverlay() {
    S.compareOverlay = null;
}

export function isCompareOverlayActive(): boolean {
    return Boolean(S.compareOverlay);
}

/**
 * Persistent compare bar — shown across destination views while a compare overlay is
 * active. Lets the consultant return to the Compare workspace search at any point or
 * end the overlay without ending the split-compare session.
 */
export function renderCompareOverlayBar() {
    if (typeof document === 'undefined') return;
    const mount = document.getElementById('compare-overlay-bar-mount');
    if (!mount) return;

    const ov = S.compareOverlay;
    if (!ov || S.activeWorkspace === 'compare') {
        mount.innerHTML = '';
        return;
    }

    const baseName = compareState.result?.baseProject?.name || ov.baseId;
    const targetName = compareState.result?.targetProject?.name || ov.targetId;
    const focusLabel = S.nodeById.get(ov.focusNodeId)?.label || ov.focusNodeId;

    mount.innerHTML = `
        <div class="compare-overlay-strip">
            <span class="compare-overlay-label">Compare overlay</span>
            <span><strong>${escapeHtml(baseName)}</strong> vs <strong>${escapeHtml(targetName)}</strong></span>
            <span class="compare-muted">·</span>
            <span>focus: <code>${escapeHtml(focusLabel)}</code></span>
            <span class="compare-overview-spacer"></span>
            <ui5-button id="compare-overlay-back-btn" design="Transparent">Back to Compare results</ui5-button>
            <ui5-button id="compare-overlay-end-btn" design="Transparent">End overlay</ui5-button>
        </div>
    `;

    document.getElementById('compare-overlay-back-btn')?.addEventListener('click', () => {
        setActiveWorkspace('compare');
    });
    document.getElementById('compare-overlay-end-btn')?.addEventListener('click', () => {
        deactivateCompareOverlay();
        renderCompareOverlayBar();
    });
}
