import { compareState } from './index';
import { escapeHtml } from '../utils';

const detailCache = new Map<string, { base: any; target: any }>();

const SEARCH_ONLY_KEYS = new Set([
    'searchText',
    'searchTextLower',
    'searchIndex',
    'searchTokens',
    '_searchText',
]);

const TECHNICAL_PRIMARY_KEYS = new Set([
    'attributes',
    'corporateDataModel',
    'countryOverrides',
    'raw',
    'rawRecord',
    'source',
    'sources',
    'metadata',
]);

const BUSINESS_KEY_ORDER = [
    'id',
    'label',
    'type',
    'moduleFamily',
    'moduleLabel',
    'subModule',
    'objectClass',
    'objectTechnology',
    'permissionCategory',
    'isSecured',
    'odataExposed',
    'namespace',
    'creatable',
    'updatable',
    'deletable',
    'upsertable',
    'description',
];

export function clearCompareDetailCache() {
    detailCache.clear();
}

export async function renderDetailPanel(nodeId: string | null, roleContext: any | null) {
    const mount = document.getElementById('compare-detail-mount');
    if (!mount) return;

    if (!nodeId) {
        mount.innerHTML = '';
        mount.style.display = 'none';
        return;
    }

    mount.style.display = 'block';
    mount.innerHTML = '<div class="compare-detail-loading">Loading details...</div>';

    const cacheKey = `${compareState.baseId ?? ''}\0${compareState.targetId ?? ''}\0${nodeId}`;
    let detail = detailCache.get(cacheKey);
    if (!detail) {
        try {
            const res = await fetch(`/api/projects/${compareState.baseId}/compare/${compareState.targetId}/nodes/${nodeId}`);
            if (!res.ok) throw new Error(await res.text());
            detail = await res.json();
            detailCache.set(cacheKey, detail as any);
        } catch (e) {
            mount.innerHTML = `<div class="compare-detail-error">Failed to load details: ${escapeHtml(String(e))}</div>`;
            return;
        }
    }

    const type = detail?.base?.type || detail?.target?.type;

    let html = '';
    if (type === 'RBP_ROLE' || roleContext) {
        html = renderRolePanel(detail?.base, detail?.target, roleContext);
    } else if (type === 'MDF_OBJECT') {
        html = renderMdfPanel(detail?.base, detail?.target);
    } else {
        html = renderGenericPanel(detail?.base, detail?.target);
    }

    mount.innerHTML = `
        <div class="compare-detail-card">
            ${html}
        </div>
    `;

    const handleEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            import('./entity-panel').then(({ setSelectedEntityRow, renderEntityPanel }) => {
                setSelectedEntityRow(null);
                renderEntityPanel();
                import('./search-bar').then(m => m.renderSearchBar());
            });
            document.removeEventListener('keydown', handleEsc);
        }
    };
    document.addEventListener('keydown', handleEsc);
}

function dumpJsonAttr(side: any, key: string): string {
    if (!side || side[key] === undefined) return '<span class="compare-muted">-</span>';
    const val = side[key];
    if (val === null) return '<code>null</code>';
    if (Array.isArray(val)) return `<span class="compare-muted">${val.length} item${val.length === 1 ? '' : 's'}</span>`;
    if (typeof val !== 'object') return escapeHtml(String(val));
    return `<pre class="compare-technical-json">${escapeHtml(JSON.stringify(val, null, 2))}</pre>`;
}

function getChangedKeys(nodeId: string): string[] {
    // Look up the node in the changed lists to find what to highlight
    const res = compareState.result;
    if (!res) return [];
    
    // Check nodes
    const foundNode = res.nodes.changed.find((n: any) => n.id === nodeId);
    if (foundNode) return foundNode.changedKeys || [];
    
    // Check edges
    const foundEdge = res.edges.changed.find((e: any) => e.id === nodeId);
    if (foundEdge) return foundEdge.changedKeys || [];
    
    return [];
}

function isSearchOnlyKey(key: string): boolean {
    const normalized = key.toLowerCase();
    return SEARCH_ONLY_KEYS.has(key) || normalized.includes('searchtext') || normalized.startsWith('_search');
}

function keyOrder(key: string): number {
    const idx = BUSINESS_KEY_ORDER.indexOf(key);
    return idx >= 0 ? idx : BUSINESS_KEY_ORDER.length + 1;
}

function sortBusinessKeys(keys: string[]) {
    return keys.sort((a, b) => keyOrder(a) - keyOrder(b) || a.localeCompare(b));
}

function buildCompareKeyGroups(base: any, target: any, changedKeys: Set<string>, skipAttributes = false) {
    const allKeys = new Set<string>();
    if (base) Object.keys(base).forEach(k => allKeys.add(k));
    if (target) Object.keys(target).forEach(k => allKeys.add(k));
    if (skipAttributes) allKeys.delete('attributes');

    const primary: string[] = [];
    const technical: string[] = [];

    for (const key of allKeys) {
        if (isSearchOnlyKey(key)) continue;
        const existsOnlyOnOneSide = !base || !target || base[key] === undefined || target[key] === undefined;
        const changed = changedKeys.has(key) || existsOnlyOnOneSide;
        if (!changed) continue;

        if (TECHNICAL_PRIMARY_KEYS.has(key) || (typeof base?.[key] === 'object' && typeof target?.[key] === 'object')) {
            technical.push(key);
        } else {
            primary.push(key);
        }
    }

    return {
        primary: sortBusinessKeys(primary),
        technical: sortBusinessKeys(technical),
    };
}

function rowStatusClass(base: any, target: any, key: string, changedKeys: Set<string>): string {
    if (!base && target) return 'compare-diff-row--added';
    if (base && !target) return 'compare-diff-row--removed';
    if (base?.[key] === undefined && target?.[key] !== undefined) return 'compare-diff-row--added';
    if (base?.[key] !== undefined && target?.[key] === undefined) return 'compare-diff-row--removed';
    if (changedKeys.has(key)) return 'compare-diff-row--changed';
    return '';
}

function renderDiffRows(base: any, target: any, keys: string[], changedKeys: Set<string>): string {
    return keys
        .map(key => `
            <div class="compare-diff-row ${rowStatusClass(base, target, key, changedKeys)}">
                <div class="compare-diff-attr">${escapeHtml(key)}</div>
                <div class="compare-diff-cell">${dumpJsonAttr(base, key)}</div>
                <div class="compare-diff-cell">${dumpJsonAttr(target, key)}</div>
            </div>
        `)
        .join('');
}

function renderDiffTable(base: any, target: any, keys: string[], changedKeys: Set<string>, emptyText: string): string {
    if (!keys.length) return `<p class="empty-mini">${escapeHtml(emptyText)}</p>`;
    return `
        <div class="compare-diff-table">
            <div class="compare-diff-head">
                <div>Attribute</div>
                <div>Base</div>
                <div>Target</div>
            </div>
            ${renderDiffRows(base, target, keys, changedKeys)}
        </div>
    `;
}

function renderGenericPanel(base: any, target: any, skipAttributes = false) {
    const title = (target?.label ?? base?.label) || (target?.id ?? base?.id);
    const type = target?.type ?? base?.type;
    const changedKeys = new Set(getChangedKeys(target?.id ?? base?.id));
    const groups = buildCompareKeyGroups(base, target, changedKeys, skipAttributes);

    return `
        <section class="compare-detail-section-card">
            <div class="compare-detail-section-head">
                <div>
                    <h3>${escapeHtml(title)}</h3>
                    <p>${escapeHtml(type)} comparison</p>
                </div>
            </div>
            ${renderDiffTable(base, target, groups.primary, changedKeys, 'No consultant-facing attribute changes on this entity.')}
            ${groups.technical.length
                ? `<details class="compare-technical-details"><summary>Technical fields (${groups.technical.length})</summary>${renderDiffTable(base, target, groups.technical, changedKeys, 'No technical fields changed.')}</details>`
                : ''}
        </section>
    `;
}

function renderMdfPanel(base: any, target: any) {
    const id = target?.id ?? base?.id;
    const changedNode = compareState.result?.nodes.changed.find((n: any) => n.id === id);
    const delta = changedNode?.mdfFieldDelta;
    const genericHtml = renderGenericPanel(base, target, true);

    if (!delta) return genericHtml;

    const mkFieldRow = (field: string, status: string, diff: 'added' | 'removed' | 'changed') => `
        <div class="compare-field-row compare-diff-row--${diff}">
            <div class="compare-field-id">${escapeHtml(field)}</div>
            <div class="compare-field-status">${escapeHtml(status)}</div>
        </div>
    `;

    const addedHtml = delta.added.map((f: string) => mkFieldRow(f, 'Added in target', 'added')).join('');
    const removedHtml = delta.removed.map((f: string) => mkFieldRow(f, 'Removed from target', 'removed')).join('');
    const changedHtml = delta.changed.map((f: string) => mkFieldRow(f, 'Definition changed', 'changed')).join('');
    const fieldRows = addedHtml + removedHtml + changedHtml;

    return `
        <section class="compare-detail-section-card">
            <div class="compare-detail-section-head">
                <div>
                    <h3>Field changes</h3>
                    <p>${escapeHtml(target?.label ?? base?.label ?? id)} field-level delta</p>
                </div>
            </div>
            <div class="compare-field-table">
                <div class="compare-field-head"><div>Field</div><div>Status</div></div>
                ${fieldRows || '<p class="empty-mini">No field-level changes were detected.</p>'}
            </div>
        </section>
        ${genericHtml}
    `;
}

import { classifyPermissionType, normalizeFieldOverrideAccessLabel } from '../matrix/filters';

function renderRolePanel(base: any, target: any, deltaContext: any) {
    if (!deltaContext) {
        return renderGenericPanel(base, target); // fallback if no delta
    }

    const title = deltaContext.roleLabel || deltaContext.roleId;
    const totals = deltaContext.totals;

    // Object Verbs section
    const renderObjectVerbChips = () => {
        const added = deltaContext.objectVerbs.added;
        const removed = deltaContext.objectVerbs.removed;
        if (!added.length && !removed.length) return '';

        const byObj = new Map<string, { added: Set<string>, removed: Set<string> }>();
        added.forEach((a: any) => {
            if (!byObj.has(a.objectId)) byObj.set(a.objectId, { added: new Set(), removed: new Set() });
            byObj.get(a.objectId)!.added.add(a.verb);
        });
        removed.forEach((a: any) => {
            if (!byObj.has(a.objectId)) byObj.set(a.objectId, { added: new Set(), removed: new Set() });
            byObj.get(a.objectId)!.removed.add(a.verb);
        });

        const rows = Array.from(byObj.entries()).sort().map(([objId, verbs]) => {
            const addedChips = Array.from(verbs.added).sort().map(v => {
                const typeClass = classifyPermissionType(v);
                return `<span class="perm-token perm-token--object perm-token--${typeClass}" style="border: 2px solid var(--compare-added);">${escapeHtml(v)}</span>`;
            }).join('');
            const removedChips = Array.from(verbs.removed).sort().map(v => {
                const typeClass = classifyPermissionType(v);
                return `<span class="perm-token perm-token--object perm-token--${typeClass}" style="background: rgba(217, 48, 37, 0.1); border: 2px dashed var(--compare-removed); opacity: 0.8; text-decoration: line-through;">${escapeHtml(v)}</span>`;
            }).join('');
            
            return `
                <div style="display:flex; align-items:center; margin-bottom: 0.5rem; gap: 1rem;">
                    <div style="width:250px; font-weight:500; font-size:0.875rem;">${escapeHtml(objId)}</div>
                    <div style="flex:1; display:flex; flex-wrap:wrap; gap:0.5rem;">${addedChips}${removedChips}</div>
                </div>
            `;
        }).join('');
        return `<section style="margin-bottom:2rem;"><h4 style="margin-bottom:1rem; border-bottom: 1px solid var(--ui5-list-border-color); padding-bottom: 0.5rem;">Object Verbs</h4>${rows}</section>`;
    };
    
    // Field Action Perms
    const renderFieldPermChips = () => {
        const added = deltaContext.fieldPerms.added;
        const removed = deltaContext.fieldPerms.removed;
        if (!added.length && !removed.length) return '';

        const byObj = new Map<string, { added: Set<string>, removed: Set<string> }>();
        added.forEach((a: any) => {
            if (!byObj.has(a.objectId)) byObj.set(a.objectId, { added: new Set(), removed: new Set() });
            byObj.get(a.objectId)!.added.add(a.verb);
        });
        removed.forEach((a: any) => {
            if (!byObj.has(a.objectId)) byObj.set(a.objectId, { added: new Set(), removed: new Set() });
            byObj.get(a.objectId)!.removed.add(a.verb);
        });

        const rows = Array.from(byObj.entries()).sort().map(([objId, verbs]) => {
            const addedChips = Array.from(verbs.added).sort().map(v => {
                const typeClass = classifyPermissionType(v);
                return `<span class="perm-token perm-token--field perm-token--${typeClass}" style="border: 2px solid var(--compare-added);">${escapeHtml(v)}</span>`;
            }).join('');
            const removedChips = Array.from(verbs.removed).sort().map(v => {
                const typeClass = classifyPermissionType(v);
                return `<span class="perm-token perm-token--field perm-token--${typeClass}" style="background: rgba(217, 48, 37, 0.1); border: 2px dashed var(--compare-removed); opacity: 0.8; text-decoration: line-through;">${escapeHtml(v)}</span>`;
            }).join('');
            
            return `
                <div style="display:flex; align-items:center; margin-bottom: 0.5rem; gap: 1rem;">
                    <div style="width:250px; font-weight:500; font-size:0.875rem;">${escapeHtml(objId)}</div>
                    <div style="flex:1; display:flex; flex-wrap:wrap; gap:0.5rem;">${addedChips}${removedChips}</div>
                </div>
            `;
        }).join('');
        return `<section style="margin-bottom:2rem;"><h4 style="margin-bottom:1rem; border-bottom: 1px solid var(--ui5-list-border-color); padding-bottom: 0.5rem;">Field Action Permissions</h4>${rows}</section>`;
    };
    
    // Field Overrides
    const renderOverrides = () => {
        const added = deltaContext.fieldOverrides.added;
        const removed = deltaContext.fieldOverrides.removed;
        const changed = deltaContext.fieldOverrides.changed;

        if (!added.length && !removed.length && !changed.length) return '';

        const byObj = new Map<string, Array<any>>();
        
        added.forEach((a: any) => {
            if (!byObj.has(a.objectId)) byObj.set(a.objectId, []);
            byObj.get(a.objectId)!.push({ ...a, _kind: 'added' });
        });
        removed.forEach((a: any) => {
            if (!byObj.has(a.objectId)) byObj.set(a.objectId, []);
            byObj.get(a.objectId)!.push({ ...a, _kind: 'removed' });
        });
        changed.forEach((c: any) => {
            if (!byObj.has(c.atom.objectId)) byObj.set(c.atom.objectId, []);
            byObj.get(c.atom.objectId)!.push({ ...c.atom, _kind: 'changed', _prev: c.previousValue });
        });

        const mkChip = (val: string) => {
            const typeClass = classifyPermissionType(val);
            const disp = normalizeFieldOverrideAccessLabel(val);
            return `<span class="perm-token perm-token--field perm-token--${typeClass}" style="display:inline-block">${escapeHtml(disp)}</span>`;
        };

        const rows = Array.from(byObj.entries()).sort().map(([objId, ops]) => {
            const trs = ops.map(op => {
                if (op._kind === 'added') {
                    return `<tr style="background: rgba(30, 142, 62, 0.05);"><td style="padding: 0.5rem; border-bottom: 1px solid var(--ui5-list-border-color);">${escapeHtml(op.field)}</td><td style="padding: 0.5rem; border-bottom: 1px solid var(--ui5-list-border-color); color:var(--ui5-text-color-secondary);">—</td><td style="padding: 0.5rem; border-bottom: 1px solid var(--ui5-list-border-color);">${mkChip(op.value)}</td><td style="padding: 0.5rem; border-bottom: 1px solid var(--ui5-list-border-color); color:var(--compare-added); font-weight:bold;">+ added</td></tr>`;
                }
                if (op._kind === 'removed') {
                    return `<tr style="background: rgba(217, 48, 37, 0.05);"><td style="padding: 0.5rem; border-bottom: 1px solid var(--ui5-list-border-color);">${escapeHtml(op.field)}</td><td style="padding: 0.5rem; border-bottom: 1px solid var(--ui5-list-border-color);">${mkChip(op.value)}</td><td style="padding: 0.5rem; border-bottom: 1px solid var(--ui5-list-border-color); color:var(--ui5-text-color-secondary);">—</td><td style="padding: 0.5rem; border-bottom: 1px solid var(--ui5-list-border-color); color:var(--compare-removed); font-weight:bold;">− removed</td></tr>`;
                }
                return `<tr style="background: rgba(242, 153, 0, 0.05);"><td style="padding: 0.5rem; border-bottom: 1px solid var(--ui5-list-border-color);">${escapeHtml(op.field)}</td><td style="padding: 0.5rem; border-bottom: 1px solid var(--ui5-list-border-color);">${mkChip(op._prev)}</td><td style="padding: 0.5rem; border-bottom: 1px solid var(--ui5-list-border-color);">${mkChip(op.value)}</td><td style="padding: 0.5rem; border-bottom: 1px solid var(--ui5-list-border-color); color:var(--compare-changed); font-weight:bold;">~ changed</td></tr>`;
            }).join('');

            return `
                <div style="margin-bottom: 1.5rem;">
                    <h5 style="margin:0 0 0.5rem 0; font-size: 0.875rem;">${escapeHtml(objId)}</h5>
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.875rem;">
                        <thead>
                            <tr style="background: var(--ui5-listitem-background-hover); text-align:left;">
                                <th style="padding: 0.5rem; border-bottom: 2px solid var(--ui5-list-border-color);">Field</th>
                                <th style="padding: 0.5rem; border-bottom: 2px solid var(--ui5-list-border-color);">Base</th>
                                <th style="padding: 0.5rem; border-bottom: 2px solid var(--ui5-list-border-color);">Target</th>
                                <th style="padding: 0.5rem; border-bottom: 2px solid var(--ui5-list-border-color);">Delta</th>
                            </tr>
                        </thead>
                        <tbody>${trs}</tbody>
                    </table>
                </div>
            `;
        }).join('');
        return `<section style="margin-bottom:2rem;"><h4 style="margin-bottom:1rem; border-bottom: 1px solid var(--ui5-list-border-color); padding-bottom: 0.5rem;">Field Overrides</h4>${rows}</section>`;
    };
    
    // System Perms
    const renderSysChips = () => {
        const added = deltaContext.systemPerms.added;
        const removed = deltaContext.systemPerms.removed;
        if (!added.length && !removed.length) return '';
        
        const addedChips = added.sort((a: any, b: any) => a.permission.localeCompare(b.permission)).map((a: any) => `<span class="perm-token perm-token--field perm-token--view" style="border: 2px solid var(--compare-added);">${escapeHtml(a.permission)}</span>`).join('');
        const removedChips = removed.sort((a: any, b: any) => a.permission.localeCompare(b.permission)).map((a: any) => `<span class="perm-token perm-token--field perm-token--view" style="background: rgba(217, 48, 37, 0.1); border: 2px dashed var(--compare-removed); opacity: 0.8; text-decoration: line-through;">${escapeHtml(a.permission)}</span>`).join('');
        
        return `<section style="margin-bottom:2rem;"><h4 style="margin-bottom:1rem; border-bottom: 1px solid var(--ui5-list-border-color); padding-bottom: 0.5rem;">System Permissions</h4><div style="display:flex; flex-wrap:wrap; gap:0.5rem;">${addedChips}${removedChips}</div></section>`;
    }

    let body = renderObjectVerbChips() + renderFieldPermChips() + renderOverrides() + renderSysChips();

    if (!body) body = '<p class="empty-mini">No direct permission changes for this role. (Changes might be structural attributes, see JSON below).</p>';

    const genericHtml = `<details style="margin-top:2rem;"><summary style="cursor:pointer; font-weight:bold; color:var(--ui5-text-color-secondary);">Show structural attribute diff</summary><div style="margin-top:1rem;">${renderGenericPanel(base, target)}</div></details>`;

    return `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 2rem;">
            <div>
                <h3 style="margin:0 0 0.5rem 0; font-size: 1.25rem;">${escapeHtml(title)}</h3>
                <span class="detail-badge">RBP_ROLE</span>
                <span class="detail-badge module">${escapeHtml(deltaContext.moduleFamily || 'Role-Based Permissions')}</span>
            </div>
            <div style="display:flex; gap:0.5rem; transform: scale(0.9); transform-origin: top right;">
                <div style="text-align:center; padding: 0.5rem 1rem; border: 1px solid var(--ui5-list-border-color); border-radius: 4px;">
                    <div style="font-weight:bold; color: var(--compare-added); font-size: 1.25rem;">+${totals.added}</div>
                    <div style="font-size:0.65rem; text-transform:uppercase;">added</div>
                </div>
                <div style="text-align:center; padding: 0.5rem 1rem; border: 1px solid var(--ui5-list-border-color); border-radius: 4px;">
                    <div style="font-weight:bold; color: var(--compare-changed); font-size: 1.25rem;">~${totals.changed}</div>
                    <div style="font-size:0.65rem; text-transform:uppercase;">changed</div>
                </div>
                <div style="text-align:center; padding: 0.5rem 1rem; border: 1px solid var(--ui5-list-border-color); border-radius: 4px;">
                    <div style="font-weight:bold; color: var(--compare-removed); font-size: 1.25rem;">−${totals.removed}</div>
                    <div style="font-size:0.65rem; text-transform:uppercase;">removed</div>
                </div>
            </div>
        </div>
        ${body}
        ${genericHtml}
    `;
}
