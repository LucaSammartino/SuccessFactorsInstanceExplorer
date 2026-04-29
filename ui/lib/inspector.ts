import { applyPreparedModelToAppState, snapshotPrimaryPreparedModel } from './data-prepare';
import { appState as S } from './store';
import type { DetailProjectContext, SelectNodeContext } from './types';
import { escapeHtml, escapeAttribute, formatType, formatBoolean, trustedHtml } from './utils';
import { renderRuleLogicSection } from './rules/render';
import { renderInspectorPanelState } from './workspace';
import { isSplitCompareLayoutVisible } from './split-compare';
import { compareState } from './compare';

function resolveDetailProjectLabel(context: DetailProjectContext = {}): string {
    if (context.detailProjectLabel) return context.detailProjectLabel;
    if (context.sourcePane === 'right') return S.compareTargetProjectName || S.compareTargetProjectId || 'Target';
    return S.activeProjectName || S.activeProjectId || 'Base';
}

function renderProjectOriginBadge(context: DetailProjectContext = {}): string {
    return `<span class="detail-badge project-origin">${escapeHtml(resolveDetailProjectLabel(context))}</span>`;
}

function syncDetailPageProject(context: DetailProjectContext = {}) {
    const projectEl = document.getElementById('detail-page-project');
    if (!projectEl) return;
    projectEl.textContent = `Project: ${resolveDetailProjectLabel(context)}`;
    projectEl.removeAttribute('hidden');
}

/** Full node detail body (hero + rail + sections); used by fullscreen detail and split Explore panes. */
export function renderEntityDetailInnerHtml(node: any, context: SelectNodeContext): string {
    const sections = [
        renderCompareOverlayDiffSection(node),
        renderSummarySection(node),
        ...renderTypeSpecificSections(node, context),
    ].filter(Boolean);
    return `
        <div class="detail-shell">
            ${renderDetailHero(node, context)}
            <div class="detail-layout">
                ${renderDetailRail(node, context)}
                <div class="detail-main"><button type="button" class="detail-rail-show" data-action="show-detail-rail">Show context</button>${sections.join('')}</div>
            </div>
        </div>
    `;
}

function getCompareOverlayNodeStatus(nodeId: string): { status: 'added' | 'removed' | 'changed'; changedKeys: string[] } | null {
    if (!S.compareOverlay || !compareState.result || compareState.result.error) return null;
    const result = compareState.result;
    if (result.nodes.added.some((node: any) => node.id === nodeId)) return { status: 'added', changedKeys: [] };
    if (result.nodes.removed.some((node: any) => node.id === nodeId)) return { status: 'removed', changedKeys: [] };
    const changed = result.nodes.changed.find((node: any) => node.id === nodeId);
    if (changed) return { status: 'changed', changedKeys: changed.changedKeys || [] };
    const delta = result.rolePermissionDeltas?.[nodeId];
    const total = (delta?.totals?.added || 0) + (delta?.totals?.removed || 0) + (delta?.totals?.changed || 0);
    if (total > 0) return { status: 'changed', changedKeys: ['rolePermissionDeltas'] };
    return null;
}

function renderCompareOverlayDiffSection(node: any) {
    const diff = getCompareOverlayNodeStatus(String(node.id));
    if (!diff) return '';
    const label = diff.status === 'added'
        ? 'Added in target'
        : diff.status === 'removed'
            ? 'Removed in target'
            : 'Changed in target';
    const keys = diff.changedKeys.length
        ? `<div class="detail-pill-list">${diff.changedKeys.map(key => `<span class="detail-pill compare-detail-key compare-detail-key--${diff.status}">${escapeHtml(key)}</span>`).join('')}</div>`
        : '<p class="empty-mini">This entity exists on only one side of the comparison.</p>';
    return `
        <section class="detail-section compare-detail-section compare-detail-section--${diff.status}">
            <div class="detail-header">
                <span class="detail-badge compare-detail-badge compare-detail-badge--${diff.status}">${escapeHtml(label)}</span>
            </div>
            ${keys}
        </section>
    `;
}

function scrollExploreInlineDetailIntoView(wrap: HTMLElement | null) {
    if (!wrap || wrap.classList.contains('hidden')) return;
    try {
        wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch {
        wrap.scrollIntoView({ block: 'nearest' });
    }
}

function setExploreInlineDetailOpen(wrap: HTMLElement, open: boolean) {
    const stack = wrap.closest<HTMLElement>('.explore-stack');
    const workspace = wrap.closest<HTMLElement>('.explore-workspace');
    const list = stack?.querySelector<HTMLElement>('.explore-list');
    workspace?.classList.toggle('explore-workspace--detail-open', open);
    stack?.classList.toggle('explore-stack--detail-open', open);
    if (open) list?.setAttribute('hidden', '');
    else list?.removeAttribute('hidden');
}

function renderMissingCompareEntityHtml(nodeId: string, projectLabel: string): string {
    return `
        <div class="detail-shell detail-shell--missing">
            <section class="detail-section compare-missing-detail">
                <div class="detail-header">
                    <span class="detail-badge compare-detail-badge compare-detail-badge--removed">Not present</span>
                    <span class="detail-badge project-origin">${escapeHtml(projectLabel)}</span>
                </div>
                <h3>Not present in this instance</h3>
                <p class="empty-mini">This entity is part of the active comparison, but it was not found in this project snapshot.</p>
                <dl class="detail-kv">
                    <dt>Entity ID</dt><dd>${escapeHtml(nodeId)}</dd>
                    <dt>Instance</dt><dd>${escapeHtml(projectLabel)}</dd>
                </dl>
            </section>
        </div>
    `;
}

function wireDetailRailToggle(host: HTMLElement) {
    host.querySelectorAll<HTMLElement>('[data-action="hide-detail-rail"]').forEach(button => {
        button.addEventListener('click', () => {
            button.closest('.detail-shell')?.classList.add('detail-shell--rail-hidden');
        });
    });
    host.querySelectorAll<HTMLElement>('[data-action="show-detail-rail"]').forEach(button => {
        button.addEventListener('click', () => {
            button.closest('.detail-shell')?.classList.remove('detail-shell--rail-hidden');
        });
    });
}

/** Fill split Explore inline detail panels (does not use fullscreen #detail-page). */
export function syncExploreSplitDetailPanels() {
    const split = isSplitCompareLayoutVisible() && S.activeWorkspace === 'explore';
    const wrapL = document.getElementById('explore-detail-inline-left');
    const wrapR = document.getElementById('explore-detail-inline-right');
    const bodyL = document.getElementById('explore-detail-inline-body-left');
    const bodyR = document.getElementById('explore-detail-inline-body-right');
    if (!wrapL || !wrapR || !bodyL || !bodyR) return;

    if (!split) {
        wrapL.classList.add('hidden');
        wrapR.classList.add('hidden');
        setExploreInlineDetailOpen(wrapL, false);
        setExploreInlineDetailOpen(wrapR, false);
        bodyL.innerHTML = '';
        bodyR.innerHTML = '';
        return;
    }

    hideEntityDetails();
    const baseProjectLabel = S.activeProjectName || S.activeProjectId || 'Base';
    const targetProjectLabel = S.compareTargetProjectName || S.compareTargetProjectId || 'Target';
    const titleL = document.getElementById('explore-detail-inline-title-left');
    const titleR = document.getElementById('explore-detail-inline-title-right');
    if (titleL) titleL.textContent = `Detail · ${baseProjectLabel}`;
    if (titleR) titleR.textContent = `Detail · ${targetProjectLabel}`;

    const selL = S.exploreLeftSelection;
    if (!selL?.nodeId) {
        wrapL.classList.add('hidden');
        setExploreInlineDetailOpen(wrapL, false);
        bodyL.innerHTML = '';
    } else {
        let node = S.nodeById.get(selL.nodeId);
        if (!node) {
            const lower = selL.nodeId.toLowerCase();
            for (const [k, v] of S.nodeById) {
                if (k.toLowerCase() === lower) {
                    node = v;
                    break;
                }
            }
        }
        if (!node) {
            wrapL.classList.remove('hidden');
            setExploreInlineDetailOpen(wrapL, true);
            bodyL.innerHTML = renderMissingCompareEntityHtml(selL.nodeId, baseProjectLabel);
        } else {
            wrapL.classList.remove('hidden');
            setExploreInlineDetailOpen(wrapL, true);
            try {
                bodyL.innerHTML = renderEntityDetailInnerHtml(node, {
                    ...selL,
                    sourcePane: 'left',
                    detailProjectLabel: baseProjectLabel,
                });
                wireDetailRailToggle(bodyL);
                wireRuleLogicCopyButtons(bodyL);
            } catch (err) {
                console.error('Explore inline detail (base) failed', err);
                bodyL.innerHTML = `<p class="empty-mini">Could not render detail. Check the console for errors.</p>`;
            }
        }
    }

    const selR = S.exploreRightSelection;
    const prep = S.compareTargetPrepared;
    if (!selR?.nodeId || !prep) {
        wrapR.classList.add('hidden');
        setExploreInlineDetailOpen(wrapR, false);
        bodyR.innerHTML = '';
    } else {
        let node = prep.nodeById.get(selR.nodeId);
        if (!node) {
            const lower = selR.nodeId.toLowerCase();
            for (const [k, v] of prep.nodeById) {
                if (k.toLowerCase() === lower) {
                    node = v;
                    break;
                }
            }
        }
        if (!node) {
            wrapR.classList.remove('hidden');
            setExploreInlineDetailOpen(wrapR, true);
            bodyR.innerHTML = renderMissingCompareEntityHtml(selR.nodeId, targetProjectLabel);
        } else {
            const saved = snapshotPrimaryPreparedModel();
            applyPreparedModelToAppState(prep);
            try {
                wrapR.classList.remove('hidden');
                setExploreInlineDetailOpen(wrapR, true);
                bodyR.innerHTML = renderEntityDetailInnerHtml(node, {
                    ...selR,
                    sourcePane: 'right',
                    detailProjectLabel: targetProjectLabel,
                });
                wireDetailRailToggle(bodyR);
                wireRuleLogicCopyButtons(bodyR);
            } catch (err) {
                console.error('Explore inline detail (target) failed', err);
                bodyR.innerHTML = `<p class="empty-mini">Could not render detail. Check the console for errors.</p>`;
            } finally {
                applyPreparedModelToAppState(saved);
            }
        }
    }

    scrollExploreInlineDetailIntoView(wrapL);
    scrollExploreInlineDetailIntoView(wrapR);
}

export function showEntityDetails(node: any, context: SelectNodeContext = {}) {
    if (!node) {
        hideEntityDetails();
        return;
    }

    const page = document.getElementById('detail-page');
    const eyebrowEl = document.getElementById('detail-page-eyebrow');
    const titleEl = document.getElementById('detail-page-title');
    const bodyEl = document.getElementById('detail-page-body');
    if (!page || !bodyEl) return;

    page.classList.remove('hidden');
    document.body.classList.add('detail-mode');
    renderInspectorPanelState();

    const typeBadge = `<span class="detail-badge">${escapeHtml(formatType(node.type))}</span>`;
    const moduleBadge = `<span class="detail-badge module">${escapeHtml(node.moduleLabel || node.moduleFamily || 'Unclassified')}</span>`;
    if (titleEl) titleEl.innerHTML = `${escapeHtml(node.label || node.id)} ${typeBadge} ${moduleBadge}`;
    if (eyebrowEl) {
        eyebrowEl.innerText = context.fromSearch ? 'Search result detail' : 'Node detail';
    }
    syncDetailPageProject(context);

    bodyEl.innerHTML = renderEntityDetailInnerHtml(node, context);
    wireDetailRailToggle(bodyEl);
    wireRuleLogicCopyButtons(bodyEl);
}

export function hideEntityDetails() {
    document.body.classList.remove('detail-mode');
    document.getElementById('detail-page')?.classList.add('hidden');
    const projectEl = document.getElementById('detail-page-project');
    if (projectEl) {
        projectEl.textContent = '';
        projectEl.setAttribute('hidden', '');
    }
    const bodyEl = document.getElementById('detail-page-body');
    if (bodyEl) bodyEl.innerHTML = '';
    renderInspectorPanelState();
}

export function renderWorkflowDetailInnerHtml(workflow: any, context: DetailProjectContext = {}): string {
    const projectLabel = resolveDetailProjectLabel(context);
    const sections = [
        renderKeyValueSection('Workflow Profile', [
            ['Code', workflow.code],
            ['Project', projectLabel],
            ['Steps', `${workflow.stepCount}`],
            ['Approver Types', workflow.approverTypes.join(', ') || 'None'],
            ['Base Object Types', workflow.baseObjectTypes.join(', ') || 'Unknown']
        ]),
        renderWorkflowStepSection(workflow),
        renderPillSection('Workflow Flags', buildWorkflowDiagnosticPills(workflow), 'No workflow feature flags available.')
    ];

    return `
        <div class="detail-shell">
            <section class="detail-hero">
                <div class="detail-card detail-hero-copy">
                    <div class="detail-header">
                        <span class="detail-badge">Workflow</span>
                        <span class="detail-badge module">Explorer</span>
                        ${renderProjectOriginBadge(context)}
                        ${workflow.hasDynamicAssignment ? '<span class="detail-badge warning">Dynamic Assignment</span>' : ''}
                    </div>
                    <h3>${escapeHtml(workflow.name || workflow.code)}</h3>
                    <p>${escapeHtml(buildWorkflowSummary(workflow))}</p>
                </div>
                <div class="detail-card">
                    <div class="detail-metric-grid">
                        ${[
                            { label: 'Steps', value: workflow.stepCount },
                            { label: 'Approver Types', value: workflow.approverTypes.length },
                            { label: 'Contributors', value: workflow.hasContributors ? 'Yes' : 'No' },
                            { label: 'Dynamic Assign', value: workflow.hasDynamicAssignment ? 'Yes' : 'No' }
                        ].map(metric => `
                            <div class="detail-metric">
                                <span class="detail-metric-label">${escapeHtml(metric.label)}</span>
                                <span class="detail-metric-value">${escapeHtml(metric.value)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </section>
            <div class="detail-layout">
                <aside class="detail-rail">
                    <div class="detail-rail-actions">
                        <button type="button" class="detail-rail-toggle" data-action="hide-detail-rail">Hide context</button>
                    </div>
                    <section class="detail-rail-card">
                        <h4>Workflow Context</h4>
                        <div class="detail-rail-list">
                            <div class="detail-rail-item"><span>Project</span><strong>${escapeHtml(projectLabel)}</strong></div>
                            <div class="detail-rail-item"><span>Code</span><strong>${escapeHtml(workflow.code)}</strong></div>
                        </div>
                    </section>
                    <section class="detail-rail-card">
                        <h4>Workflow Flags</h4>
                        <div class="detail-rail-list">
                            <div class="detail-rail-item"><span>Delegate Support</span><strong>${workflow.delegateSupported ? 'Yes' : 'No'}</strong></div>
                            <div class="detail-rail-item"><span>CC Actors</span><strong>${workflow.hasCcActors ? 'Yes' : 'No'}</strong></div>
                            <div class="detail-rail-item"><span>Contributors</span><strong>${workflow.hasContributors ? 'Yes' : 'No'}</strong></div>
                            <div class="detail-rail-item"><span>Future Dated Alt</span><strong>${workflow.futureDatedAlternateWorkflow ? 'Yes' : 'No'}</strong></div>
                        </div>
                    </section>
                </aside>
                <div class="detail-main"><button type="button" class="detail-rail-show" data-action="show-detail-rail">Show context</button>${sections.join('')}</div>
            </div>
        </div>
    `;
}

function setWorkflowInlineDetailOpen(wrap: HTMLElement, open: boolean) {
    const workspace = wrap.closest<HTMLElement>('.workflow-workspace');
    const list = workspace?.querySelector<HTMLElement>('.workflow-list');
    workspace?.classList.toggle('workflow-workspace--detail-open', open);
    if (open) list?.setAttribute('hidden', '');
    else list?.removeAttribute('hidden');
}

function syncWorkflowInlinePane(
    side: 'left' | 'right',
    workflow: any | null | undefined,
    context: DetailProjectContext
) {
    const wrap = document.getElementById(`workflow-detail-inline-${side}`) as HTMLElement | null;
    const body = document.getElementById(`workflow-detail-inline-body-${side}`) as HTMLElement | null;
    if (!wrap || !body) return;

    if (!workflow) {
        wrap.classList.add('hidden');
        setWorkflowInlineDetailOpen(wrap, false);
        body.innerHTML = '';
        return;
    }

    wrap.classList.remove('hidden');
    setWorkflowInlineDetailOpen(wrap, true);
    try {
        body.innerHTML = renderWorkflowDetailInnerHtml(workflow, context);
        wireDetailRailToggle(body);
    } catch (err) {
        console.error(`Workflow inline detail (${side}) failed`, err);
        body.innerHTML = '<p class="empty-mini">Could not render workflow detail. Check the console for errors.</p>';
    }
}

export function syncWorkflowSplitDetailPanels() {
    const split = isSplitCompareLayoutVisible() && S.activeWorkspace === 'workflows';
    const wrapL = document.getElementById('workflow-detail-inline-left') as HTMLElement | null;
    const wrapR = document.getElementById('workflow-detail-inline-right') as HTMLElement | null;
    const bodyL = document.getElementById('workflow-detail-inline-body-left') as HTMLElement | null;
    const bodyR = document.getElementById('workflow-detail-inline-body-right') as HTMLElement | null;
    if (!wrapL || !wrapR || !bodyL || !bodyR) return;

    if (!split) {
        wrapL.classList.add('hidden');
        wrapR.classList.add('hidden');
        setWorkflowInlineDetailOpen(wrapL, false);
        setWorkflowInlineDetailOpen(wrapR, false);
        bodyL.innerHTML = '';
        bodyR.innerHTML = '';
        return;
    }

    hideEntityDetails();
    const baseProjectLabel = S.activeProjectName || S.activeProjectId || 'Base';
    const targetProjectLabel = S.compareTargetProjectName || S.compareTargetProjectId || 'Target';
    const titleL = document.getElementById('workflow-detail-inline-title-left');
    const titleR = document.getElementById('workflow-detail-inline-title-right');
    if (titleL) titleL.textContent = `Workflow detail · ${baseProjectLabel}`;
    if (titleR) titleR.textContent = `Workflow detail · ${targetProjectLabel}`;
    syncWorkflowInlinePane('left', S.currentWorkflowCode ? S.workflowByCode.get(S.currentWorkflowCode) : null, {
        sourcePane: 'left',
        detailProjectLabel: baseProjectLabel,
    });
    syncWorkflowInlinePane(
        'right',
        S.currentWorkflowCodeRight && S.compareTargetPrepared
            ? S.compareTargetPrepared.workflowByCode.get(S.currentWorkflowCodeRight)
            : null,
        {
            sourcePane: 'right',
            detailProjectLabel: targetProjectLabel,
        }
    );
}

export function showWorkflowDetails(workflow: any, context: DetailProjectContext = {}) {
    if (!workflow) {
        hideEntityDetails();
        return;
    }

    const page = document.getElementById('detail-page');
    const eyebrowEl = document.getElementById('detail-page-eyebrow');
    const titleEl = document.getElementById('detail-page-title');
    const bodyEl = document.getElementById('detail-page-body');
    if (!page || !bodyEl) return;

    page.classList.remove('hidden');
    document.body.classList.add('detail-mode');
    renderInspectorPanelState();
    if (eyebrowEl) eyebrowEl.innerText = 'Workflow explorer';
    if (titleEl) {
        titleEl.innerHTML = `${escapeHtml(workflow.name || workflow.code)} <span class="detail-badge">Workflow</span>`;
    }
    syncDetailPageProject(context);
    bodyEl.innerHTML = renderWorkflowDetailInnerHtml(workflow, context);
    wireDetailRailToggle(bodyEl);
}

function renderDetailHero(node: any, context: any) {
    const metrics = buildDetailMetrics(node);
    const description = node.description || buildDetailSummary(node, context);
    const focusActionLabel = S.currentModule === 'ALL'
        ? 'Focus neighborhood on graph'
        : 'Center this node in graph';

    return `
        <section class="detail-hero">
            <div class="detail-card detail-hero-copy">
                <div class="detail-header">
                    <span class="detail-badge">${escapeHtml(formatType(node.type))}</span>
                    <span class="detail-badge module">${escapeHtml(node.moduleLabel || node.moduleFamily || 'Unclassified')}</span>
                    ${renderProjectOriginBadge(context)}
                    ${node.unresolvedBaseObject ? '<span class="detail-badge warning">Unresolved Base Object</span>' : ''}
                </div>
                <h3>${escapeHtml(node.label || node.id)}</h3>
                <p>${escapeHtml(description)}</p>
                <div class="detail-actions">
                    <button type="button" class="detail-action" data-focus-node-id="${escapeAttribute(node.id)}">${escapeHtml(focusActionLabel)}</button>
                    <button type="button" class="detail-action secondary" data-node-id="${escapeAttribute(node.id)}">Refresh this detail page</button>
                </div>
            </div>
            <div class="detail-card detail-hero-metrics">
                <div class="detail-metric-grid">
                    ${metrics.map(metric => `
                        <div class="detail-metric">
                            <span class="detail-metric-label">${escapeHtml(metric.label)}</span>
                            <span class="detail-metric-value">${escapeHtml(metric.value)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </section>
    `;
}

function renderDetailRail(node: any, context: DetailProjectContext = {}) {
    const degree = S.currentGraphData?.visibleDegree?.get(node.id) || 0;
    const related = getConnectedNodes(node.id).length;
    const formatViewLabel = (v: any) => v === 'all' ? 'All Types' : formatType(v);
    const projectLabel = resolveDetailProjectLabel(context);
    return `
        <aside class="detail-rail">
            <div class="detail-rail-actions">
                <button type="button" class="detail-rail-toggle" data-action="hide-detail-rail">Hide context</button>
            </div>
            <section class="detail-rail-card">
                <h4>Current Context</h4>
                <div class="detail-rail-list">
                    <div class="detail-rail-item"><span>Project</span><strong>${escapeHtml(projectLabel)}</strong></div>
                    <div class="detail-rail-item"><span>Scope</span><strong>${escapeHtml(S.currentGraphData?.scopeLabel || 'Overview')}</strong></div>
                    <div class="detail-rail-item"><span>View</span><strong>${escapeHtml(formatViewLabel(S.currentView))}</strong></div>
                    <div class="detail-rail-item"><span>Visible Links</span><strong>${degree.toLocaleString()}</strong></div>
                    <div class="detail-rail-item"><span>Total Related Nodes</span><strong>${related.toLocaleString()}</strong></div>
                </div>
            </section>
            <section class="detail-rail-card">
                <h4>Classification</h4>
                <div class="detail-rail-list">
                    <div class="detail-rail-item"><span>Module</span><strong>${escapeHtml(node.moduleLabel || node.moduleFamily || 'Unclassified')}</strong></div>
                    ${node.subModule && node.subModule !== 'Unclassified' ? `<div class="detail-rail-item"><span>Sub-Module</span><strong>${escapeHtml(node.subModule)}</strong></div>` : ''}
                    ${node.moduleGroup && node.moduleGroup !== 'Unclassified' ? `<div class="detail-rail-item"><span>Group</span><strong>${escapeHtml(node.moduleGroup)}</strong></div>` : ''}
                    ${node.objectClass ? `<div class="detail-rail-item"><span>Object Class</span><strong>${escapeHtml(node.objectClass)}</strong></div>` : ''}
                    ${node.objectTechnology ? `<div class="detail-rail-item"><span>Technology</span><strong>${escapeHtml(node.objectTechnology)}</strong></div>` : ''}
                    <div class="detail-rail-item"><span>Module Source</span><strong>${escapeHtml(node.moduleSource || 'default')}</strong></div>
                    <div class="detail-rail-item"><span>Confidence</span><strong>${Math.round((node.moduleConfidence || 0) * 100)}%</strong></div>
                    <div class="detail-rail-item"><span>Identifier</span><strong>${escapeHtml(node.id)}</strong></div>
                </div>
            </section>
        </aside>
    `;
}

function buildDetailMetrics(node: any) {
    if (node.type === 'MDF_OBJECT') {
        const rules = getObjectRules(node.id).length;
        const associations = getObjectAssociations(node.id).length;
        const fields = (node.attributes || []).length + (node.corporateDataModel?.fieldCount || 0);
        const roleAccess = (S.roleObjectByObject.get(node.id) || []).length;
        return [
            { label: 'Fields', value: fields.toLocaleString() },
            { label: 'Rules', value: rules.toLocaleString() },
            { label: 'Associations', value: associations.toLocaleString() },
            { label: 'Role Access Rows', value: roleAccess.toLocaleString() }
        ];
    }
    if (node.type === 'BUSINESS_RULE') {
        const objects = getRuleObjects(node.id).length;
        const fields = (node.modifiesFields || []).length;
        return [
            { label: 'Connected Objects', value: objects.toLocaleString() },
            { label: 'Modified Fields', value: fields.toLocaleString() },
            { label: 'Scenario', value: node.scenarioCode || 'Unknown' },
            { label: 'Rule Type', value: node.ruleType || 'Unknown' }
        ];
    }
    if (node.type === 'RBP_ROLE') {
        const objectPermissions = (S.roleObjectByRole.get(node.id) || []).length;
        const systemPermissions = (S.roleSystemByRole.get(node.id) || []).length;
        return [
            { label: 'MDF Access Rows', value: objectPermissions.toLocaleString() },
            { label: 'System Permissions', value: systemPermissions.toLocaleString() },
            { label: 'Target Population', value: node.targetPopulation || 'None' },
            { label: 'Include Self', value: node.includeSelf || 'Unknown' }
        ];
    }
    if (node.type === 'ODATA_ENTITY') {
        const connections = getConnectedNodes(node.id).length;
        return [
            { label: 'Connected Nodes', value: connections.toLocaleString() },
            { label: 'Tags', value: `${(node.tags || []).length}` },
            { label: 'Creatable', value: formatBoolean(node.creatable) },
            { label: 'Updatable', value: formatBoolean(node.updatable) }
        ];
    }
    return [
        { label: 'Module', value: node.moduleFamily || 'Unclassified' },
        { label: 'Type', value: formatType(node.type) }
    ];
}

function buildDetailSummary(node: any, context: any) {
    if (node.type === 'MDF_OBJECT') {
        const fields = (node.attributes || []).length + (node.corporateDataModel?.fieldCount || 0);
        const rules = getObjectRules(node.id).length;
        const associations = getObjectAssociations(node.id).length;
        if (context.fieldName) {
            return `Focused through field match "${context.fieldName}". This object currently exposes ${fields} fields, ${rules} connected rules, and ${associations} visible associations in the metadata graph.`;
        }
        return `This MDF object currently exposes ${fields} fields, ${rules} connected rules, and ${associations} direct associations in the metadata graph.`;
    }
    if (node.type === 'BUSINESS_RULE') {
        return `This rule is modeled with scenario ${node.scenarioCode || 'Unknown'} and is connected to ${getRuleObjects(node.id).length} MDF objects in the current graph export.`;
    }
    if (node.type === 'RBP_ROLE') {
        return `This role currently carries ${(S.roleObjectByRole.get(node.id) || []).length} MDF permission rows and ${(S.roleSystemByRole.get(node.id) || []).length} system permission rows in the imported RBP summaries.`;
    }
    if (node.type === 'ODATA_ENTITY') {
        return `This OData entity is connected to ${getConnectedNodes(node.id).length} graph nodes and carries ${(node.tags || []).length} metadata tags from the EDMX export.`;
    }
    return 'This node is part of the imported SuccessFactors architecture graph.';
}

function wireRuleLogicCopyButtons(scope: HTMLElement) {
    scope.querySelectorAll<HTMLElement>('[data-rule-copy]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.preventDefault();
            const enc = btn.getAttribute('data-rule-copy');
            if (!enc) return;
            try {
                void navigator.clipboard.writeText(decodeURIComponent(enc));
            } catch {
                /* ignore */
            }
        });
    });
}

function renderSummarySection(node: any) {
    const badges = [
        `<span class="detail-badge">${escapeHtml(formatType(node.type))}</span>`,
        `<span class="detail-badge module">${escapeHtml(node.moduleLabel || node.moduleFamily || 'Unclassified')}</span>`
    ];
    if (node.objectClass) badges.push(`<span class="detail-badge">${escapeHtml(node.objectClass)}</span>`);
    if (node.unresolvedBaseObject) badges.push('<span class="detail-badge warning">Unresolved Base Object</span>');

    return `
        <section class="detail-section">
            <div class="detail-header">${badges.join('')}</div>
            ${node.description ? `<p>${escapeHtml(node.description)}</p>` : ''}
            <dl class="detail-kv">
                <dt>ID</dt><dd>${escapeHtml(node.id)}</dd>
                ${node.objectTechnology ? `<dt>Technology</dt><dd>${escapeHtml(node.objectTechnology)}</dd>` : ''}
                <dt>Module Source</dt><dd>${escapeHtml(node.moduleSource || 'default')} (${Math.round((node.moduleConfidence || 0) * 100)}%)</dd>
                ${node.dataModelSources?.length ? `<dt>Data Sources</dt><dd>${escapeHtml(node.dataModelSources.join(', '))}</dd>` : ''}
                ${node.secondaryTypes?.length ? `<dt>Secondary Types</dt><dd>${escapeHtml(node.secondaryTypes.join(', '))}</dd>` : ''}
            </dl>
        </section>
    `;
}

function renderTypeSpecificSections(node: any, context: any) {
    if (node.type === 'MDF_OBJECT') return renderObjectSections(node, context);
    if (node.type === 'BUSINESS_RULE') return renderRuleSections(node);
    if (node.type === 'RBP_ROLE') return renderRoleSections(node);
    if (node.type === 'ODATA_ENTITY') return renderODataSections(node);
    return [];
}

function renderObjectSections(node: any, context: any) {
    const rules = getObjectRules(node.id);
    const associations = getObjectAssociations(node.id);
    const roleAccess = S.roleObjectByObject.get(node.id) || [];
    const fields = node.attributes || [];
    const corporateFields = node.corporateDataModel?.fields || [];
    const countryOverrides = node.countryOverrides || [];

    return [
        renderKeyValueSection('Object Profile', [
            ['Object Class', node.objectClass || 'MDF'], ['Technology', node.objectTechnology || 'MDF'],
            ['Security Category', node.permissionCategory || 'None'], ['Secured by RBP', node.isSecured ? 'Yes' : 'No'],
            ['Role Access Entries', roleAccess.length.toLocaleString()], ['OData Exposed', node.odataExposed ? 'Yes' : 'No']
        ]),
        renderTableSection(`Fields (${fields.length})`, ['Field', 'Type', 'Visibility'],
            fields.map((field: any) => ({ cells: [field.name, field.type || '-', field.visibility || '-'], match: context.fieldName && (field.name === context.fieldName || field.label === context.fieldName) })), 'No field data available.'),
        renderTableSection(`Corporate Data Model Fields (${corporateFields.length})`, ['Field', 'Type', 'Visibility'],
            corporateFields.map((field: any) => ({ cells: [field.label || field.id, field.type || '-', field.visibility || '-'], match: context.fieldName && (field.id === context.fieldName || field.label === context.fieldName) })), 'No corporate data model fields.'),
        renderTableSection(`Country Overrides (${countryOverrides.length})`, ['Country', 'Field Count', 'Sample Fields'],
            countryOverrides.map((override: any) => ({ cells: [override.countryCode, `${override.fieldCount || 0}`, (override.fields || []).slice(0, 4).map((field: any) => field.label || field.id).join(', ') || '-'] })), 'No country-specific overrides.'),
        renderLinkedSection(`Rules (${rules.length})`, rules.map(rule => ({ id: rule.rule!.id, label: `${rule.rule!.label || rule.rule!.id}${rule.edge.ruleBindingType ? ` · ${rule.edge.ruleBindingType}` : ''}` })), 'No connected rules.'),
        renderLinkedSection(`Associations (${associations.length})`, associations.map(association => ({ id: association.otherNode!.id, label: `${association.otherNode!.label || association.otherNode!.id}${association.edge.associationKind ? ` · ${association.edge.associationKind}` : ''}` })), 'No object associations.'),
        renderTableSection(`Role Access (${roleAccess.length})`, ['Role', 'Permissions', 'Categories'],
            roleAccess.slice(0, 80).map(entry => ({ cells: [trustedHtml(renderNodeButton(entry.roleId, entry.roleNode.label || entry.roleId)), entry.permissions.join(', ') || '-', entry.categories.join(', ') || '-'] })), 'No role access summaries.')
    ];
}

function renderRuleSections(node: any) {
    const relatedObjects = getRuleObjects(node.id);
    return [
        renderKeyValueSection('Rule Profile', [
            ['Base Object Alias', node.baseObjectAlias || 'None'], ['Resolved Base Object', node.resolvedBaseObject || 'Unresolved'],
            ['Rule Type', node.ruleType || 'Unknown'], ['Scenario', node.scenarioCode || 'Unknown']
        ]),
        renderLinkedSection(`Connected Objects (${relatedObjects.length})`, relatedObjects.map(item => ({ id: item.object!.id, label: `${item.object!.label || item.object!.id}${item.edge.ruleBindingType ? ` · ${item.edge.ruleBindingType}` : ''}` })), 'No connected objects.'),
        renderPillSection(`Modified Fields (${(node.modifiesFields || []).length})`, node.modifiesFields || [], 'No field modifications detected.'),
        renderRuleLogicSection(node),
        renderRuleAssignmentSection(node)
    ];
}

function renderRoleSections(node: any) {
    const objectPermissions = S.roleObjectByRole.get(node.id) || [];
    const systemPermissions = S.roleSystemByRole.get(node.id) || [];
    return [
        renderKeyValueSection('Population', [
            ['Target Population', node.targetPopulation || 'None'], ['Granted Population', node.grantedPopulation || 'None'],
            ['Include Self', node.includeSelf || 'Unknown'], ['Access User Status', node.accessUserStatus || 'Unknown']
        ]),
        renderTableSection(`Object Access (${objectPermissions.length})`, ['Object', 'Permissions', 'Categories'],
            objectPermissions.slice(0, 80).map(entry => ({ cells: [trustedHtml(renderNodeButton(entry.objectId, entry.objectNode.label || entry.objectId)), entry.permissions.join(', ') || '-', entry.categories.join(', ') || '-'] })), 'No object permission summaries.'),
        renderTableSection(`System Permissions (${systemPermissions.length})`, ['Permission', 'Categories'],
            systemPermissions.slice(0, 80).map(entry => ({ cells: [entry.permission, entry.categories.join(', ') || '-'] })), 'No system permissions.')
    ];
}

function renderODataSections(node: any) {
    const connections = getConnectedNodes(node.id);
    return [
        renderKeyValueSection('OData Profile', [
            ['Creatable', formatBoolean(node.creatable)], ['Updatable', formatBoolean(node.updatable)],
            ['Deletable', formatBoolean(node.deletable)], ['Upsertable', formatBoolean(node.upsertable)]
        ]),
        renderPillSection(`Tags (${(node.tags || []).length})`, node.tags || [], 'No module tags.'),
        renderLinkedSection(`Connected Nodes (${connections.length})`, connections.map(item => ({ id: item.node!.id, label: `${item.node!.label || item.node!.id} · ${item.edge.type}` })), 'No graph connections.')
    ];
}

function splitWorkflowTokens(raw: string): string[] {
    return raw
        .split(/[,;|]|\s+[+]\s+/)
        .map(s => s.trim())
        .filter(Boolean);
}

function expandActorTokens(actor: any): string[] {
    const primary = String(actor?.actorRole || actor?.actorType || '').trim();
    if (!primary) return [];
    const parts = splitWorkflowTokens(primary);
    return parts.length > 1 ? parts : [primary];
}

function workflowSfPermissionLabel(raw: unknown): string {
    if (raw === true || raw === 'true') return 'Yes';
    const s = String(raw ?? '').trim().toUpperCase();
    if (s === 'T' || s === 'YES' || s === 'TRUE') return 'Yes';
    if (!s || s === 'F' || s === 'NO' || s === 'FALSE') return 'No';
    return String(raw ?? '').trim() || '—';
}

/** Per-approver block aligned with SuccessFactors workflow step fields (from WFInfo). */
function renderWorkflowApproverSfDetails(step: any): string {
    const approvers = step.approvers || [];
    if (!approvers.length) return '';
    return approvers
        .map((a: any) => {
            const type = a.actorType || 'Unknown';
            const role = a.actorRole ? String(a.actorRole).trim() : '';
            const headline = role ? `${escapeHtml(type)} — ${escapeHtml(role)}` : escapeHtml(type);
            const rows: [string, string][] = [];
            const ctx = String(a.context ?? '').trim();
            if (ctx) rows.push(['Context', escapeHtml(ctx)]);
            const action = String(a.actionType ?? '').trim();
            if (action) rows.push(['Edit transaction', escapeHtml(action)]);
            const skip = String(a.skipType ?? '').trim();
            if (skip) rows.push(['If no approver', escapeHtml(skip)]);
            const rel = String(a.relationshipToApprover ?? '').trim();
            if (rel) rows.push(['Relationship to approver', escapeHtml(rel)]);
            if (a.respectRBP !== undefined && a.respectRBP !== null && String(a.respectRBP).trim() !== '') {
                rows.push(['Respects permission', escapeHtml(workflowSfPermissionLabel(a.respectRBP))]);
            }
            const email = String(a.emailConfiguration ?? '').trim();
            if (email) rows.push(['Email configuration', escapeHtml(email)]);
            const detailRows = rows.length
                ? `<dl class="workflow-approver-kv">${rows.map(([dt, dd]) => `<dt>${escapeHtml(dt)}</dt><dd>${dd}</dd>`).join('')}</dl>`
                : '';
            return `<div class="workflow-approver-sf"><div class="workflow-approver-sf-head">${headline}</div>${detailRows}</div>`;
        })
        .join('');
}

function workflowCcLabels(step: any): string[] {
    const bag = new Set<string>();
    for (const a of step.ccActors || []) {
        for (const t of expandActorTokens(a)) bag.add(t);
    }
    return Array.from(bag);
}

function workflowContributorLabels(step: any): string[] {
    const out: string[] = [];
    for (const a of step.contributors || []) {
        const label = String(a.actorRole || a.actorType || '').trim();
        if (label) out.push(...expandActorTokens({ actorRole: label }));
    }
    return Array.from(new Set(out));
}

function workflowDynamicLabels(step: any): string[] {
    const bag = new Set<string>();
    for (const item of step.dynamicAssignments || []) {
        const raw =
            item.dynamicGroup ||
            item.type ||
            item.resolverType ||
            item.role ||
            (typeof item.label === 'string' ? item.label : '');
        const s = String(raw || '').trim();
        if (!s) continue;
        if (/[,;|]/.test(s)) splitWorkflowTokens(s).forEach(t => bag.add(t));
        else bag.add(s);
    }
    return Array.from(bag);
}

function workflowChipList(title: string, items: string[], tone: string): string {
    if (!items.length) {
        return `<div class="workflow-route-block"><div class="workflow-route-block-title">${escapeHtml(title)}</div><p class="workflow-route-empty">None</p></div>`;
    }
    const chips = items
        .map(t => `<span class="workflow-actor-chip workflow-actor-chip--${tone}">${escapeHtml(t)}</span>`)
        .join('');
    return `<div class="workflow-route-block"><div class="workflow-route-block-title">${escapeHtml(title)}</div><div class="workflow-actor-chip-list">${chips}</div></div>`;
}

function renderWorkflowStepSection(workflow: any) {
    if (!workflow?.steps?.length) {
        return '<section class="detail-section"><h4>Route</h4><p class="empty-mini">No ordered workflow steps were normalized from the current export.</p></section>';
    }
    return `
        <section class="detail-section">
            <h4>Route</h4>
            <p class="empty-mini" style="margin:0 0 0.75rem">Steps mirror WFInfo: approver fields use the same labels as in Admin Center where the export provides them. CC, contributors, and dynamic routing use chips when list-shaped.</p>
            <div class="workflow-route-steps">
                ${workflow.steps.map((step: any) => {
                    const hasApprovers = (step.approvers || []).length > 0;
                    const approverBlock = hasApprovers
                        ? `<div class="workflow-route-block"><div class="workflow-route-block-title">Approvers</div><div class="workflow-approver-sf-list">${renderWorkflowApproverSfDetails(step)}</div></div>`
                        : workflowChipList('Approvers', [], 'approver');
                    const cc = workflowCcLabels(step);
                    const contributors = workflowContributorLabels(step);
                    const dynamics = workflowDynamicLabels(step);
                    const baseTypes = (step.baseObjectTypes || []).length
                        ? `<span class="detail-badge module">${escapeHtml(step.baseObjectTypes.join(', '))}</span>`
                        : '';
                    return `
                    <div class="workflow-route-step">
                        <div class="workflow-route-step-head">
                            <span class="detail-badge">Step ${escapeHtml(step.stepNumber)}</span>
                            ${baseTypes}
                        </div>
                        <div class="workflow-route-step-body">
                            ${approverBlock}
                            ${workflowChipList('CC', cc, 'cc')}
                            ${contributors.length ? workflowChipList('Contributors', contributors, 'contributor') : ''}
                            ${workflowChipList('Dynamic assignment', dynamics, 'dynamic')}
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </section>
    `;
}

function buildWorkflowDiagnosticPills(workflow: any) {
    const pills: string[] = [];
    if (workflow.delegateSupported) pills.push('Delegate support');
    if (workflow.hasContributors) pills.push('Contributors');
    if (workflow.hasCcActors) pills.push('CC actors');
    if (workflow.hasDynamicAssignment) pills.push('Dynamic assignment');
    if (workflow.futureDatedAlternateWorkflow) pills.push('Future-dated alternate flow');
    if (workflow.ccLinkToApprovalPage) pills.push('CC link to approval page');
    if (workflow.respectRbp) pills.push('Respects RBP');
    return pills;
}

function buildWorkflowSummary(workflow: any) {
    return `This workflow contains ${workflow.stepCount} normalized steps, uses ${workflow.approverTypes.join(', ') || 'no captured approver types'}, and is currently mapped to ${workflow.baseObjectTypes.join(', ') || 'unknown base object types'}.`;
}

function renderRuleAssignmentSection(node: any) {
    if (!node.assignmentInfo) {
        return `<section class="detail-section"><h4>Assignment Information</h4><p class="empty-mini">No assignment information available. Upload the business rules assignments export to populate this section.</p></section>`;
    }
    const rows: [string, any][] = [];
    if (node.assignmentInfo.assignmentText) rows.push(['Assignment', node.assignmentInfo.assignmentText]);
    if (node.assignmentInfo.effectiveDate) rows.push(['Effective Date', node.assignmentInfo.effectiveDate]);
    if (node.assignmentInfo.status) rows.push(['Status', node.assignmentInfo.status]);
    if (node.assignmentInfo.assignedScenario) rows.push(['Assigned Scenario', node.assignmentInfo.assignedScenario]);
    return renderKeyValueSection('Assignment Information', rows.length ? rows : [['Assignment', node.assignmentInfo.assignmentText || 'See raw data']]);
}

export function renderNodeButton(nodeId: any, label: any) {
    return `<button type="button" class="detail-link" data-node-id="${escapeAttribute(nodeId)}">${escapeHtml(label)}</button>`;
}

export function getObjectRules(objectId: any) {
    return (S.edgesByNode.get(objectId) || [])
        .filter(edge => ['TRIGGERED_BY', 'MODIFIES'].includes(edge.type))
        .map(edge => ({ edge, rule: S.nodeById.get(edge.from === objectId ? edge.to : edge.from) }))
        .filter(item => item.rule?.type === 'BUSINESS_RULE');
}

export function getObjectAssociations(objectId: any) {
    return (S.edgesByNode.get(objectId) || [])
        .filter(edge => edge.type === 'ASSOCIATION')
        .map(edge => ({ edge, otherNode: S.nodeById.get(edge.from === objectId ? edge.to : edge.from) }))
        .filter(item => item.otherNode);
}

export function getRuleObjects(ruleId: any) {
    return (S.edgesByNode.get(ruleId) || [])
        .filter(edge => ['TRIGGERED_BY', 'MODIFIES'].includes(edge.type))
        .map(edge => ({ edge, object: S.nodeById.get(edge.from === ruleId ? edge.to : edge.from) }))
        .filter(item => item.object?.type === 'MDF_OBJECT');
}

export function getConnectedNodes(nodeId: any) {
    return (S.edgesByNode.get(nodeId) || [])
        .map(edge => ({ edge, node: S.nodeById.get(edge.from === nodeId ? edge.to : edge.from) }))
        .filter(item => item.node);
}

function renderKeyValueSection(title: any, rows: Array<[any, any]>) {
    return `<section class="detail-section"><h4>${escapeHtml(title)}</h4><dl class="detail-kv">${rows.map(([key, value]: [any, any]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl></section>`;
}

function renderTableSection(title: any, headers: any[], rows: any[], emptyMessage: any) {
    if (!rows || rows.length === 0) {
        return `<section class="detail-section"><h4>${escapeHtml(title)}</h4><p class="empty-mini">${escapeHtml(emptyMessage)}</p></section>`;
    }
    return `<section class="detail-section"><h4>${escapeHtml(title)}</h4><table class="detail-table"><thead><tr>${headers.map((header: any) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row: any) => `<tr${row.match ? ' class="match-row"' : ''}>${row.cells.map((cell: any) => `<td>${cell && typeof cell === 'object' && cell.__trustedHtml ? cell.__trustedHtml : escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`;
}

function renderLinkedSection(title: any, items: any[], emptyMessage: any) {
    if (!items || items.length === 0) {
        return `<section class="detail-section"><h4>${escapeHtml(title)}</h4><p class="empty-mini">${escapeHtml(emptyMessage)}</p></section>`;
    }
    return `<section class="detail-section"><h4>${escapeHtml(title)}</h4><div class="detail-list">${items.slice(0, 60).map(item => renderNodeButton(item.id, item.label)).join('')}</div></section>`;
}

function renderPillSection(title: any, items: any[], emptyMessage: any) {
    if (!items || items.length === 0) {
        return `<section class="detail-section"><h4>${escapeHtml(title)}</h4><p class="empty-mini">${escapeHtml(emptyMessage)}</p></section>`;
    }
    return `<section class="detail-section"><h4>${escapeHtml(title)}</h4><div class="detail-pill-list">${items.map(item => `<span class="detail-pill">${escapeHtml(item)}</span>`).join('')}</div></section>`;
}
