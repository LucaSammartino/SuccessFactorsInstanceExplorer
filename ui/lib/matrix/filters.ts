import { appState as S } from '../store';
import { escapeHtml, escapeAttribute } from '../utils';

export function normalizePermissionLabel(value: any) {
    return `${value || ''}`.trim();
}

export function classifyPermissionType(value: any) {
    const normalized = `${value || ''}`.toLowerCase();
    if (normalized.includes('view') || normalized.includes('read') || normalized.includes('history')) return 'view';
    if (normalized.includes('edit') || normalized.includes('write') || normalized.includes('correct') || normalized.includes('update')) return 'edit';
    if (normalized.includes('create') || normalized.includes('insert') || normalized.includes('add')) return 'create';
    if (normalized.includes('delete') || normalized.includes('remove') || normalized.includes('purge')) return 'delete';
    if (normalized.includes('approve') || normalized.includes('workflow') || normalized.includes('route')) return 'approve';
    return 'other';
}

export function buildPermissionFilterKey(source: any, label: any) {
    return `${source}::${label.toLowerCase()}`;
}

export function buildFieldNameFilterKey(name: any) {
    const normalized = normalizePermissionLabel(name);
    return `fieldname::${normalized.toLowerCase()}`;
}

export function normalizeFieldOverrideAccessLabel(value: any) {
    const normalized = normalizePermissionLabel(value);
    const lower = normalized.toLowerCase();
    if (lower === 'read only') return 'RO';
    if (lower === 'no access') return 'NA';
    if (lower === 'editable') return 'ED';
    return normalized;
}

export function parseFieldOverrideEntries(entry: any) {
    const fieldOverrides = Array.isArray(entry?.fieldOverrides) ? entry.fieldOverrides : [];
    const parsed: { field: string; value: string }[] = [];

    for (const override of fieldOverrides) {
        if (!override) continue;

        if (typeof override === 'string') {
            override
                .split(/\s*,\s*/)
                .map((segment: any) => segment.trim())
                .filter(Boolean)
                .forEach((segment: any) => {
                    const separatorIndex = segment.indexOf(':');
                    if (separatorIndex === -1) {
                        parsed.push({ field: segment, value: '' });
                        return;
                    }
                    const field = normalizePermissionLabel(segment.slice(0, separatorIndex));
                    const value = normalizePermissionLabel(segment.slice(separatorIndex + 1));
                    if (field || value) parsed.push({ field, value });
                });
            continue;
        }

        const field = normalizePermissionLabel(override.field || override.name || override.code || '');
        const value = normalizePermissionLabel(override.value || override.override || override.access || '');
        if (field || value) parsed.push({ field, value });
    }

    const seen = new Set();
    return parsed.filter((item: any) => {
        const key = `${item.field}::${item.value}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function parseFieldPermissionTokens(entry: any) {
    const fieldTokens: string[] = [];
    const fieldItems = Array.isArray(entry.fieldItems) ? entry.fieldItems : [];
    for (const item of fieldItems) {
        const token = normalizePermissionLabel(item?.permission || item?.permissionType || item?.actionType || item?.access || item?.fieldPermission);
        if (token) fieldTokens.push(token);
    }

    for (const override of parseFieldOverrideEntries(entry)) {
        const token = normalizePermissionLabel(override.value);
        if (token) fieldTokens.push(token);
    }

    return Array.from(new Set(fieldTokens));
}

export function collectFieldNameKeysFromRoleObjectEntry(entry: any) {
    const keys = new Set<string>();
    const items = Array.isArray(entry?.fieldItems) ? entry.fieldItems : [];
    for (const item of items) {
        const raw = item?.fieldName ?? item?.name ?? item?.field ?? item?.code ?? '';
        const name = normalizePermissionLabel(raw);
        if (name) keys.add(buildFieldNameFilterKey(name));
    }
    for (const fo of parseFieldOverrideEntries(entry)) {
        if (fo.field) keys.add(buildFieldNameFilterKey(fo.field));
    }
    return keys;
}

export function buildPermissionFilterChipHTML(kind: any, value: any, label: any, tone = 'default') {
    return `
        <span class="perm-filter-chip perm-filter-chip--${tone}">
            <span class="perm-filter-chip-label">${escapeHtml(label)}</span>
            <button type="button" class="perm-filter-chip-remove" data-filter-chip-remove="${kind}" data-chip-value="${escapeAttribute(value)}" aria-label="Remove ${escapeAttribute(label)}">×</button>
        </span>
    `;
}

export function compareFacetLabelDescending(a: string, b: string) {
    return String(b).localeCompare(String(a), undefined, { sensitivity: 'base', numeric: true });
}

export function buildPermissionFilterDropdownHTML(kind: any, title: any, options: any[], selectedValues: any[], extraRootClass = '') {
    const selectedSet = new Set(selectedValues || []);
    const selectedCount = selectedSet.size;
    const summaryText = selectedCount > 0 ? `${selectedCount} selected` : 'All';
    const optionByValue = new Map(options.map((option: any) => [option.value, option]));
    const selectedChips = selectedValues
        .map((value: any) => optionByValue.get(value))
        .filter(Boolean)
        .map((option: any) => buildPermissionFilterChipHTML(kind, option.value, option.label))
        .join('');
    const sortedOptions = [...options].sort((left, right) => {
        const leftSelected = selectedSet.has(left.value);
        const rightSelected = selectedSet.has(right.value);
        if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
        const leftDisabled = Boolean(left.disabled);
        const rightDisabled = Boolean(right.disabled);
        if (leftDisabled !== rightDisabled) return leftDisabled ? 1 : -1;
        const lc = Number(left.count) || 0;
        const rc = Number(right.count) || 0;
        if (rc !== lc) return rc - lc;
        return String(left.label).localeCompare(String(right.label));
    });
    const optionRows = sortedOptions.map((option: any) => {
        const checked = selectedSet.has(option.value) ? ' checked' : '';
        const disabled = option.disabled ? ' disabled' : '';
        const disabledClass = option.disabled ? ' perm-filter-option--disabled' : '';
        return `
            <label class="perm-filter-option${disabledClass}" data-option-label="${escapeAttribute(option.label.toLowerCase())}">
                <input type="checkbox" data-filter-option="${kind}" value="${escapeAttribute(option.value)}"${checked}${disabled}>
                <span class="perm-filter-option-label">${escapeHtml(option.label)}</span>
                <span class="perm-filter-option-meta">${option.count}</span>
            </label>
        `;
    }).join('');

    return `
        <div class="perm-filter${extraRootClass ? ` ${extraRootClass}` : ''}" data-filter-kind="${kind}">
            <div class="perm-filter-label-row">
                <span class="perm-filter-label">${escapeHtml(title)}</span>
                <span class="perm-filter-summary">${escapeHtml(summaryText)}</span>
            </div>
            <div class="perm-filter-chip-list${selectedChips ? '' : ' is-empty'}">${selectedChips || `<span class="perm-filter-chip-placeholder">All ${escapeHtml(title.toLowerCase())}</span>`}</div>
            <div class="perm-filter-shell">
                <input class="perm-filter-search" type="search" data-filter-search="${kind}" placeholder="Search ${escapeAttribute(title.toLowerCase())}..." autocomplete="off">
                <div class="perm-filter-panel" role="listbox" aria-label="${escapeAttribute(title)} filter options" aria-multiselectable="true">
                    <div class="perm-filter-actions">
                        <button type="button" class="perm-filter-action" data-filter-select-all="${kind}">Select all visible</button>
                        <button type="button" class="perm-filter-action" data-filter-clear="${kind}">Reset</button>
                    </div>
                    <div class="perm-filter-options">${optionRows || '<div class="perm-filter-empty">No matches in current scope.</div>'}</div>
                </div>
            </div>
        </div>
    `;
}

export function buildSingleSelectFilterHTML(kind: any, title: any, values: any[], selectedValue: any) {
    const hasSelection = selectedValue && selectedValue !== 'ALL';
    const summaryText = hasSelection ? selectedValue : 'All';
    const sortedValues = [...values].sort(compareFacetLabelDescending);
    const allOptions = [{ label: `All ${title.toLowerCase()}s`, value: 'ALL' }, ...sortedValues.map((v: any) => ({ label: v, value: v }))];
    const optionRows = allOptions.map((option: any) => {
        const checked = option.value === (selectedValue || 'ALL') ? ' checked' : '';
        return `
            <label class="perm-filter-option" data-option-label="${escapeAttribute(option.label.toLowerCase())}">
                <input type="radio" name="scope-${kind}" data-scope-option="${kind}" value="${escapeAttribute(option.value)}"${checked}>
                <span class="perm-filter-option-label">${escapeHtml(option.label)}</span>
            </label>
        `;
    }).join('');
    const chipHtml = hasSelection
        ? `<span class="perm-filter-chip">${escapeHtml(selectedValue)}<button type="button" class="perm-filter-chip-remove" data-scope-clear="${kind}" aria-label="Clear ${escapeAttribute(title)}">×</button></span>`
        : `<span class="perm-filter-chip-placeholder">All ${escapeHtml(title.toLowerCase())}s</span>`;
    return `
        <div class="perm-filter perm-filter--single" data-filter-kind="scope-${kind}">
            <div class="perm-filter-label-row">
                <span class="perm-filter-label">${escapeHtml(title)}</span>
                <span class="perm-filter-summary">${escapeHtml(summaryText)}</span>
            </div>
            <div class="perm-filter-chip-list${hasSelection ? '' : ' is-empty'}">${chipHtml}</div>
            <div class="perm-filter-shell">
                <input class="perm-filter-search" type="search" data-filter-search="scope-${kind}" placeholder="Search ${escapeAttribute(title.toLowerCase())}..." autocomplete="off">
                <div class="perm-filter-panel" role="listbox" aria-label="${escapeAttribute(title)} scope options">
                    <div class="perm-filter-actions">
                        <button type="button" class="perm-filter-action" data-scope-clear="${kind}">Reset</button>
                    </div>
                    <div class="perm-filter-options">${optionRows}</div>
                </div>
            </div>
        </div>
    `;
}

export function getMatrixSelectionSets() {
    return {
        roles: new Set(S.matrixSelectedRoleIds),
        objects: new Set(S.matrixSelectedObjectIds),
        permissions: new Set(S.matrixSelectedPermissionKeys),
        fields: new Set(S.matrixSelectedFieldKeys)
    };
}

export function entryMatchesMatrixSelections(entry: any, selections: any, omittedKind: string | null = null) {
    if (omittedKind !== 'roles' && selections.roles.size > 0 && !selections.roles.has(entry.roleId)) {
        return false;
    }
    if (omittedKind !== 'objects' && selections.objects.size > 0 && !selections.objects.has(entry.objectId)) {
        return false;
    }
    if (omittedKind !== 'permissions' && selections.permissions.size > 0) {
        const matchesPermission = entry.filterTags.some((tag: any) => selections.permissions.has(tag));
        if (!matchesPermission) return false;
    }
    if (omittedKind !== 'fields' && selections.fields.size > 0) {
        const fieldKeys: string[] = entry.fieldNameKeys || [];
        const matchesField = fieldKeys.some((k: any) => selections.fields.has(k));
        if (!matchesField) return false;
    }
    return true;
}

export function buildMatrixCompatibilityMaps(entries: any[], selections: any) {
    const compatibility = {
        roles: new Map(),
        objects: new Map(),
        permissions: new Map(),
        fields: new Map()
    };

    entries.forEach((entry: any) => {
        if (entryMatchesMatrixSelections(entry, selections, 'roles')) {
            compatibility.roles.set(entry.roleId, (compatibility.roles.get(entry.roleId) || 0) + 1);
        }
        if (entryMatchesMatrixSelections(entry, selections, 'objects')) {
            compatibility.objects.set(entry.objectId, (compatibility.objects.get(entry.objectId) || 0) + 1);
        }
        if (entryMatchesMatrixSelections(entry, selections, 'permissions')) {
            entry.filterTags.forEach((tag: any) => {
                compatibility.permissions.set(tag, (compatibility.permissions.get(tag) || 0) + 1);
            });
        }
        if (entryMatchesMatrixSelections(entry, selections, 'fields')) {
            (entry.fieldNameKeys || []).forEach((key: any) => {
                compatibility.fields.set(key, (compatibility.fields.get(key) || 0) + 1);
            });
        }
    });

    return compatibility;
}

export function pruneMatrixSelectionList(selectedValues: any[], validValues: Set<any>, compatibleValues: Map<any, any>) {
    if (!selectedValues.length) return selectedValues;
    return selectedValues.filter((value: any) => validValues.has(value) && compatibleValues.has(value));
}

export function synchronizeMatrixSelections(entries: any[], validValues: any) {
    let compatibility = buildMatrixCompatibilityMaps(entries, getMatrixSelectionSets());

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const nextRoleIds = pruneMatrixSelectionList(S.matrixSelectedRoleIds, validValues.roles, compatibility.roles);
        const nextObjectIds = pruneMatrixSelectionList(S.matrixSelectedObjectIds, validValues.objects, compatibility.objects);
        const nextPermissionKeys = pruneMatrixSelectionList(S.matrixSelectedPermissionKeys, validValues.permissions, compatibility.permissions);
        const nextFieldKeys = pruneMatrixSelectionList(S.matrixSelectedFieldKeys, validValues.fields, compatibility.fields);

        const changed = nextRoleIds.length !== S.matrixSelectedRoleIds.length
            || nextObjectIds.length !== S.matrixSelectedObjectIds.length
            || nextPermissionKeys.length !== S.matrixSelectedPermissionKeys.length
            || nextFieldKeys.length !== S.matrixSelectedFieldKeys.length;

        S.matrixSelectedRoleIds = nextRoleIds;
        S.matrixSelectedObjectIds = nextObjectIds;
        S.matrixSelectedPermissionKeys = nextPermissionKeys;
        S.matrixSelectedFieldKeys = nextFieldKeys;

        if (!changed) break;
        compatibility = buildMatrixCompatibilityMaps(entries, getMatrixSelectionSets());
    }

    return compatibility;
}

export function buildMatrixFacetOptions(items: any[], compatibleCounts: Map<any, any>, selectedValues: any[]) {
    const selectedSet = new Set(selectedValues);
    return items.map((item: any) => ({
        ...item,
        count: compatibleCounts.get(item.value) || 0,
        disabled: !selectedSet.has(item.value) && !compatibleCounts.has(item.value)
    }));
}

export function buildPermissionActiveFilterSummary(roleOptions: any[], objectOptions: any[], permissionOptions: any[], fieldOptions: any[]) {
    const optionMaps = {
        roles: new Map(roleOptions.map((option: any) => [option.value, option.label])),
        objects: new Map(objectOptions.map((option: any) => [option.value, option.label])),
        permissions: new Map(permissionOptions.map((option: any) => [option.value, option.label])),
        fields: new Map(fieldOptions.map((option: any) => [option.value, option.label]))
    };

    const chips = [
        ...S.matrixSelectedRoleIds.map(value => {
            const label = optionMaps.roles.get(value);
            return label ? buildPermissionFilterChipHTML('roles', value, `Role · ${label}`, 'summary') : '';
        }),
        ...S.matrixSelectedObjectIds.map(value => {
            const label = optionMaps.objects.get(value);
            return label ? buildPermissionFilterChipHTML('objects', value, `Object · ${label}`, 'summary') : '';
        }),
        ...S.matrixSelectedPermissionKeys.map(value => {
            const label = optionMaps.permissions.get(value);
            return label ? buildPermissionFilterChipHTML('permissions', value, `Permission · ${label}`, 'summary') : '';
        }),
        ...S.matrixSelectedFieldKeys.map(value => {
            const label = optionMaps.fields.get(value);
            return label ? buildPermissionFilterChipHTML('fields', value, label, 'summary') : '';
        })
    ].filter(Boolean).join('');

    if (!chips) return '';

    return chips;
}
