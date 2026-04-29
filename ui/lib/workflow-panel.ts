import type { WorkflowEntry } from './types';
import { appState as S, patchAppState } from './store';
import { refreshWorkspace } from './workspace';
import { isSplitCompareLayoutVisible } from './split-compare';
import { escapeHtml, escapeAttribute, buildWorkflowListFlags, formatWorkflowRoleHint, formatWorkflowBaseObjectsLine, buildWorkflowActionSkipLine, setText } from './utils';
import { WORKFLOW_SIDEBAR_LIMIT } from './constants';

function renderWorkflowListPane(
    containerId: string,
    entries: WorkflowEntry[],
    queryRaw: string,
    pane: 'left' | 'right'
) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const q = queryRaw.trim().toLowerCase();
    const matchesQuery = (entry: WorkflowEntry) => {
        if (!q) return true;
        const haystack = [
            entry.code,
            entry.name,
            ...(entry.baseObjectTypes || []),
            ...(entry.approverTypes || []),
            ...(entry.approverRoles || []),
            ...(entry.actionTypes || []),
            ...(entry.skipTypes || []),
        ]
            .join(' | ')
            .toLowerCase();
        return haystack.includes(q);
    };
    const matching = entries.filter(matchesQuery);
    const filtered = matching.slice(0, WORKFLOW_SIDEBAR_LIMIT);
    if (filtered.length === 0) {
        container.innerHTML =
            '<div class="empty-mini">No workflow definitions match the current search.</div>';
        return;
    }
    const activeCode = pane === 'left' ? S.currentWorkflowCode : S.currentWorkflowCodeRight;
    const listHtml = filtered
        .map(workflow => {
            const isActive = activeCode === workflow.code;
            const approverLine = workflow.approverTypes?.length
                ? workflow.approverTypes.join(', ')
                : 'No approver type captured';
            const roleHint = formatWorkflowRoleHint(workflow);
            const metaSecondary = [approverLine, roleHint].filter(Boolean).join(' · ');
            const baseLine = formatWorkflowBaseObjectsLine(workflow);
            const actionSkipLine = buildWorkflowActionSkipLine(workflow);
            return `<div class="workflow-item${isActive ? ' active' : ''}" data-workflow-code="${escapeAttribute(workflow.code)}" role="button" tabindex="0" aria-current="${isActive ? 'true' : 'false'}"><div class="workflow-item-head"><span class="workflow-code-chip">${escapeHtml(workflow.code)}</span><span class="workflow-step-pill">${workflow.stepCount} step${workflow.stepCount === 1 ? '' : 's'}</span>${workflow.rowCount > 1 ? `<span class="workflow-row-pill">${workflow.rowCount.toLocaleString()} CSV rows</span>` : ''}</div><div class="workflow-item-title">${escapeHtml(workflow.name || workflow.code)}</div><div class="workflow-item-meta">${escapeHtml(metaSecondary)}</div>${baseLine ? `<div class="workflow-item-secondary">${escapeHtml(baseLine)}</div>` : ''}${actionSkipLine ? `<div class="workflow-item-secondary muted">${escapeHtml(actionSkipLine)}</div>` : ''}<div class="workflow-item-flags">${buildWorkflowListFlags(workflow).map(flag => `<span class="workflow-flag">${escapeHtml(flag)}</span>`).join('')}</div></div>`;
        })
        .join('');
    const footer =
        matching.length > filtered.length
            ? `<div class="workflow-list-footer">Showing ${filtered.length} of ${matching.length} matching definitions. Refine search to see more.</div>`
            : '';
    container.innerHTML = listHtml + footer;
    container.querySelectorAll('[data-workflow-code]').forEach(item => {
        const el = item as HTMLElement;
        const activate = () => {
            const code = el.getAttribute('data-workflow-code');
            if (!code) return;
            if (pane === 'left') {
                patchAppState({
                    currentWorkflowCode: code,
                    currentSelection: null,
                });
            } else {
                patchAppState({
                    currentWorkflowCodeRight: code,
                    currentSelection: null,
                });
            }
            refreshWorkspace();
        };
        el.addEventListener('click', () => {
            activate();
            el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
        el.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                activate();
                el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        });
    });
}

export function closeWorkflowDetailPane(pane: 'left' | 'right') {
    patchAppState(pane === 'left' ? { currentWorkflowCode: null } : { currentWorkflowCodeRight: null });
    const side = pane === 'left' ? 'left' : 'right';
    const wrap = document.getElementById(`workflow-detail-inline-${side}`);
    const body = document.getElementById(`workflow-detail-inline-body-${side}`);
    const workspace = wrap?.closest<HTMLElement>('.workflow-workspace');
    const list = workspace?.querySelector<HTMLElement>('.workflow-list');
    wrap?.classList.add('hidden');
    workspace?.classList.remove('workflow-workspace--detail-open');
    list?.removeAttribute('hidden');
    if (body) body.innerHTML = '';
    refreshWorkspace();
}

export function bindWorkflowDetailCloseButtons() {
    document.getElementById('workflow-detail-close-left')?.addEventListener('click', () => {
        closeWorkflowDetailPane('left');
    });
    document.getElementById('workflow-detail-close-right')?.addEventListener('click', () => {
        closeWorkflowDetailPane('right');
    });
}

/** Populate target-pane workflow stats from `compareTargetPrepared.dashboard` when split. */
export function refreshWorkflowTargetMetrics() {
    const prep = S.compareTargetPrepared;
    if (!S.splitCompareMode || !prep) {
        setText('stat-workflows-right', '—');
        setText('stat-workflow-avg-right', '—');
        setText('stat-workflow-dynamic-right', '—');
        const hint = document.getElementById('workflow-reuse-hint-right');
        if (hint) {
            hint.textContent = '';
            hint.classList.add('hidden');
        }
        return;
    }
    const data = prep.dashboard;
    const workflowStats = data.workflow?.stats || {};
    setText('stat-workflows-right', data.workflow?.summary?.workflowCount ?? 0);
    setText('stat-workflow-avg-right', workflowStats.averageStepCount ?? 0);
    setText('stat-workflow-dynamic-right', workflowStats.workflowsWithDynamicAssignment ?? 0);

    const reuseHint = document.getElementById('workflow-reuse-hint-right');
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
}

export function renderWorkflowList() {
    renderWorkflowListPane('workflow-list', S.workflowEntries, S.currentWorkflowQuery, 'left');

    const right = document.getElementById('workflow-list-right');
    if (!right) return;

    if (isSplitCompareLayoutVisible() && S.compareTargetPrepared) {
        renderWorkflowListPane(
            'workflow-list-right',
            S.compareTargetPrepared.workflowEntries,
            S.currentWorkflowQueryRight,
            'right'
        );
        refreshWorkflowTargetMetrics();
    } else {
        right.innerHTML =
            S.splitCompareMode && S.compareTargetPrepared && S.splitCompareLayoutHidden
                ? '<div class="empty-mini">Target pane is hidden. Choose <strong>Show target pane</strong> in the compare strip.</div>'
                : '<div class="empty-mini">Use the Compare tab to load two projects side by side.</div>';
        refreshWorkflowTargetMetrics();
    }
}
