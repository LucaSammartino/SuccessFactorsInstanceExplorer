import { computeBlastRadius, applyBlastRadiusFade, clearBlastRadiusFade } from './interactions/blast-radius';
import { appState as S } from './store';

/** Blast radius toggle for graph highlighting. */
export function applyBlastRadiusWithImpactHint(nodeId: string, refreshGraphStatus?: () => void) {
    const result = computeBlastRadius(nodeId, S.blastRadiusHops);
    S.blastRadiusActive = true;
    S.blastRadiusSourceId = nodeId;
    S.blastRadiusNodeIds = result.nodeIds;
    applyBlastRadiusFade(result.nodeIds);

    const btn = document.getElementById('toggle-blast-radius');
    btn?.classList.add('is-active');
    if (btn) btn.textContent = 'Clear Blast Radius';
    refreshGraphStatus?.();
}

export function clearBlastRadiusUi(refreshGraphStatus?: () => void) {
    if (!S.blastRadiusActive) return;
    S.blastRadiusActive = false;
    S.blastRadiusSourceId = null;
    S.blastRadiusNodeIds = new Set();
    clearBlastRadiusFade();
    const btn = document.getElementById('toggle-blast-radius');
    btn?.classList.remove('is-active');
    if (btn) btn.textContent = 'Blast Radius';
    refreshGraphStatus?.();
}
