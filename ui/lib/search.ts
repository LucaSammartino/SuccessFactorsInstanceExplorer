import { appState as S } from './store';
import type { AnyNode, RoleObjPerm, RoleSysPerm, SearchEntry, ApplySearchOptions } from './types';
import { escapeHtml, escapeAttribute, formatType } from './utils';
import { clearGraphFocus, setGraphFocusNode } from './node-selection';
import { refreshWorkspace, renderWorkspaceTabs } from './workspace';
import { deactivateRbpFlowMode } from './view-kind';

/** Build search index from graph permission data (used by `buildPreparedInstanceModel` and `buildSearchEntries`). */
export function buildSearchEntriesFromGraph(
    allNodes: AnyNode[],
    roleSystemPermissions: RoleSysPerm[],
    roleObjectPermissions: RoleObjPerm[]
): SearchEntry[] {
    const entries: SearchEntry[] = [];
    let index = 0;

    allNodes.forEach(node => {
        entries.push({
            index: index++,
            kind: formatType(node.type),
            nodeId: node.id,
            label: (node.label || node.id) as string,
            subtitle: `${node.moduleLabel || node.moduleFamily} · ${formatType(node.type)}${node.objectClass ? ` · ${node.objectClass}` : ''}`,
            searchText: `${node.searchText || ''}`.toLowerCase()
        });

        ((node.attributes || []) as any[]).forEach(field => {
            entries.push({
                index: index++,
                kind: 'Field',
                nodeId: node.id,
                label: field.name,
                subtitle: `${node.label} · ${field.type || 'Field'}`,
                fieldName: field.name,
                searchText: `${field.name} ${field.type || ''} ${field.visibility || ''} ${node.searchText || ''}`.toLowerCase()
            });
        });

        (((node.corporateDataModel as any)?.fields || []) as any[]).forEach(field => {
            entries.push({
                index: index++,
                kind: 'Field',
                nodeId: node.id,
                label: field.label || field.id,
                subtitle: `${node.label} · Corporate Data Model`,
                fieldName: field.id || field.label,
                searchText: `${field.id || ''} ${field.label || ''} ${field.visibility || ''} ${field.type || ''} ${node.searchText || ''}`.toLowerCase()
            });
        });

        ((node.countryOverrides || []) as any[]).forEach((override: any) => {
            (override.fields || []).forEach((field: any) => {
                entries.push({
                    index: index++,
                    kind: 'Field',
                    nodeId: node.id,
                    label: field.label || field.id,
                    subtitle: `${node.label} · ${override.countryCode} override`,
                    fieldName: field.id || field.label,
                    searchText: `${field.id || ''} ${field.label || ''} ${override.countryCode} ${field.visibility || ''} ${node.searchText || ''}`.toLowerCase()
                });
            });
        });
    });

    roleSystemPermissions.forEach(permission => {
        entries.push({
            index: index++,
            kind: 'Permission',
            nodeId: permission.roleId,
            label: permission.permission,
            subtitle: `${permission.roleId} · ${(permission.categories || []).join(', ') || 'System Permission'}`,
            permissionName: permission.permission,
            searchText: `${permission.searchText || ''}`.toLowerCase()
        });
    });

    roleObjectPermissions.forEach(permission => {
        entries.push({
            index: index++,
            kind: 'Permission',
            nodeId: permission.objectId,
            label: `${permission.objectId} · ${permission.permissions.join(', ')}`,
            subtitle: permission.roleId,
            permissionName: permission.permissions.join(', '),
            searchText: `${permission.searchText || ''}`.toLowerCase()
        });
    });

    return entries;
}

export function buildSearchEntries() {
    return buildSearchEntriesFromGraph(S.allNodes, S.roleSystemPermissions, S.roleObjectPermissions);
}

export function scoreSearchResult(entry: SearchEntry, query: string): number {
    const label = entry.label.toLowerCase();
    const subtitle = entry.subtitle.toLowerCase();
    const haystack = entry.searchText;

    if (!haystack.includes(query) && !label.includes(query) && !subtitle.includes(query)) {
        return 0;
    }

    let score = 5;
    if (label === query) score += 120;
    else if (label.startsWith(query)) score += 90;
    else if (label.includes(query)) score += 60;

    if (subtitle.includes(query)) score += 18;
    if (entry.kind === 'Field') score += 8;
    if (entry.kind === 'Permission') score += 4;
    return score;
}

export function searchKindClass(kind: string): string {
    const map: Record<string, string> = {
        'Object': 'sk-object',
        'Business Rule': 'sk-rule',
        'RBP Role': 'sk-role',
        'OData Entity': 'sk-odata',
        'Field': 'sk-field',
        'Permission': 'sk-permission',
    };
    return map[kind] || 'sk-other';
}

export function updateSearchResults() {
    if (!S.currentQuery) {
        S.currentSearchResults = [];
        renderSearchResults();
        refreshWorkspace();
        return;
    }

    const query = S.currentQuery.toLowerCase();
    S.currentSearchResults = S.searchEntries
        .map(entry => ({ ...entry, score: scoreSearchResult(entry, query) }))
        .filter(entry => entry.score > 0)
        .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
        .slice(0, 18);

    renderSearchResults();
}

export function renderSearchResults() {
    const container = document.getElementById('search-results-panel');
    if (!container) return;

    if (!S.currentQuery) {
        container.innerHTML = '<div class="empty-mini">Start typing to search fields, objects, rules, roles, or permissions.</div>';
        return;
    }

    if (S.currentSearchResults.length === 0) {
        container.innerHTML = `<div class="empty-mini">No matches for "${escapeHtml(S.currentQuery)}".</div>`;
        return;
    }

    const kindOrder = ['Object', 'Business Rule', 'RBP Role', 'OData Entity', 'Field', 'Permission'];
    const facetCounts: Record<string, number> = {};
    S.currentSearchResults.forEach(r => { facetCounts[r.kind] = (facetCounts[r.kind] || 0) + 1; });
    const facets = kindOrder.filter(k => Boolean(facetCounts[k]));

    const filtered = S.currentSearchFacet
        ? S.currentSearchResults.filter(r => r.kind === S.currentSearchFacet)
        : S.currentSearchResults;

    const facetHtml = facets.length > 1 ? `
        <div class="search-facets">
            <button class="search-facet-chip${!S.currentSearchFacet ? ' active' : ''}" data-facet="">All <span class="search-facet-count">${S.currentSearchResults.length}</span></button>
            ${facets.map(k => `
                <button class="search-facet-chip${S.currentSearchFacet === k ? ' active' : ''}" data-facet="${escapeAttribute(k)}" data-kind="${escapeAttribute(k)}">
                    ${escapeHtml(k)} <span class="search-facet-count">${facetCounts[k]}</span>
                </button>
            `).join('')}
        </div>` : '';

    const cardsHtml = filtered.map(result => {
        const kindClass = searchKindClass(result.kind);
        return `
            <div class="search-result-card ${kindClass}" data-search-index="${result.index}">
                <div class="search-result-card-content">
                    <div class="search-result-card-top">
                        <div class="search-result-title">${escapeHtml(result.label)}</div>
                        <span class="search-result-type ${kindClass}-badge">${escapeHtml(result.kind)}</span>
                    </div>
                    <div class="search-result-subtitle">${escapeHtml(result.subtitle)}</div>
                </div>
            </div>`;
    }).join('');

    container.innerHTML = facetHtml + `<div class="search-result-list">${cardsHtml}</div>`;

    container.querySelectorAll('[data-search-index]').forEach(item => {
        item.addEventListener('click', () => {
            const result = S.currentSearchResults.find(entry => `${entry.index}` === item.getAttribute('data-search-index'));
            if (result) applySearchResult(result);
        });
    });

    container.querySelectorAll('.search-facet-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            S.currentSearchFacet = btn.getAttribute('data-facet') || null;
            renderSearchResults();
        });
    });
}

export function applySearchResult(result: SearchEntry, options: ApplySearchOptions = {}) {
    const node = S.nodeById.get(result.nodeId);
    if (!node) return;

    const appendFocus = Boolean(options.appendFocus);

    S.activeWorkspace = 'graph';
    if (S.currentViewKind === 'rbp-flow') {
        deactivateRbpFlowMode();
    }
    renderWorkspaceTabs();
    if (location.hash !== '#graph') {
        history.replaceState(null, '', `${location.pathname}${location.search}#graph`);
    }

    S.currentWorkflowCode = null;
    S.currentSelection = {
        nodeId: result.nodeId,
        type: result.kind,
        fieldName: result.fieldName,
        permissionName: result.permissionName,
        fromSearch: true
    };

    if (appendFocus) {
        S.currentSelection = null;
        setGraphFocusNode(node.id, { append: true });
        S.focusRequestId = node.id;
        if (options.fromGraphFinder) {
            S.currentGraphFinderQuery = '';
            S.currentGraphFinderResults = [];
            const graphFinderInput = document.getElementById('graph-finder-input');
            if (graphFinderInput) (graphFinderInput as HTMLInputElement).value = '';
            hideGraphFinderResults();
        }
        refreshWorkspace();
        return;
    }

    if (node.moduleFamily && node.moduleFamily !== 'Unclassified') {
        S.currentModule = node.moduleFamily as string;
        S.currentSubModule = node.subModule && node.subModule !== 'Unclassified' ? node.subModule as string : 'ALL';
        if (S.currentView === 'RBP_ROLE') {
            setGraphFocusNode(node.id);
        } else {
            clearGraphFocus();
        }
    } else {
        S.currentSubModule = 'ALL';
        setGraphFocusNode(node.id);
    }

    S.focusRequestId = node.id;
    refreshWorkspace();
}

export function updateGraphFinderResults() {
    if (!S.currentGraphFinderQuery) {
        S.currentGraphFinderResults = [];
        hideGraphFinderResults();
        return;
    }

    const query = S.currentGraphFinderQuery.toLowerCase();
    const nodeKinds = new Set(['Object', 'Business Rule', 'RBP Role', 'OData Entity']);
    S.currentGraphFinderResults = S.searchEntries
        .map(entry => ({ ...entry, score: scoreSearchResult(entry, query) }))
        .filter(entry => entry.score > 0 && S.nodeById.has(entry.nodeId) && nodeKinds.has(entry.kind))
        .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
        .slice(0, 8);

    renderGraphFinderResults();
}

export function renderGraphFinderResults() {
    const container = document.getElementById('graph-finder-results');
    if (!container) return;

    if (S.currentGraphFinderResults.length === 0) {
        container.innerHTML = '<div class="perm-filter-empty">No matching nodes.</div>';
        container.classList.remove('hidden');
        return;
    }

    container.innerHTML = S.currentGraphFinderResults.map(result => {
        const kindClass = searchKindClass(result.kind);
        return `
            <button type="button" class="graph-finder-option" data-search-index="${result.index}">
                <div class="graph-finder-option-main">
                    <div class="graph-finder-option-label">${escapeHtml(result.label)}</div>
                    <div class="graph-finder-option-meta">${escapeHtml(result.subtitle)}</div>
                </div>
                <span class="search-result-type ${kindClass}-badge">${escapeHtml(result.kind)}</span>
            </button>`;
    }).join('');

    container.querySelectorAll('[data-search-index]').forEach(item => {
        item.addEventListener('click', () => {
            const result = S.currentGraphFinderResults.find(entry => `${entry.index}` === item.getAttribute('data-search-index'));
            if (result) applySearchResult(result, { appendFocus: true, fromGraphFinder: true });
        });
    });

    container.classList.remove('hidden');
}

export function hideGraphFinderResults() {
    const container = document.getElementById('graph-finder-results');
    if (!container) return;
    container.classList.add('hidden');
}

/* ═══════════════════════════════════════════════════════════════════════════
   PER-PANE GRAPH SEARCH (split compare)
   ═══════════════════════════════════════════════════════════════════════════ */

type GraphPane = 'left' | 'right';

function searchEntriesForPane(pane: GraphPane): SearchEntry[] {
    if (pane === 'right' && S.compareTargetPrepared) {
        return S.compareTargetPrepared.searchEntries;
    }
    return S.searchEntries;
}

function nodeByIdForPane(pane: GraphPane): Map<string, any> {
    if (pane === 'right' && S.compareTargetPrepared) {
        return S.compareTargetPrepared.nodeById;
    }
    return S.nodeById;
}

export function updatePaneSearchResults(pane: GraphPane) {
    const queryKey = pane === 'left' ? 'paneSearchQueryLeft' : 'paneSearchQueryRight';
    const resultsKey = pane === 'left' ? 'paneSearchResultsLeft' : 'paneSearchResultsRight';
    const query = S[queryKey];

    if (!query) {
        (S as any)[resultsKey] = [];
        renderPaneSearchResults(pane);
        return;
    }

    const q = query.toLowerCase();
    const nodeKinds = new Set(['Object', 'Business Rule', 'RBP Role', 'OData Entity']);
    const entries = searchEntriesForPane(pane);
    const nodeMap = nodeByIdForPane(pane);
    const results = entries
        .map(entry => ({ ...entry, score: scoreSearchResult(entry, q) }))
        .filter(entry => entry.score > 0 && nodeMap.has(entry.nodeId) && nodeKinds.has(entry.kind))
        .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
        .slice(0, 8);

    (S as any)[resultsKey] = results;
    renderPaneSearchResults(pane);
}

export function renderPaneSearchResults(pane: GraphPane) {
    const containerId = `graph-pane-search-results-${pane}`;
    const container = document.getElementById(containerId);
    if (!container) return;

    const results: SearchEntry[] = pane === 'left' ? S.paneSearchResultsLeft : S.paneSearchResultsRight;
    const query = pane === 'left' ? S.paneSearchQueryLeft : S.paneSearchQueryRight;

    if (!query) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    if (results.length === 0) {
        container.innerHTML = '<div class="perm-filter-empty">No matching nodes.</div>';
        container.classList.remove('hidden');
        return;
    }

    container.innerHTML = results.map(result => {
        const kindClass = searchKindClass(result.kind);
        return `
            <button type="button" class="graph-finder-option" data-pane-search-index="${result.index}" data-pane-search-pane="${pane}">
                <div class="graph-finder-option-main">
                    <div class="graph-finder-option-label">${escapeHtml(result.label)}</div>
                    <div class="graph-finder-option-meta">${escapeHtml(result.subtitle)}</div>
                </div>
                <span class="search-result-type ${kindClass}-badge">${escapeHtml(result.kind)}</span>
            </button>`;
    }).join('');

    container.querySelectorAll('[data-pane-search-index]').forEach(item => {
        item.addEventListener('click', () => {
            const idx = item.getAttribute('data-pane-search-index');
            const result = results.find(e => `${e.index}` === idx);
            if (result) applyPaneSearchResult(pane, result);
        });
    });

    container.classList.remove('hidden');
}

export function applyPaneSearchResult(pane: GraphPane, result: SearchEntry) {
    const nodeMap = nodeByIdForPane(pane);
    const node = nodeMap.get(result.nodeId);
    if (!node) return;

    if (pane === 'left') {
        // Navigate the left/base graph
        applySearchResult(result, { appendFocus: true, fromGraphFinder: true });
    } else {
        // Navigate the right/target graph — set the target focus node
        // and trigger a right-pane re-render
        const { patchAppState } = await_store();
        S.compareTargetGraphFocusNodeId = node.id;
        // Clear right search
        S.paneSearchQueryRight = '';
        S.paneSearchResultsRight = [];
        const input = document.getElementById('graph-pane-search-input-right') as HTMLInputElement | null;
        if (input) input.value = '';
        hidePaneSearchResults('right');

        void import('./graph-render').then(({ markRightGraphDirty }) => {
            markRightGraphDirty();
            void import('./workspace').then(m => m.refreshCompareTargetGraphPane());
        });
    }
}

function await_store() {
    // Helper to access patchAppState without circular import
    return { patchAppState: (next: any) => Object.assign(S, next) };
}

export function hidePaneSearchResults(pane: GraphPane) {
    const container = document.getElementById(`graph-pane-search-results-${pane}`);
    if (!container) return;
    container.classList.add('hidden');
}
