import { appState as S, patchAppState } from './store';
import { clearGraphFocus } from './node-selection';
import { setActiveWorkspace } from './workspace';

/** Jump from Overview dashboard cards to Graph with module (and optional sub-module) scope. */
export function goToModuleFromDashboard(moduleFamily: string, subModule?: string): void {
    S.currentModule = moduleFamily;
    S.currentSubModule = subModule ?? 'ALL';
    S.currentSelection = null;
    clearGraphFocus();
    S.currentWorkflowCode = null;
    S.focusRequestId = null;
    patchAppState({});
    document.getElementById('module-bar')?.classList.remove('hidden');
    const t = document.getElementById('modules-toggle');
    if (t) (t as HTMLElement & { design?: string }).design = 'Emphasized';
    setActiveWorkspace('graph');
}
