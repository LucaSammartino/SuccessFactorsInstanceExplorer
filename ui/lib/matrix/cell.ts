import { escapeHtml, escapeAttribute } from '../utils';
import { classifyPermissionType, normalizeFieldOverrideAccessLabel } from './filters';
import type { PermMatrixGridModel } from './layout';
import { appState as S } from '../store';
import { compareState } from '../compare';

function applyPermColNoVisible(html: string, colIdx: number, roleColVisibleCount: number[]) {
    if (roleColVisibleCount[colIdx] > 0) return html;
    if (html.includes('class="perm-cell has-perm"')) {
        return html.replace('class="perm-cell has-perm"', 'class="perm-cell has-perm perm-col--no-visible"');
    }
    return html.replace('class="perm-cell"', 'class="perm-cell perm-col--no-visible"');
}

export function buildMatrixCellTdHtml(
    role: any,
    colIdx: number,
    obj: any,
    permMap: Map<string, any>,
    roleColVisibleCount: number[],
    cellMatchesFacetFilters: (permissionMeta: any) => boolean
) {
    const key = `${role.roleId}|${obj.id}`;
    const permissionMeta = permMap.get(key);
    const diffStatus = getRoleObjectDiffStatus(role.roleId, obj.id);
    const diffClass = diffStatus ? ` perm-diff-${diffStatus}` : '';
    const diffTitle = diffStatus ? `\nCompare delta: ${diffStatus}` : '';
    if (!permissionMeta) {
        const emptyDiff = diffStatus
            ? `<td class="perm-cell${diffClass}" data-col="${colIdx}" data-role-id="${escapeAttribute(role.roleId)}" data-object-id="${escapeAttribute(obj.id)}" title="${escapeAttribute((role.label || role.roleId) + ' → ' + (obj.label || obj.id) + diffTitle)}"><div class="perm-cell-card perm-cell-card--diff-empty"><span class="perm-diff-pill">${escapeHtml(diffLabel(diffStatus))}</span></div></td>`
            : `<td class="perm-cell" data-col="${colIdx}"></td>`;
        return applyPermColNoVisible(emptyDiff, colIdx, roleColVisibleCount);
    }

    if (!cellMatchesFacetFilters(permissionMeta)) {
        const hiddenDiff = diffStatus
            ? `<td class="perm-cell${diffClass}" data-col="${colIdx}" data-role-id="${escapeAttribute(role.roleId)}" data-object-id="${escapeAttribute(obj.id)}" title="${escapeAttribute((role.label || role.roleId) + ' → ' + (obj.label || obj.id) + diffTitle)}"><div class="perm-cell-card perm-cell-card--diff-empty"><span class="perm-diff-pill">${escapeHtml(diffLabel(diffStatus))}</span></div></td>`
            : `<td class="perm-cell" data-col="${colIdx}"></td>`;
        return applyPermColNoVisible(hiddenDiff, colIdx, roleColVisibleCount);
    }

    const objectPerms = permissionMeta.objectPerms || [];
    const fieldPerms = permissionMeta.fieldPerms || [];
    const fieldOverrideEntries2 = permissionMeta.fieldOverrideEntries || [];
    const objectTitle = objectPerms.length ? `\nObject perms: ${objectPerms.join(', ')}` : '';
    const fieldTitle = fieldOverrideEntries2.length
        ? `\nField overrides: ${fieldOverrideEntries2.map((item: any) => `${item.field} (${item.value})`).join(', ')}`
        : (fieldPerms.length ? `\nField perms: ${fieldPerms.join(', ')}` : '');
    const objectChips = objectPerms.slice(0, 4).map((permission: any) => {
        const typeClass = classifyPermissionType(permission);
        return `<span class="perm-token perm-token--object perm-token--${typeClass}">${escapeHtml(permission)}</span>`;
    }).join('');
    const objectMore = objectPerms.length > 4 ? `<span class="perm-token perm-token--more">+${objectPerms.length - 4}</span>` : '';
    const fieldOverrideCards = fieldOverrideEntries2.slice(0, 4).map((item: any) => {
        const typeClass = classifyPermissionType(item.value);
        const compactValue = normalizeFieldOverrideAccessLabel(item.value || '');
        const fullValue = item.value || compactValue;
        return `<span class="perm-field-chip perm-field-chip--${typeClass}" title="${escapeAttribute(`${item.field}: ${fullValue}`)}"><span class="perm-field-chip-name">${escapeHtml(item.field || 'Field')}</span><span class="perm-field-chip-value">${escapeHtml(compactValue || 'N/A')}</span></span>`;
    }).join('');
    const fieldOverrideMore = fieldOverrideEntries2.length > 4 ? `<span class="perm-token perm-token--more">+${fieldOverrideEntries2.length - 4}</span>` : '';
    const fallbackFieldChips = !fieldOverrideEntries2.length
        ? fieldPerms.slice(0, 3).map((permission: any) => {
            const typeClass = classifyPermissionType(permission);
            return `<span class="perm-token perm-token--field perm-token--${typeClass}">${escapeHtml(permission)}</span>`;
        }).join('')
        : '';
    const fallbackFieldMore = !fieldOverrideEntries2.length && fieldPerms.length > 3
        ? `<span class="perm-token perm-token--more">+${fieldPerms.length - 3}</span>`
        : '';
    const fieldSectionLabel = fieldOverrideEntries2.length
        ? `Field overrides ${fieldOverrideEntries2.length}`
        : (fieldPerms.length ? `Field actions ${fieldPerms.length}` : '');

    const inner = `<td class="perm-cell has-perm${diffClass}" data-col="${colIdx}" data-role-id="${escapeAttribute(role.roleId)}" data-object-id="${escapeAttribute(obj.id)}" title="${escapeAttribute((role.label || role.roleId) + ' → ' + (obj.label || obj.id) + objectTitle + fieldTitle + diffTitle)}"><div class="perm-cell-card">${diffStatus ? `<span class="perm-diff-pill">${escapeHtml(diffLabel(diffStatus))}</span>` : ''}<div class="perm-cell-section"><div class="perm-token-row perm-token-row--object">${objectChips}${objectMore}</div></div>${fieldSectionLabel ? `<div class="perm-cell-section"><div class="perm-cell-section-label">${escapeHtml(fieldSectionLabel)}</div><div class="perm-token-row perm-token-row--field">${fieldOverrideEntries2.length ? `${fieldOverrideCards}${fieldOverrideMore}` : `${fallbackFieldChips}${fallbackFieldMore}`}</div></div>` : ''}</div></td>`;
    return applyPermColNoVisible(inner, colIdx, roleColVisibleCount);
}

function diffLabel(status: 'added' | 'removed' | 'changed') {
    if (status === 'added') return 'Added in target';
    if (status === 'removed') return 'Removed in target';
    return 'Changed';
}

function getRoleObjectDiffStatus(roleId: string, objectId: string): 'added' | 'removed' | 'changed' | null {
    if (!S.compareOverlay || !compareState.result || compareState.result.error) return null;
    const delta = compareState.result.rolePermissionDeltas?.[roleId];
    if (!delta) return null;
    const touchesObject = (item: any) => item?.objectId === objectId;
    const added =
        delta.objectVerbs.added.some(touchesObject) ||
        delta.fieldPerms.added.some(touchesObject) ||
        delta.fieldOverrides.added.some(touchesObject);
    const removed =
        delta.objectVerbs.removed.some(touchesObject) ||
        delta.fieldPerms.removed.some(touchesObject) ||
        delta.fieldOverrides.removed.some(touchesObject);
    const changed = delta.fieldOverrides.changed.some((item: any) => item?.atom?.objectId === objectId);
    if (changed || (added && removed)) return 'changed';
    if (added) return 'added';
    if (removed) return 'removed';
    return null;
}

export function buildMatrixDataRowInnerHtml(model: PermMatrixGridModel, rowIndex: number) {
    const row = model.rows[rowIndex];
    const { obj, coverage } = row;
    const cellMatchesFacetFilters = (permissionMeta: any) => {
        const tags = Array.from(permissionMeta.filterTags || []) as string[];
        const matchesPermissionFilter = model.selectedPermissionSet.size === 0
            || tags.some(filterTag => model.selectedPermissionSet.has(filterTag));
        const fieldKeys: string[] = permissionMeta.fieldNameKeys
            ? Array.from(permissionMeta.fieldNameKeys as Set<string>)
            : [];
        const matchesFieldFilter = model.selectedFieldSet.size === 0
            || fieldKeys.some((fk: string) => model.selectedFieldSet.has(fk));
        return matchesPermissionFilter && matchesFieldFilter;
    };
    const cells = model.displayRoles.map((role, colIdx) =>
        buildMatrixCellTdHtml(role, colIdx, obj, model.permMap, model.roleColVisibleCount, cellMatchesFacetFilters)
    ).join('');
    const covCell = coverage > 0 ? `<span class="perm-cov-badge">${coverage}</span>` : '<span class="perm-cov-zero">0</span>';
    return `
            <th class="perm-row-header" data-node-id="${escapeAttribute(obj.id)}" title="${escapeAttribute(obj.label || obj.id)}">${escapeHtml(obj.label || obj.id)}</th>
            ${cells}
            <td class="perm-coverage">${covCell}</td>`;
}
