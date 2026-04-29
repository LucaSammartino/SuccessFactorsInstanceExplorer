import { appState as S } from '../store';
import { escapeHtml, escapeAttribute } from '../utils';
import {
    normalizePermissionLabel,
    parseFieldPermissionTokens,
    parseFieldOverrideEntries,
    buildFieldNameFilterKey,
    collectFieldNameKeysFromRoleObjectEntry,
    buildPermissionFilterKey,
    synchronizeMatrixSelections,
    buildMatrixFacetOptions,
    buildPermissionFilterDropdownHTML,
    buildSingleSelectFilterHTML,
    buildPermissionActiveFilterSummary,
    buildMatrixCompatibilityMaps,
    compareFacetLabelDescending,
    getMatrixSelectionSets,
} from './filters';
import { nowMs, roundMs, type PermMatrixModelTimings } from './diagnostics';

/** Grid state for virtualized tbody rendering (incremental DOM on scroll). */
export type PermMatrixGridModel = {
    displayRoles: any[];
    rows: Array<{ obj: any; coverage: number }>;
    roleColVisibleCount: number[];
    permMap: Map<string, any>;
    selectedPermissionSet: Set<string>;
    selectedFieldSet: Set<string>;
    headerCellsHtml: string;
    zeroCoverage: number;
    highCoverage: number;
    populatedPairs: number;
    scopeLabel: string;
    hasVisibleMatrix: boolean;
    emptyMessage: string;
    emptyHint: string;
    roleFilterDropdown: string;
    objectFilterDropdown: string;
    permissionFilterDropdown: string;
    fieldFilterDropdown: string;
    activeFilterSummary: string;
    families: any[];
    subModules: any[];
    moduleFamily: any;
    sub: any;
};

export type PermMatrixGridModelOptions = {
    roleObjectPermissions?: any[];
    roleObjectByObject?: Map<string, any[]>;
    dashboard?: any;
    timings?: PermMatrixModelTimings;
    synchronizeSelections?: boolean;
};

const PERM_MATRIX_EXPORT_WIDE_ROLE_LIMIT_SHELL = 500;

export function buildPermissionMatrixShellHTML(model: PermMatrixGridModel) {
    const {
        headerCellsHtml,
        zeroCoverage,
        highCoverage,
        populatedPairs,
        scopeLabel,
        hasVisibleMatrix,
        emptyMessage,
        emptyHint,
        roleFilterDropdown,
        objectFilterDropdown,
        permissionFilterDropdown,
        fieldFilterDropdown,
        activeFilterSummary,
        families,
        subModules,
        moduleFamily,
        sub,
        rows
    } = model;

    return `
        <div class="perm-matrix-wrap${S.matrixHideUnallocatedRows ? ' perm-hide-empty-rows' : ''}${S.matrixHideUnallocatedRoles ? ' perm-hide-empty-role-cols' : ''}">
            <div class="perm-matrix-header">
                <div class="perm-matrix-topbar">
                    <div class="perm-matrix-title-block">
                        <div class="perm-matrix-title-row">
                            <span class="perm-matrix-title">ROFP Matrix</span>
                            <span class="perm-matrix-scope">${escapeHtml(scopeLabel)} · ${populatedPairs} populated pairs</span>
                        </div>
                        ${activeFilterSummary ? `<div class="perm-matrix-active-filters">${activeFilterSummary}</div>` : ''}
                    </div>
                    <div class="perm-matrix-topbar-actions">
                        <div class="perm-matrix-export-group" role="group" aria-label="Export matrix to CSV">
                            <button type="button" class="perm-export-csv" data-perm-export="long" title="UTF-8 CSV (Excel/Sheets): one row per role–object pair. Matches the visible matrix (filters, module scope, hide-unallocated toggles).">Long CSV</button>
                            <button type="button" class="perm-export-csv" data-perm-export="wide" title="UTF-8 CSV: objects as rows, roles as columns (pivot layout). Same as visible matrix; max ${PERM_MATRIX_EXPORT_WIDE_ROLE_LIMIT_SHELL} role columns.">Wide CSV</button>
                            <button type="button" class="perm-export-csv perm-export-csv--secondary" data-perm-export="scope-long" title="UTF-8 CSV: all role–object pairs in the current module scope. Clears matrix facet filters for this export only; does not change your selections afterward.">All pairs CSV</button>
                        </div>
                        <button type="button" class="perm-hide-unallocated${S.matrixHideUnallocatedRows ? ' is-active' : ''}">${S.matrixHideUnallocatedRows ? 'Show unallocated objects' : 'Hide unallocated objects'}</button>
                        <button type="button" class="perm-hide-unallocated-roles${S.matrixHideUnallocatedRoles ? ' is-active' : ''}">${S.matrixHideUnallocatedRoles ? 'Show unallocated roles' : 'Hide unallocated roles'}</button>
                        <button type="button" class="perm-open-controls">${S.controlsCollapsed ? 'Show Controls' : 'Hide Controls'}</button>
                    </div>
                </div>
                <div class="perm-matrix-controls${S.controlsCollapsed ? ' is-collapsed' : ''}">
                    <div class="perm-matrix-toolbar-rows">
                        <div class="perm-matrix-toolbar-row">
                            ${roleFilterDropdown}
                            ${objectFilterDropdown}
                            ${permissionFilterDropdown}
                            ${fieldFilterDropdown}
                            ${buildSingleSelectFilterHTML('module', 'Module', families, moduleFamily || 'ALL')}
                            ${buildSingleSelectFilterHTML('submodule', 'Sub-module', subModules, sub || 'ALL')}
                        </div>
                    </div>
                </div>
            </div>
            <div class="perm-matrix-scroll">
                ${hasVisibleMatrix ? `
                <table class="perm-matrix-table">
                    <thead><tr><th class="perm-corner">Object</th>${headerCellsHtml}</tr></thead>
                    <tbody id="perm-matrix-vtbody" class="perm-matrix-vtbody" aria-rowcount="${rows.length}"></tbody>
                </table>` : `
                <div class="perm-matrix-empty-state">
                    <p>${escapeHtml(emptyMessage)}</p>
                    <p class="perm-matrix-hint-text">${escapeHtml(emptyHint)}</p>
                </div>`}
            </div>
            <div class="perm-matrix-footer">
                <span>${zeroCoverage} object${zeroCoverage !== 1 ? 's' : ''} with no role coverage</span>
                <span class="perm-footer-sep">·</span>
                <span>${highCoverage} role${highCoverage !== 1 ? 's' : ''} covering 10+ objects</span>
                <span class="perm-footer-sep">·</span>
                <span>Click object or role headers to open detail panel</span>
            </div>
        </div>`;
}

export function computePermissionMatrixGridModel(
    ranked: any[],
    objects: any[],
    moduleFamily: any,
    sub: any,
    options: PermMatrixGridModelOptions = {}
): PermMatrixGridModel {
    const roleObjectPermissions = options.roleObjectPermissions ?? S.roleObjectPermissions;
    const roleObjectByObject = options.roleObjectByObject ?? S.roleObjectByObject;
    const dashboard = options.dashboard ?? S.dashboard;
    const timings = options.timings;
    let phaseStart = nowMs();
    const markPhase = (name: string) => {
        if (!timings) return;
        const now = nowMs();
        timings[name] = roundMs(now - phaseStart);
        phaseStart = now;
    };

    const permMap = new Map();
    const permissionCatalog = new Map();
    const fieldCatalog = new Map();
    const objectIdSet = new Set(objects.map((obj: any) => obj.id));
    const roleIdSet = new Set(ranked.map((role: any) => role.roleId));

    roleObjectPermissions.forEach((entry: any) => {
        if (!objectIdSet.has(entry.objectId) || !roleIdSet.has(entry.roleId)) return;

        const key = `${entry.roleId}|${entry.objectId}`;
        const objectPerms = Array.from(new Set(
            (Array.isArray(entry.permissions) ? entry.permissions : [])
                .map(normalizePermissionLabel)
                .filter(Boolean)
        ));
        const fieldPerms = parseFieldPermissionTokens(entry);
        const fieldOverrideEntries = parseFieldOverrideEntries(entry);
        const fieldNameKeysSet = collectFieldNameKeysFromRoleObjectEntry(entry);
        for (const item of Array.isArray(entry.fieldItems) ? entry.fieldItems : []) {
            const raw = item?.fieldName ?? item?.name ?? item?.field ?? item?.code ?? '';
            const name = normalizePermissionLabel(raw);
            if (!name) continue;
            const fk = buildFieldNameFilterKey(name);
            if (!fieldCatalog.has(fk)) fieldCatalog.set(fk, { value: fk, label: `Field: ${name}` });
        }
        for (const fo of fieldOverrideEntries) {
            if (!fo.field) continue;
            const name = normalizePermissionLabel(fo.field);
            const fk = buildFieldNameFilterKey(fo.field);
            if (!fieldCatalog.has(fk)) fieldCatalog.set(fk, { value: fk, label: `Field: ${name}` });
        }
        const filterTags = [
            ...objectPerms.map(label => ({ source: 'obj', label, key: buildPermissionFilterKey('obj', label) })),
            ...fieldPerms.map(label => ({ source: 'fld', label, key: buildPermissionFilterKey('fld', label) }))
        ];
        const previous = permMap.get(key);

        filterTags.forEach((tag: any) => {
            if (!permissionCatalog.has(tag.key)) {
                permissionCatalog.set(tag.key, {
                    value: tag.key,
                    label: `${tag.source === 'obj' ? 'Object' : 'Field'}: ${tag.label}`
                });
            }
        });

        if (!previous) {
            const score = Math.max(1, Math.min(4, objectPerms.length + fieldPerms.length || (entry.categories?.length || 0) || 1));
            permMap.set(key, {
                roleId: entry.roleId,
                objectId: entry.objectId,
                score,
                objectPerms,
                fieldPerms,
                fieldOverrideEntries,
                fieldNameKeys: fieldNameKeysSet,
                categories: Array.isArray(entry.categories) ? entry.categories : [],
                filterTags: new Set(filterTags.map(tag => tag.key))
            });
            return;
        }

        previous.objectPerms = Array.from(new Set([...(previous.objectPerms || []), ...objectPerms]));
        previous.fieldPerms = Array.from(new Set([...(previous.fieldPerms || []), ...fieldPerms]));
        previous.fieldOverrideEntries = [
            ...(previous.fieldOverrideEntries || []),
            ...fieldOverrideEntries.filter((next: any) => !(previous.fieldOverrideEntries || []).some((current: any) => current.field === next.field && current.value === next.value))
        ];
        previous.fieldNameKeys = new Set([...(previous.fieldNameKeys ? Array.from(previous.fieldNameKeys) : []), ...fieldNameKeysSet]);
        previous.categories = Array.from(new Set([...(previous.categories || []), ...((Array.isArray(entry.categories) ? entry.categories : []))]));
        previous.score = Math.max(previous.score, Math.max(1, Math.min(4, previous.objectPerms.length + previous.fieldPerms.length || previous.categories.length || 1)));
        filterTags.forEach((tag: any) => previous.filterTags.add(tag.key));
    });
    markPhase('scanPermissionsMs');

    const matrixEntries = Array.from(permMap.values()).map((entry: any) => ({
        ...entry,
        filterTags: Array.from(entry.filterTags || []),
        fieldNameKeys: Array.from(entry.fieldNameKeys || [])
    }));
    const roleCoverageMap = new Map();

    matrixEntries.forEach((entry: any) => {
        roleCoverageMap.set(entry.roleId, (roleCoverageMap.get(entry.roleId) || 0) + 1);
    });
    markPhase('buildEntriesMs');

    const baseRoleOptions = ranked
        .map((role: any) => ({ value: role.roleId, label: role.label || role.roleId, count: role.count || 0 }));

    const baseObjectOptions = objects
        .map((obj: any) => ({ value: obj.id, label: obj.label || obj.id, count: roleObjectByObject.get(obj.id)?.length || 0 }));

    const basePermissionOptions = Array.from(permissionCatalog.values());
    const baseFieldOptions = Array.from(fieldCatalog.values());
    const validValues = {
        roles: new Set(baseRoleOptions.map((option: any) => option.value)),
        objects: new Set(baseObjectOptions.map((option: any) => option.value)),
        permissions: new Set(basePermissionOptions.map((option: any) => option.value)),
        fields: new Set(baseFieldOptions.map((option: any) => option.value))
    };
    const compatibility = options.synchronizeSelections === false
        ? buildMatrixCompatibilityMaps(matrixEntries, getMatrixSelectionSets())
        : synchronizeMatrixSelections(matrixEntries, validValues);
    markPhase('compatibilityMs');

    const roleOptions = buildMatrixFacetOptions(baseRoleOptions, compatibility.roles, S.matrixSelectedRoleIds);
    const objectOptions = buildMatrixFacetOptions(baseObjectOptions, compatibility.objects, S.matrixSelectedObjectIds);
    const permissionOptions = buildMatrixFacetOptions(basePermissionOptions, compatibility.permissions, S.matrixSelectedPermissionKeys);
    const fieldOptions = buildMatrixFacetOptions(baseFieldOptions, compatibility.fields, S.matrixSelectedFieldKeys);
    markPhase('facetOptionsMs');

    let filteredRoles = ranked.filter(role => S.matrixSelectedRoleIds.length === 0 || S.matrixSelectedRoleIds.includes(role.roleId));
    filteredRoles = [...filteredRoles].sort((left, right) => (right.count || 0) - (left.count || 0));
    const displayRoles = filteredRoles;
    const selectedPermissionSet = new Set(S.matrixSelectedPermissionKeys);
    const selectedFieldSet = new Set(S.matrixSelectedFieldKeys);
    const filteredObjectSet = S.matrixSelectedObjectIds.length > 0 ? new Set(S.matrixSelectedObjectIds) : null;
    const hasActiveFilters = S.matrixSelectedRoleIds.length > 0 || S.matrixSelectedObjectIds.length > 0 || S.matrixSelectedPermissionKeys.length > 0 || S.matrixSelectedFieldKeys.length > 0;

    const cellMatchesFacetFilters = (permissionMeta: any) => {
        const tags = Array.from(permissionMeta.filterTags || []) as string[];
        const matchesPermissionFilter = selectedPermissionSet.size === 0
            || tags.some(filterTag => selectedPermissionSet.has(filterTag));
        const fieldKeys: string[] = permissionMeta.fieldNameKeys
            ? Array.from(permissionMeta.fieldNameKeys as Set<string>)
            : [];
        const matchesFieldFilter = selectedFieldSet.size === 0
            || fieldKeys.some((fk: string) => selectedFieldSet.has(fk));
        return matchesPermissionFilter && matchesFieldFilter;
    };

    let sourceObjects = objects;
    if (filteredObjectSet) {
        sourceObjects = objects.filter(obj => filteredObjectSet.has(obj.id));
    }

    const roleColVisibleCount = new Array(displayRoles.length).fill(0);
    let rows: Array<{ obj: any; coverage: number }> = sourceObjects.map(obj => {
        let coverage = 0;
        for (let colIdx = 0; colIdx < displayRoles.length; colIdx++) {
            const role = displayRoles[colIdx];
            const key = `${role.roleId}|${obj.id}`;
            const permissionMeta = permMap.get(key);
            if (!permissionMeta || !cellMatchesFacetFilters(permissionMeta)) continue;
            coverage += 1;
            roleColVisibleCount[colIdx] += 1;
        }
        return { obj, coverage };
    });

    rows.sort((left, right) => (left.obj.label || left.obj.id).localeCompare(right.obj.label || right.obj.id));
    markPhase('rowCoverageMs');

    const zeroCoverage = rows.filter(r => r.coverage === 0).length;

    const highCoverage = displayRoles.filter(role => {
        let count = 0;
        objects.forEach(obj => {
            if (permMap.has(`${role.roleId}|${obj.id}`)) count += 1;
        });
        return count >= 10;
    }).length;
    markPhase('summaryCountsMs');

    const headerCellsHtml = displayRoles.map((role, colIdx) => {
        const label = role.label || role.roleId;
        const coverage = roleCoverageMap.get(role.roleId) || 0;
        const noVisible = roleColVisibleCount[colIdx] === 0;
        return `
            <th class="perm-col-header${noVisible ? ' perm-col--no-visible' : ''}" data-col="${colIdx}" data-role-id="${escapeAttribute(role.roleId)}" title="${escapeAttribute(label)}">
                <div class="perm-col-label">${escapeHtml(label)}</div>
                <div class="perm-col-meta">${coverage} objects</div>
            </th>
        `;
    }).join('') + `<th class="perm-corner perm-cov-head">Roles</th>`;
    markPhase('headerHtmlMs');

    const scopeLabel = moduleFamily ? moduleFamily + (sub ? ' · ' + sub : '') : 'All Modules';

    const families = (dashboard?.stats?.moduleBreakdown?.families || [])
        .map((family: any) => family.family)
        .filter(Boolean)
        .sort(compareFacetLabelDescending);

    const subModules = moduleFamily
        ? (dashboard?.stats?.moduleBreakdown?.subModulesByFamily?.[moduleFamily] || [])
            .map((item: any) => item.subModule)
            .filter(Boolean)
            .sort(compareFacetLabelDescending)
        : [];

    const roleFilterDropdown = buildPermissionFilterDropdownHTML('roles', 'Roles', roleOptions, S.matrixSelectedRoleIds);
    const objectFilterDropdown = buildPermissionFilterDropdownHTML('objects', 'Objects', objectOptions, S.matrixSelectedObjectIds);
    const permissionFilterDropdown = buildPermissionFilterDropdownHTML('permissions', 'Permissions', permissionOptions, S.matrixSelectedPermissionKeys);
    const fieldFilterDropdown = buildPermissionFilterDropdownHTML('fields', 'Fields', fieldOptions, S.matrixSelectedFieldKeys);
    const activeFilterSummary = buildPermissionActiveFilterSummary(roleOptions, objectOptions, permissionOptions, fieldOptions);
    markPhase('filterHtmlMs');
    const populatedPairs = matrixEntries.length;
    const hasVisibleMatrix = displayRoles.length > 0 && rows.length > 0;
    const emptyMessage = hasActiveFilters
        ? 'No rows match the current filter combination.'
        : 'No permission data is visible in this scope.';
    const emptyHint = hasActiveFilters
        ? 'Clear one or more filters or widen the module scope to bring populated role/object pairs back into view.'
        : 'Upload RBP permission CSV files in Import to populate the matrix.';

    return {
        displayRoles,
        rows,
        roleColVisibleCount,
        permMap,
        selectedPermissionSet,
        selectedFieldSet,
        headerCellsHtml,
        zeroCoverage,
        highCoverage,
        populatedPairs,
        scopeLabel,
        hasVisibleMatrix,
        emptyMessage,
        emptyHint,
        roleFilterDropdown,
        objectFilterDropdown,
        permissionFilterDropdown,
        fieldFilterDropdown,
        activeFilterSummary,
        families,
        subModules,
        moduleFamily,
        sub
    };
}

export function buildPermissionMatrixHTML(ranked: any[], objects: any[], moduleFamily: any, sub: any) {
    return buildPermissionMatrixShellHTML(computePermissionMatrixGridModel(ranked, objects, moduleFamily, sub));
}
