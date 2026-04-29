import { appState as S, patchAppState, type AppState } from './store';
import type { PreparedInstanceModel } from './prepared-instance';
import { selectNode } from './node-selection';
import { ensureInspectorLoaded } from './lazy-loaders';
import { refreshWorkspace, setActiveWorkspace } from './workspace';
import { isSplitCompareLayoutVisible } from './split-compare';
import { escapeHtml, escapeAttribute } from './utils';
import { compareState } from './compare';

const EXPLORE_META: Record<string, { title: string; lead: string; emptyMsg: string; metricLabel: string }> = {
    objects: { title: 'Object Explorer', lead: 'Browse all MDF objects in the loaded instance.', emptyMsg: 'No objects found.', metricLabel: 'Objects' },
    rules: { title: 'Rule Explorer', lead: 'Browse all Business Rules defined in the instance.', emptyMsg: 'No rules found.', metricLabel: 'Rules' },
    roles: { title: 'Role Explorer', lead: 'Browse all RBP Roles and their permission counts.', emptyMsg: 'No roles found.', metricLabel: 'Roles' },
    odata: { title: 'OData Explorer', lead: 'Browse all OData Entity Sets exposed by the instance.', emptyMsg: 'No OData entities found.', metricLabel: 'OData Entities' },
};

let exploreControlOptionsBuiltFor = '';
let exploreGlobalDelegationBound = false;

function getExploreNodeForPane(pane: 'left' | 'right', prep: PreparedInstanceModel | null, nid: string) {
    const map = pane === 'right' && prep ? prep.nodeById : S.nodeById;
    if (map.has(nid)) return map.get(nid);
    const lower = nid.toLowerCase();
    for (const [k, v] of map) {
        if (k.toLowerCase() === lower) return v;
    }
    return undefined;
}

/** Bind capture-phase listeners on document so card clicks work even if per-list binding failed. */
function ensureExploreGlobalDelegation() {
    if (exploreGlobalDelegationBound) return;
    exploreGlobalDelegationBound = true;

    document.addEventListener(
        'click',
        (e: MouseEvent) => {
            if (S.activeWorkspace !== 'explore') return;
            const el = e.target;
            if (!(el instanceof Element)) return;
            const card = el.closest<HTMLElement>('.explorer-card[data-node-id]');
            if (!card) return;
            const left = document.getElementById('explore-list');
            const right = document.getElementById('explore-list-right');
            const pane = left?.contains(card) ? 'left' : right?.contains(card) ? 'right' : null;
            if (!pane) return;
            handleExploreCardActivation(pane, card);
        },
        true
    );

    document.addEventListener(
        'keydown',
        (e: KeyboardEvent) => {
            if (S.activeWorkspace !== 'explore') return;
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const el = e.target;
            if (!(el instanceof Element)) return;
            const card = el.closest<HTMLElement>('.explorer-card[data-node-id]');
            if (!card) return;
            const left = document.getElementById('explore-list');
            const right = document.getElementById('explore-list-right');
            const pane = left?.contains(card) ? 'left' : right?.contains(card) ? 'right' : null;
            if (!pane) return;
            e.preventDefault();
            handleExploreCardActivation(pane, card);
        },
        true
    );
}

function exploreDomId(base: string, pane: 'left' | 'right') {
    return pane === 'left' ? base : `${base}-right`;
}

function exploreSnapshot(prep: PreparedInstanceModel | null) {
    if (!prep) {
        return {
            allNodes: S.allNodes,
            edgesByNode: S.edgesByNode,
            nodeById: S.nodeById,
            searchEntries: S.searchEntries,
            dashboard: S.dashboard,
            roleObjectByRole: S.roleObjectByRole,
            roleSystemByRole: S.roleSystemByRole,
        };
    }
    return {
        allNodes: prep.allNodes,
        edgesByNode: prep.edgesByNode,
        nodeById: prep.nodeById,
        searchEntries: prep.searchEntries,
        dashboard: prep.dashboard,
        roleObjectByRole: prep.roleObjectByRole,
        roleSystemByRole: prep.roleSystemByRole,
    };
}

function exploreDeepSearchNodeIds(query: string, searchEntries = S.searchEntries): Set<string> | null {
    const s = query.trim().toLowerCase();
    if (!s) return null;
    const ids = new Set<string>();
    for (const e of searchEntries) {
        if (e.searchText.includes(s)) ids.add(e.nodeId);
    }
    return ids;
}

function exploreMatrixCtaHtml(place: 'footer' | 'top'): string {
    const cls = place === 'top' ? 'explorer-matrix-cta--top' : 'explorer-matrix-cta--footer';
    return `<div class="explorer-matrix-cta ${cls}"><div><div class="explorer-matrix-cta-title">ROFP Matrix</div><div class="explorer-matrix-cta-copy">Role × object coverage for the current module scope.</div></div><ui5-button design="Emphasized" data-action="goto-roles-matrix">Open ROFP Matrix</ui5-button></div>`;
}

type ExploreEntityKind = 'mdf' | 'rule' | 'role' | 'odata';
type ExplorePane = 'left' | 'right';
type ExploreSnapshot = ReturnType<typeof exploreSnapshot>;
type ExploreMeta = (typeof EXPLORE_META)[string];

type ExploreEntityRendererConfig = {
    pane: ExplorePane;
    prep: PreparedInstanceModel | null;
    query: string;
    meta: ExploreMeta;
    sourceNodes: (snap: ExploreSnapshot) => any[];
    filterPredicate?: (node: any, snap: ExploreSnapshot) => boolean;
    queryText: (node: any, snap: ExploreSnapshot) => string;
    sortNodes: (left: any, right: any, snap: ExploreSnapshot) => number;
    cardRenderer: (node: any, snap: ExploreSnapshot) => string;
};

function renderExplorerCard(
    pane: ExplorePane,
    node: any,
    kind: ExploreEntityKind,
    metaHtml: string
): string {
    const label = escapeHtml(node.label || node.id);
    const id = escapeHtml(node.id);
    const nodeId = escapeAttribute(node.id);
    const active = exploreCardActiveClass(pane, node.id as string);
    return `<div class="explorer-card${active}" data-node-id="${nodeId}" role="button" tabindex="0"><span class="explorer-card-kind explorer-card-kind--${kind}" aria-hidden="true"></span><div class="explorer-card-main"><span class="explorer-card-title">${label}</span><span class="explorer-card-id">${id}</span></div><div class="explorer-card-meta">${renderExploreDiffBadge(node.id)}${metaHtml}</div></div>`;
}

function renderExploreEntities(config: ExploreEntityRendererConfig) {
    const snap = exploreSnapshot(config.prep);
    if (!snap.dashboard) return;

    const metricBar = document.getElementById(exploreDomId('explore-metric-bar', config.pane));
    const list = document.getElementById(exploreDomId('explore-list', config.pane));
    if (!list) return;

    let nodes = config.sourceNodes(snap);
    if (config.filterPredicate) {
        nodes = nodes.filter(node => config.filterPredicate!(node, snap));
    }

    const q = `${config.query || ''}`.trim().toLowerCase();
    const deepIds = q && S.exploreDeepSearch ? exploreDeepSearchNodeIds(q, snap.searchEntries) : null;
    let filtered = nodes;
    if (q) {
        filtered = deepIds
            ? nodes.filter(node => deepIds.has(node.id as string))
            : nodes.filter(node => config.queryText(node, snap).toLowerCase().includes(q));
    }

    filtered = [...filtered].sort((left, right) => config.sortNodes(left, right, snap));

    if (metricBar) {
        metricBar.innerHTML = `<div class="metric-row"><span class="metric-label">${config.meta.metricLabel}</span><span class="metric-value">${filtered.length.toLocaleString()} / ${nodes.length.toLocaleString()}</span></div>`;
    }
    if (filtered.length === 0) {
        list.innerHTML = `<div class="empty-mini">${config.meta.emptyMsg}</div>`;
        return;
    }

    list.innerHTML = filtered.map(node => config.cardRenderer(node, snap)).join('');
}

function renderExploreDiffBadge(nodeId: string): string {
    if (!S.compareOverlay || !compareState.result || compareState.result.error) return '';
    const result = compareState.result;
    let status: 'added' | 'removed' | 'changed' | null = null;
    if (result.nodes.added.some((node: any) => node.id === nodeId)) status = 'added';
    else if (result.nodes.removed.some((node: any) => node.id === nodeId)) status = 'removed';
    else if (result.nodes.changed.some((node: any) => node.id === nodeId)) status = 'changed';
    else {
        const delta = result.rolePermissionDeltas?.[nodeId];
        const total = (delta?.totals?.added || 0) + (delta?.totals?.removed || 0) + (delta?.totals?.changed || 0);
        if (total > 0) status = 'changed';
    }
    if (!status) return '';
    const label = status === 'added' ? 'Added' : status === 'removed' ? 'Removed' : 'Changed';
    return `<span class="explorer-badge explorer-badge--diff explorer-badge--diff-${status}">${label}</span>`;
}

function bindExploreMatrixFooter(host: HTMLElement) {
    host.querySelector('[data-action="goto-roles-matrix"]')?.addEventListener('click', () => setActiveWorkspace('roles-matrix'));
}

function fillExploreUi5Select(sel: HTMLElement, options: { value: string; label: string }[]) {
    sel.replaceChildren();
    for (const o of options) {
        const opt = document.createElement('ui5-option');
        opt.value = o.value;
        opt.textContent = o.label;
        sel.appendChild(opt);
    }
}

function exploreSelectHasValue(sel: HTMLElement, val: string): boolean {
    return Array.from(sel.querySelectorAll('ui5-option')).some(o => o.value === val);
}

function syncExploreToolbarOptions() {
    const v = S.activeExploreView;

    if (exploreControlOptionsBuiltFor !== v) {
        exploreControlOptionsBuiltFor = v;
        S.exploreSort = 'label';

        const sortOpts: { value: string; label: string }[] =
            v === 'objects'
                ? [
                    { value: 'label', label: 'Label (A–Z)' },
                    { value: 'id', label: 'Technical id' },
                    { value: 'assoc', label: 'Association count' },
                    { value: 'module', label: 'Module' },
                ]
                : v === 'rules'
                    ? [
                        { value: 'label', label: 'Label (A–Z)' },
                        { value: 'id', label: 'Rule id' },
                        { value: 'objects', label: 'Linked objects' },
                    ]
                    : v === 'roles'
                        ? [
                            { value: 'label', label: 'Label (A–Z)' },
                            { value: 'id', label: 'Role id' },
                            { value: 'perms', label: 'Object permissions' },
                        ]
                        : [
                            { value: 'label', label: 'Label (A–Z)' },
                            { value: 'id', label: 'Entity id' },
                            { value: 'ns', label: 'Namespace' },
                        ];

        const families = S.dashboard?.stats?.moduleBreakdown?.families ?? [];
        const modOpts = [{ value: 'ALL', label: 'All modules' }, ...families.map((f: { family: string }) => ({ value: f.family, label: f.family }))];
        if (!modOpts.some(o => o.value === S.exploreModuleFilter)) S.exploreModuleFilter = 'ALL';

        let classOpts: { value: string; label: string }[] | null = null;
        if (v === 'objects') {
            const classes = new Set<string>();
            S.allNodes.filter(n => n.type === 'MDF_OBJECT').forEach(n => {
                if (n.objectClass) classes.add(n.objectClass as string);
            });
            const raw = ['ALL', ...Array.from(classes).sort()];
            classOpts = raw.map(c => ({ value: c, label: c === 'ALL' ? 'All classes' : c }));
            if (!raw.includes(S.exploreObjectClassFilter)) S.exploreObjectClassFilter = 'ALL';
        }

        let nsOpts: { value: string; label: string }[] | null = null;
        if (v === 'odata') {
            const nss = new Set<string>();
            S.allNodes.filter(n => n.type === 'ODATA_ENTITY').forEach(n => {
                if (n.namespace) nss.add(n.namespace as string);
            });
            const raw = ['ALL', ...Array.from(nss).sort()];
            nsOpts = raw.map(c => ({ value: c, label: c === 'ALL' ? 'All namespaces' : c }));
            if (!raw.includes(S.exploreNamespaceFilter)) S.exploreNamespaceFilter = 'ALL';
        }

        for (const pane of ['left', 'right'] as const) {
            const sortSel = document.getElementById(exploreDomId('explore-sort', pane));
            const modSel = document.getElementById(exploreDomId('explore-module-filter', pane));
            const classSel = document.getElementById(exploreDomId('explore-class-filter', pane));
            const nsSel = document.getElementById(exploreDomId('explore-ns-filter', pane));
            if (!sortSel || !modSel) continue;
            fillExploreUi5Select(sortSel, sortOpts);
            fillExploreUi5Select(modSel, modOpts);
            if (classSel && classOpts) fillExploreUi5Select(classSel, classOpts);
            if (nsSel && nsOpts) fillExploreUi5Select(nsSel, nsOpts);
        }
    }

    for (const pane of ['left', 'right'] as const) {
        const sortSel = document.getElementById(exploreDomId('explore-sort', pane));
        const modSel = document.getElementById(exploreDomId('explore-module-filter', pane));
        const classSel = document.getElementById(exploreDomId('explore-class-filter', pane));
        const nsSel = document.getElementById(exploreDomId('explore-ns-filter', pane));
        const deepCb = document.getElementById(exploreDomId('explore-deep-search', pane)) as HTMLInputElement | null;
        const classField = document.getElementById(exploreDomId('explore-class-field', pane));
        const nsField = document.getElementById(exploreDomId('explore-ns-field', pane));
        if (!sortSel || !modSel || !deepCb) continue;

        classField?.classList.toggle('hidden', v !== 'objects');
        nsField?.classList.toggle('hidden', v !== 'odata');

        if (!exploreSelectHasValue(sortSel, S.exploreSort)) {
            const first = sortSel.querySelector('ui5-option') as HTMLElement & { value: string };
            S.exploreSort = first?.value ?? 'label';
        }
        (sortSel as HTMLElement & { value: string }).value = S.exploreSort;
        (modSel as HTMLElement & { value: string }).value = S.exploreModuleFilter;
        if (classSel && v === 'objects') (classSel as HTMLElement & { value: string }).value = S.exploreObjectClassFilter;
        if (nsSel && v === 'odata') (nsSel as HTMLElement & { value: string }).value = S.exploreNamespaceFilter;
        deepCb.checked = S.exploreDeepSearch;

        const search = document.getElementById(exploreDomId('explore-search', pane)) as HTMLInputElement | null;
        if (search && search.value !== S.currentExploreQuery) search.value = S.currentExploreQuery;
    }
}

export function renderExploreWorkspace() {
    ensureExploreGlobalDelegation();
    const meta = EXPLORE_META[S.activeExploreView] || EXPLORE_META.objects;
    const titleEl = document.getElementById('explore-page-title');
    const leadEl = document.getElementById('explore-page-lead');
    if (titleEl) titleEl.textContent = meta.title;
    if (leadEl) leadEl.textContent = meta.lead;
    const titleRight = document.getElementById('explore-page-title-right');
    const leadRight = document.getElementById('explore-page-lead-right');
    if (titleRight) {
        titleRight.textContent =
            isSplitCompareLayoutVisible() ? meta.title : `${meta.title} (compare)`;
    }
    if (leadRight) leadRight.textContent = meta.lead;
    document.querySelectorAll('.explore-subnav-pill').forEach(pill => { pill.classList.toggle('active', (pill as HTMLElement).dataset?.exploreView === S.activeExploreView); });
    const matrixStrip = document.getElementById('explore-matrix-strip');
    if (matrixStrip) {
        if (S.activeExploreView === 'roles') {
            matrixStrip.classList.remove('hidden');
            matrixStrip.innerHTML = exploreMatrixCtaHtml('top');
            bindExploreMatrixFooter(matrixStrip);
        } else {
            matrixStrip.classList.add('hidden');
            matrixStrip.innerHTML = '';
        }
    }
    const matrixStripRight = document.getElementById('explore-matrix-strip-right');
    if (matrixStripRight) {
        if (isSplitCompareLayoutVisible() && S.activeExploreView === 'roles') {
            matrixStripRight.classList.remove('hidden');
            matrixStripRight.innerHTML = exploreMatrixCtaHtml('top');
            bindExploreMatrixFooter(matrixStripRight);
        } else {
            matrixStripRight.classList.add('hidden');
            matrixStripRight.innerHTML = '';
        }
    }
    syncExploreToolbarOptions();
    const q = S.currentExploreQuery;
    if (S.activeExploreView === 'objects') renderObjectsExplorer(q, meta);
    else if (S.activeExploreView === 'rules') renderRulesExplorer(q, meta);
    else if (S.activeExploreView === 'roles') renderRolesExplorer(q, meta);
    else if (S.activeExploreView === 'odata') renderODataExplorer(q, meta);

    const listRight = document.getElementById('explore-list-right');
    if (isSplitCompareLayoutVisible()) {
        const prep = S.compareTargetPrepared;
        if (prep && S.activeExploreView === 'objects') renderObjectsExplorer(q, meta, 'right', prep);
        else if (prep && S.activeExploreView === 'rules') renderRulesExplorer(q, meta, 'right', prep);
        else if (prep && S.activeExploreView === 'roles') renderRolesExplorer(q, meta, 'right', prep);
        else if (prep && S.activeExploreView === 'odata') renderODataExplorer(q, meta, 'right', prep);
    } else if (listRight) {
        if (S.splitCompareMode && S.compareTargetPrepared && S.splitCompareLayoutHidden) {
            listRight.innerHTML =
                '<div class="empty-mini">Target pane is hidden. Choose <strong>Show target pane</strong> in the compare strip.</div>';
        } else {
            listRight.innerHTML =
                '<div class="empty-mini">Use the Compare tab to load two projects side by side.</div>';
        }
    }

    scheduleExploreSplitDetailSync();
}

/** Inline split detail uses inspector HTML builders; wait for lazy inspector before syncing. */
function scheduleExploreSplitDetailSync() {
    void ensureInspectorLoaded().then(() =>
        import('./inspector').then(m => {
            try {
                m.syncExploreSplitDetailPanels();
            } catch (err) {
                console.error('syncExploreSplitDetailPanels failed', err);
            }
        })
    );
}

function exploreCardActiveClass(pane: 'left' | 'right', nodeId: string) {
    const sel = pane === 'left' ? S.exploreLeftSelection : S.exploreRightSelection;
    return sel?.nodeId === nodeId ? ' active' : '';
}

/** Card activation from delegated list listeners (bind once in bindExploreControls). */
function handleExploreCardActivation(pane: 'left' | 'right', card: HTMLElement) {
    const nidRaw = card.getAttribute('data-node-id') ?? '';
    const prep = pane === 'right' ? S.compareTargetPrepared : null;
    const node = getExploreNodeForPane(pane, prep, nidRaw);
    if (!node) return;
    const nid = String(node.id);

    const split = isSplitCompareLayoutVisible();
    if (split) {
        const patches: Partial<AppState> = { currentSelection: null };
        if (
            node.moduleFamily &&
            node.moduleFamily !== 'Unclassified' &&
            S.currentModule === 'ALL'
        ) {
            patches.currentModule = node.moduleFamily as string;
            patches.currentSubModule =
                node.subModule && node.subModule !== 'Unclassified'
                    ? (node.subModule as string)
                    : 'ALL';
        }
        if (pane === 'left') {
            patches.exploreLeftSelection = { nodeId: nid, type: 'EXPLORE', fromSearch: false };
        } else {
            patches.exploreRightSelection = { nodeId: nid, type: 'EXPLORE', fromSearch: false };
        }
        patchAppState(patches);
        refreshWorkspace();
        scheduleExploreSplitDetailSync();
        return;
    }

    void ensureInspectorLoaded()
        .then(() => {
            selectNode(nid, { type: 'EXPLORE', fromSearch: false });
        })
        .catch(err => console.error('Explore open detail failed', err));
}

function renderObjectsExplorer(
    q: any,
    meta: ExploreMeta,
    pane: ExplorePane = 'left',
    prep: PreparedInstanceModel | null = null
) {
    renderExploreEntities({
        pane,
        prep,
        query: q,
        meta,
        sourceNodes: snap => snap.allNodes.filter(n => n.type === 'MDF_OBJECT'),
        filterPredicate: node =>
            (S.exploreModuleFilter === 'ALL' || (node.moduleFamily || 'Unclassified') === S.exploreModuleFilter) &&
            (S.exploreObjectClassFilter === 'ALL' || node.objectClass === S.exploreObjectClassFilter),
        queryText: node => `${node.id} ${node.label || ''} ${node.objectClass || ''} ${node.moduleFamily || ''}`,
        sortNodes: (a, b, snap) => {
            const sortKey = S.exploreSort;
            const assoc = (id: string) => (snap.edgesByNode.get(id) || []).filter(e => e.type === 'ASSOCIATION').length;
            if (sortKey === 'id') return String(a.id).localeCompare(String(b.id));
            if (sortKey === 'assoc') return assoc(b.id as string) - assoc(a.id as string) || String(a.label).localeCompare(String(b.label));
            if (sortKey === 'module') {
                return String(a.moduleFamily || '').localeCompare(String(b.moduleFamily || ''))
                    || String(a.label).localeCompare(String(b.label));
            }
            return String(a.label || a.id).localeCompare(String(b.label || b.id));
        },
        cardRenderer: (node, snap) => {
            const assocCount = (snap.edgesByNode.get(node.id) || []).filter(e => e.type === 'ASSOCIATION').length;
            const classBadge = node.objectClass ? `<span class="explorer-badge explorer-badge--class">${escapeHtml(node.objectClass)}</span>` : '';
            const modBadge = node.moduleLabel || node.moduleFamily ? `<span class="explorer-badge explorer-badge--module">${escapeHtml(node.moduleLabel || node.moduleFamily)}</span>` : '';
            return renderExplorerCard(pane, node, 'mdf', `${classBadge}${modBadge}<span class="explorer-card-count">${assocCount} assoc.</span>`);
        }
    });
}

function ruleTouchesModule(ruleId: string, moduleFamily: string, snap: ReturnType<typeof exploreSnapshot>): boolean {
    const edges = snap.edgesByNode.get(ruleId) || [];
    for (const e of edges) {
        const other = e.from === ruleId ? e.to : e.from;
        const on = snap.nodeById.get(other as string);
        if (on?.type === 'MDF_OBJECT' && (on.moduleFamily || 'Unclassified') === moduleFamily) return true;
    }
    return false;
}

function renderRulesExplorer(
    q: any,
    meta: ExploreMeta,
    pane: ExplorePane = 'left',
    prep: PreparedInstanceModel | null = null
) {
    const objectCountFor = (ruleId: string, snap: ExploreSnapshot) => {
        const connectedEdges = snap.edgesByNode.get(ruleId) || [];
        return new Set(connectedEdges.flatMap(e => [e.from, e.to]).filter(id => {
            const n = snap.nodeById.get(id as string);
            return n && n.type === 'MDF_OBJECT';
        })).size;
    };
    renderExploreEntities({
        pane,
        prep,
        query: q,
        meta,
        sourceNodes: snap => snap.allNodes.filter(n => n.type === 'BUSINESS_RULE'),
        filterPredicate: (node, snap) =>
            S.exploreModuleFilter === 'ALL' || ruleTouchesModule(node.id as string, S.exploreModuleFilter, snap),
        queryText: node => `${node.id} ${node.label || ''}`,
        sortNodes: (a, b, snap) => {
            const sortKey = S.exploreSort;
            if (sortKey === 'id') return String(a.id).localeCompare(String(b.id));
            if (sortKey === 'objects') {
                return objectCountFor(b.id as string, snap) - objectCountFor(a.id as string, snap)
                    || String(a.label).localeCompare(String(b.label));
            }
            return String(a.label || a.id).localeCompare(String(b.label || b.id));
        },
        cardRenderer: (node, snap) => {
            const objectCount = objectCountFor(node.id as string, snap);
            return renderExplorerCard(pane, node, 'rule', `<span class="explorer-badge explorer-badge--rule">Rule</span><span class="explorer-card-count">${objectCount} object${objectCount !== 1 ? 's' : ''}</span>`);
        }
    });
}

function renderRolesExplorer(
    q: any,
    meta: ExploreMeta,
    pane: ExplorePane = 'left',
    prep: PreparedInstanceModel | null = null
) {
    const permissionCountFor = (roleId: string, snap: ExploreSnapshot) => (snap.roleObjectByRole.get(roleId) || []).length;
    renderExploreEntities({
        pane,
        prep,
        query: q,
        meta,
        sourceNodes: snap => snap.allNodes.filter(n => n.type === 'RBP_ROLE'),
        filterPredicate: (role, snap) =>
            S.exploreModuleFilter === 'ALL' ||
            (snap.roleObjectByRole.get(role.id) || []).some(p => (p.objectNode?.moduleFamily || 'Unclassified') === S.exploreModuleFilter),
        queryText: node => `${node.id} ${node.label || ''}`,
        sortNodes: (a, b, snap) => {
            const sortKey = S.exploreSort;
            if (sortKey === 'id') return String(a.id).localeCompare(String(b.id));
            if (sortKey === 'perms') return permissionCountFor(b.id as string, snap) - permissionCountFor(a.id as string, snap) || String(a.label).localeCompare(String(b.label));
            return String(a.label || a.id).localeCompare(String(b.label || b.id));
        },
        cardRenderer: (node, snap) => {
            const permCount = permissionCountFor(node.id, snap);
            const sysCount = (snap.roleSystemByRole.get(node.id) || []).length;
            return renderExplorerCard(pane, node, 'role', `<span class="explorer-badge explorer-badge--role">Role</span><span class="explorer-card-count">${permCount} obj perm${permCount !== 1 ? 's' : ''}</span>${sysCount > 0 ? `<span class="explorer-card-count">${sysCount} sys perm${sysCount !== 1 ? 's' : ''}</span>` : ''}`);
        }
    });
}

function renderODataExplorer(
    q: any,
    meta: ExploreMeta,
    pane: ExplorePane = 'left',
    prep: PreparedInstanceModel | null = null
) {
    renderExploreEntities({
        pane,
        prep,
        query: q,
        meta,
        sourceNodes: snap => snap.allNodes.filter(n => n.type === 'ODATA_ENTITY'),
        filterPredicate: node =>
            (S.exploreNamespaceFilter === 'ALL' || node.namespace === S.exploreNamespaceFilter) &&
            (S.exploreModuleFilter === 'ALL' || node.moduleFamily === S.exploreModuleFilter),
        queryText: node => `${node.id} ${node.label || ''} ${node.namespace || ''}`,
        sortNodes: (a, b) => {
            const sortKey = S.exploreSort;
            if (sortKey === 'id') return String(a.id).localeCompare(String(b.id));
            if (sortKey === 'ns') {
                return String(a.namespace || '').localeCompare(String(b.namespace || ''))
                    || String(a.label).localeCompare(String(b.label));
            }
            return String(a.label || a.id).localeCompare(String(b.label || b.id));
        },
        cardRenderer: (node, snap) => {
            const exposesEdge = (snap.edgesByNode.get(node.id) || []).find(e => e.type === 'EXPOSES');
            const linkedObj = exposesEdge ? snap.nodeById.get(exposesEdge.from === node.id ? exposesEdge.to : exposesEdge.from) : null;
            const linkedBadge = linkedObj ? `<span class="explorer-badge explorer-badge--mdf">${escapeHtml(linkedObj.label || linkedObj.id)}</span>` : '';
            const nsBadge = node.namespace ? `<span class="explorer-badge explorer-badge--class">${escapeHtml(node.namespace)}</span>` : '';
            return renderExplorerCard(pane, node, 'odata', `<span class="explorer-badge explorer-badge--odata">OData</span>${nsBadge}${linkedBadge}`);
        }
    });
}

export function bindExploreControls() {
    ensureExploreGlobalDelegation();

    document.getElementById('explore-popover-list')?.addEventListener('item-click', event => {
        const d = (event as CustomEvent<{ item?: HTMLElement }>).detail;
        const view = d?.item?.dataset?.exploreView;
        if (view) {
            if (view === 'workflows') setActiveWorkspace('workflows');
            else {
                S.activeExploreView = view;
                exploreControlOptionsBuiltFor = '';
                setActiveWorkspace('explore');
            }
        }
        const ep = document.getElementById('explore-popover') as any;
        if (ep) ep.open = false;
    });

    document.querySelectorAll('.explore-subnav-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            const view = (pill as HTMLElement).dataset?.exploreView ?? '';
            if (view === 'workflows') {
                setActiveWorkspace('workflows');
                return;
            }
            S.activeExploreView = view;
            S.currentExploreQuery = '';
            S.exploreSort = 'label';
            patchAppState({ exploreLeftSelection: null, exploreRightSelection: null });
            const searchInput = document.getElementById('explore-search') as HTMLInputElement | null;
            if (searchInput) searchInput.value = '';
            const searchRight = document.getElementById('explore-search-right') as HTMLInputElement | null;
            if (searchRight) searchRight.value = '';
            refreshWorkspace();
        });
    });

    const onExploreSearchInput = (event: Event) => {
        S.currentExploreQuery = (event.target as HTMLInputElement).value.trim().toLowerCase();
        const a = document.getElementById('explore-search') as HTMLInputElement | null;
        const b = document.getElementById('explore-search-right') as HTMLInputElement | null;
        if (event.target === a && b) b.value = S.currentExploreQuery;
        if (event.target === b && a) a.value = S.currentExploreQuery;
        renderExploreWorkspace();
    };
    document.getElementById('explore-search')?.addEventListener('input', onExploreSearchInput);
    document.getElementById('explore-search-right')?.addEventListener('input', onExploreSearchInput);

    const readUi5OrSelectValue = (el: EventTarget | null): string => {
        if (!el || !(el instanceof HTMLElement)) return '';
        if (el instanceof HTMLSelectElement) return el.value;
        return String((el as HTMLElement & { value?: string }).value ?? '');
    };
    const bindExploreSelect = (id: string, apply: (v: string) => void) => {
        document.getElementById(id)?.addEventListener('change', e => {
            apply(readUi5OrSelectValue(e.target));
            renderExploreWorkspace();
        });
    };
    bindExploreSelect('explore-sort', v => { S.exploreSort = v; });
    bindExploreSelect('explore-sort-right', v => { S.exploreSort = v; });
    bindExploreSelect('explore-module-filter', v => { S.exploreModuleFilter = v; });
    bindExploreSelect('explore-module-filter-right', v => { S.exploreModuleFilter = v; });
    bindExploreSelect('explore-class-filter', v => { S.exploreObjectClassFilter = v; });
    bindExploreSelect('explore-class-filter-right', v => { S.exploreObjectClassFilter = v; });
    bindExploreSelect('explore-ns-filter', v => { S.exploreNamespaceFilter = v; });
    bindExploreSelect('explore-ns-filter-right', v => { S.exploreNamespaceFilter = v; });
    const bindDeep = (id: string) => {
        document.getElementById(id)?.addEventListener('change', e => {
            S.exploreDeepSearch = (e.target as HTMLInputElement).checked;
            const other = id === 'explore-deep-search' ? 'explore-deep-search-right' : 'explore-deep-search';
            const o = document.getElementById(other) as HTMLInputElement | null;
            if (o) o.checked = S.exploreDeepSearch;
            renderExploreWorkspace();
        });
    };
    bindDeep('explore-deep-search');
    bindDeep('explore-deep-search-right');

    document.getElementById('toolbar-open-search')?.addEventListener('click', () => {
        S.exploreDeepSearch = true;
        setActiveWorkspace('explore');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const inp = document.getElementById('explore-search') as HTMLInputElement | null;
                (document.getElementById('explore-deep-search') as HTMLInputElement | null)!.checked = true;
                inp?.focus();
            });
        });
    });

    document.getElementById('explore-detail-close-left')?.addEventListener('click', () => {
        patchAppState({ exploreLeftSelection: null });
        refreshWorkspace();
    });
    document.getElementById('explore-detail-close-right')?.addEventListener('click', () => {
        patchAppState({ exploreRightSelection: null });
        refreshWorkspace();
    });
}
