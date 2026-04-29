import { appState as S, patchAppState } from './store';
import type { AnyDashboard } from './types';
import { setText } from './utils';
import { buildPreparedInstanceModel, type PreparedInstanceModel } from './prepared-instance';
import { renderWorkflowList } from './workflow-panel';

/** Apply a prepared snapshot to the live app store (primary / left pane). */
export function applyPreparedModelToAppState(model: PreparedInstanceModel) {
    patchAppState({
        dashboard: model.dashboard,
        allNodes: model.allNodes,
        allEdges: model.allEdges,
        nodeById: model.nodeById,
        edgesByNode: model.edgesByNode,
        roleObjectPermissions: model.roleObjectPermissions,
        roleSystemPermissions: model.roleSystemPermissions,
        roleObjectByRole: model.roleObjectByRole,
        roleObjectByObject: model.roleObjectByObject,
        roleSystemByRole: model.roleSystemByRole,
        workflowEntries: model.workflowEntries,
        workflowByCode: model.workflowByCode,
        searchEntries: model.searchEntries,
    });
}

/** Snapshot primary (left) graph/search state for a temporary model swap. */
export function snapshotPrimaryPreparedModel(): PreparedInstanceModel {
    return {
        dashboard: S.dashboard!,
        allNodes: S.allNodes,
        allEdges: S.allEdges,
        nodeById: S.nodeById,
        edgesByNode: S.edgesByNode,
        roleObjectPermissions: S.roleObjectPermissions,
        roleSystemPermissions: S.roleSystemPermissions,
        roleObjectByRole: S.roleObjectByRole,
        roleObjectByObject: S.roleObjectByObject,
        roleSystemByRole: S.roleSystemByRole,
        workflowEntries: S.workflowEntries,
        workflowByCode: S.workflowByCode,
        searchEntries: S.searchEntries,
    };
}

export function prepareData(data: AnyDashboard) {
    const model = buildPreparedInstanceModel(data);
    applyPreparedModelToAppState(model);
    queueMicrotask(() => {
        import('./matrix').then(m => m.warmPermMatrixCacheIfIdle());
    });
}

/** Workflow workspace metrics use DOM ids; overview analytics are rendered by React (`dashboard/`). */
export function populateAnalytics(data: AnyDashboard) {
    const workflowStats = data.workflow?.stats || {};
    setText('stat-workflows', data.workflow?.summary?.workflowCount || 0);
    setText('stat-workflow-avg', workflowStats.averageStepCount || 0);
    setText('stat-workflow-dynamic', workflowStats.workflowsWithDynamicAssignment || 0);

    const reuseHint = document.getElementById('workflow-reuse-hint');
    if (reuseHint) {
        const pb = data.projectBundle as
            | { workflowDataSource?: string; workflowFileBasename?: string | null }
            | undefined;
        if (pb?.workflowDataSource === 'reused-saved') {
            reuseHint.textContent =
                `These workflow rows come from the last file saved in this project (${pb.workflowFileBasename || 'workflow export'}), not from a new file in your most recent Import. Upload the correct WFInfo for this tenant and run Process again to replace them.`;
            reuseHint.classList.remove('hidden');
        } else {
            reuseHint.textContent = '';
            reuseHint.classList.add('hidden');
        }
    }

    renderWorkflowList();
}
