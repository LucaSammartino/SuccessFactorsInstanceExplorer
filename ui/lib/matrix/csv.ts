import { appState as S } from '../store';
import { type PermMatrixGridModel, computePermissionMatrixGridModel } from './layout';

type MatrixFacetSnapshot = {
    roleIds: string[];
    objectIds: string[];
    permissionKeys: string[];
    fieldKeys: string[];
};

function snapshotMatrixFacetSelections(): MatrixFacetSnapshot {
    return {
        roleIds: [...S.matrixSelectedRoleIds],
        objectIds: [...S.matrixSelectedObjectIds],
        permissionKeys: [...S.matrixSelectedPermissionKeys],
        fieldKeys: [...S.matrixSelectedFieldKeys]
    };
}

function restoreMatrixFacetSelections(snap: MatrixFacetSnapshot) {
    S.matrixSelectedRoleIds = snap.roleIds;
    S.matrixSelectedObjectIds = snap.objectIds;
    S.matrixSelectedPermissionKeys = snap.permissionKeys;
    S.matrixSelectedFieldKeys = snap.fieldKeys;
}

function cellMatchesFacetFiltersForModel(model: PermMatrixGridModel, permissionMeta: any): boolean {
    const tags = Array.from(permissionMeta.filterTags || []) as string[];
    const matchesPermissionFilter =
        model.selectedPermissionSet.size === 0 || tags.some((tag: string) => model.selectedPermissionSet.has(tag));
    const fieldKeys: string[] = permissionMeta.fieldNameKeys
        ? Array.from(permissionMeta.fieldNameKeys as Set<string>)
        : [];
    const matchesFieldFilter =
        model.selectedFieldSet.size === 0 || fieldKeys.some((fk: string) => model.selectedFieldSet.has(fk));
    return matchesPermissionFilter && matchesFieldFilter;
}

export const PERM_MATRIX_EXPORT_WIDE_ROLE_LIMIT = 500;

const PERM_MATRIX_LONG_HEADER = [
    'role_id',
    'role_label',
    'object_id',
    'object_label',
    'object_permissions',
    'field_permissions',
    'field_overrides',
    'categories',
    'score'
];

function escapeCsvField(value: unknown): string {
    const s = value == null ? '' : String(value);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function formatCsvRow(fields: unknown[]): string {
    return fields.map(escapeCsvField).join(',') + '\r\n';
}

function padPermExport2(n: number) {
    return n < 10 ? `0${n}` : String(n);
}

function permMatrixExportTimestamp(): string {
    const d = new Date();
    return `${d.getFullYear()}-${padPermExport2(d.getMonth() + 1)}-${padPermExport2(d.getDate())}T${padPermExport2(d.getHours())}-${padPermExport2(d.getMinutes())}-${padPermExport2(d.getSeconds())}`;
}

function sanitizePermMatrixExportFilenamePart(raw: string): string {
    const s = (raw || 'scope').replace(/[^a-zA-Z0-9-_.]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return s.slice(0, 80) || 'scope';
}

function downloadPermMatrixCsv(filename: string, csvBody: string) {
    const blob = new Blob([`\uFEFF${csvBody}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function getPermMatrixExportRowIndices(model: PermMatrixGridModel, wysiwygVisibility: boolean): number[] {
    const all = model.rows.map((_, i) => i);
    if (!wysiwygVisibility || !S.matrixHideUnallocatedRows) return all;
    return all.filter(i => model.rows[i].coverage > 0);
}

function getPermMatrixExportRoleColumnIndices(model: PermMatrixGridModel, wysiwygVisibility: boolean): number[] {
    return model.displayRoles.map((_, colIdx) => colIdx).filter(colIdx => {
        if (!wysiwygVisibility || !S.matrixHideUnallocatedRoles) return true;
        return (model.roleColVisibleCount[colIdx] || 0) > 0;
    });
}

function formatMatrixCellExportWideText(meta: any): string {
    const objectPerms = ((meta.objectPerms || []) as string[]).join('; ');
    const fieldPerms = ((meta.fieldPerms || []) as string[]).join('; ');
    const fo = ((meta.fieldOverrideEntries || []) as { field: string; value: string }[])
        .map(item => `${item.field}:${item.value ?? ''}`.trim())
        .join('; ');
    const parts: string[] = [];
    if (objectPerms) parts.push(objectPerms);
    if (fieldPerms) parts.push(`F:${fieldPerms}`);
    if (fo) parts.push(`O:${fo}`);
    return parts.join(' | ');
}

function formatPermMatrixLongCsv(model: PermMatrixGridModel, wysiwygVisibility: boolean): string {
    const lines: string[] = [formatCsvRow(PERM_MATRIX_LONG_HEADER)];
    const rowIndices = getPermMatrixExportRowIndices(model, wysiwygVisibility);
    const roles = model.displayRoles;
    for (const rowIdx of rowIndices) {
        const obj = model.rows[rowIdx].obj;
        for (let colIdx = 0; colIdx < roles.length; colIdx++) {
            if (wysiwygVisibility && S.matrixHideUnallocatedRoles && (model.roleColVisibleCount[colIdx] || 0) === 0) {
                continue;
            }
            const role = roles[colIdx];
            const key = `${role.roleId}|${obj.id}`;
            const meta = model.permMap.get(key);
            if (!meta || !cellMatchesFacetFiltersForModel(model, meta)) continue;
            const objectPerms = ((meta.objectPerms || []) as string[]).join('; ');
            const fieldPerms = ((meta.fieldPerms || []) as string[]).join('; ');
            const fo = ((meta.fieldOverrideEntries || []) as { field: string; value: string }[])
                .map(item => `${item.field}:${item.value ?? ''}`.trim())
                .join('; ');
            const categories = ((meta.categories || []) as string[]).join('; ');
            lines.push(
                formatCsvRow([
                    role.roleId,
                    role.label || role.roleId,
                    obj.id,
                    obj.label || obj.id,
                    objectPerms,
                    fieldPerms,
                    fo,
                    categories,
                    meta.score ?? ''
                ])
            );
        }
    }
    return lines.join('');
}

function formatPermMatrixWideCsv(model: PermMatrixGridModel, wysiwygVisibility: boolean): string {
    const roleCols = getPermMatrixExportRoleColumnIndices(model, wysiwygVisibility);
    const roles = model.displayRoles;
    const headerFields = [
        'object_id',
        'object_label',
        ...roleCols.map(colIdx => String(roles[colIdx].label || roles[colIdx].roleId))
    ];
    const lines: string[] = [formatCsvRow(headerFields)];
    const rowIndices = getPermMatrixExportRowIndices(model, wysiwygVisibility);
    for (const rowIdx of rowIndices) {
        const obj = model.rows[rowIdx].obj;
        const cells = roleCols.map(colIdx => {
            const role = roles[colIdx];
            const meta = model.permMap.get(`${role.roleId}|${obj.id}`);
            if (!meta || !cellMatchesFacetFiltersForModel(model, meta)) return '';
            return formatMatrixCellExportWideText(meta);
        });
        lines.push(formatCsvRow([obj.id, obj.label || obj.id, ...cells]));
    }
    return lines.join('');
}

export function runPermMatrixExport(
    container: HTMLElement,
    kind: 'long' | 'wide' | 'scope-long',
    getInputs: () => { moduleFamily: any; sub: any; ranked: any[]; objects: any[] } | null,
    doRebuild: (c: HTMLElement) => void
) {
    const inputs = getInputs();
    if (!inputs) return;
    const { moduleFamily, sub, ranked, objects } = inputs;
    const scopeSlug = sanitizePermMatrixExportFilenamePart(
        moduleFamily ? `${moduleFamily}${sub ? `-${sub}` : ''}` : 'all-modules'
    );

    if (kind === 'scope-long') {
        const prev = snapshotMatrixFacetSelections();
        S.matrixSelectedRoleIds = [];
        S.matrixSelectedObjectIds = [];
        S.matrixSelectedPermissionKeys = [];
        S.matrixSelectedFieldKeys = [];
        try {
            const model = computePermissionMatrixGridModel(ranked, objects, moduleFamily, sub);
            const body = formatPermMatrixLongCsv(model, false);
            downloadPermMatrixCsv(
                `perm-matrix-all-pairs-${permMatrixExportTimestamp()}-${scopeSlug}.csv`,
                body
            );
        } finally {
            restoreMatrixFacetSelections(prev);
            doRebuild(container);
        }
        return;
    }

    const model = computePermissionMatrixGridModel(ranked, objects, moduleFamily, sub);
    if (!model.hasVisibleMatrix) {
        if (typeof window !== 'undefined' && window.alert) {
            window.alert('Nothing to export: no visible matrix for the current filters.');
        }
        return;
    }

    if (kind === 'long') {
        downloadPermMatrixCsv(
            `perm-matrix-long-${permMatrixExportTimestamp()}-${scopeSlug}.csv`,
            formatPermMatrixLongCsv(model, true)
        );
        return;
    }

    const wideCols = getPermMatrixExportRoleColumnIndices(model, true);
    if (wideCols.length > PERM_MATRIX_EXPORT_WIDE_ROLE_LIMIT) {
        if (typeof window !== 'undefined' && window.alert) {
            window.alert(
                `Wide export is limited to ${PERM_MATRIX_EXPORT_WIDE_ROLE_LIMIT} role columns (current: ${wideCols.length}). Use long CSV or narrow role filters.`
            );
        }
        return;
    }
    downloadPermMatrixCsv(
        `perm-matrix-wide-${permMatrixExportTimestamp()}-${scopeSlug}.csv`,
        formatPermMatrixWideCsv(model, true)
    );
}
