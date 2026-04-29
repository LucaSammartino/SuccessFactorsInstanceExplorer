import type { DashboardLike } from './GraphDiff.js';
import type { RoleObjectPermission, RoleSystemPermission } from '../types.js';

export type ObjectVerbAtom    = { kind: 'objectVerb';    roleId: string; objectId: string; verb: string; };
export type FieldPermAtom     = { kind: 'fieldPerm';     roleId: string; objectId: string; permission: string; };
export type FieldOverrideAtom = { kind: 'fieldOverride'; roleId: string; objectId: string; field: string; value: string; };
export type SystemPermAtom    = { kind: 'systemPerm';    roleId: string; permission: string; };

export type PermAtom = ObjectVerbAtom | FieldPermAtom | FieldOverrideAtom | SystemPermAtom;

function parseFieldOverrideEntries(entry: RoleObjectPermission): Array<{ field: string; value: string }> {
  const fieldOverrides = Array.isArray(entry?.fieldOverrides) ? entry.fieldOverrides : [];
  const parsed: { field: string; value: string }[] = [];

  for (const override of fieldOverrides) {
    if (!override) continue;

    if (typeof override === 'string') {
      override
        .split(/\s*,\s*/)
        .map(segment => segment.trim())
        .filter(Boolean)
        .forEach(segment => {
          const separatorIndex = segment.indexOf(':');
          if (separatorIndex === -1) {
            parsed.push({ field: segment, value: '' });
            return;
          }
          const field = segment.slice(0, separatorIndex).trim();
          const value = segment.slice(separatorIndex + 1).trim();
          if (field || value) parsed.push({ field, value });
        });
      continue;
    }

    const fb = override as any;
    const field = String(fb.field || fb.name || fb.code || '').trim();
    const value = String(fb.value || fb.override || fb.access || '').trim();
    if (field || value) parsed.push({ field, value });
  }

  const seen = new Set<string>();
  return parsed.filter(item => {
    const key = `${item.field}::${item.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function flattenPermissionAtoms(dashboard: DashboardLike): PermAtom[] {
  const atoms: PermAtom[] = [];

  const roleObjPerms = ((dashboard as any).permissions?.roleObjectPermissions) as RoleObjectPermission[] | undefined;
  if (Array.isArray(roleObjPerms)) {
    for (const p of roleObjPerms) {
      const roleId = p.roleId ?? '';
      const objectId = p.objectId ?? '';

      // 1. Object Permissions
      if (Array.isArray(p.permissions)) {
        for (const perm of p.permissions) {
          atoms.push({
            kind: 'objectVerb',
            roleId,
            objectId,
            verb: perm
          });
        }
      }

      // 2. Field Items
      if (Array.isArray(p.fieldItems)) {
        for (const item of p.fieldItems) {
          const acts = Array.isArray(item.actions) && item.actions.length > 0 
            ? item.actions 
            : Array.isArray(item.actionTypes) 
              ? item.actionTypes 
              : [];
          
          let pushed = false;
          // Emit one atom per unique (roleId, objectId, action) or fallback to fieldPermission logic
          const tokens = new Set<string>();
          for (const act of acts) {
             const t = (act || '').trim();
             if (t) tokens.add(t);
          }
          // The plan states "one FieldPermAtom per (role, object, field-action permission)"
          // Wait, fieldPerm atom structure is { kind: 'fieldPerm', roleId, objectId, permission }
          for (const token of tokens) {
            atoms.push({
              kind: 'fieldPerm',
              roleId,
              objectId,
              permission: token
            });
            pushed = true;
          }
          if (!pushed) {
             const pToken = String((item as any).permission || (item as any).permissionType || (item as any).access || (item as any).fieldPermission || '').trim();
             if (pToken) {
               atoms.push({
                 kind: 'fieldPerm',
                 roleId,
                 objectId,
                 permission: pToken
               });
             }
          }
        }
      }

      // 3. Field Overrides
      const overrides = parseFieldOverrideEntries(p);
      for (const ov of overrides) {
        atoms.push({
          kind: 'fieldOverride',
          roleId,
          objectId,
          field: ov.field,
          value: ov.value
        });
      }
    }
  }

  const roleSysPerms = ((dashboard as any).permissions?.roleSystemPermissions) as RoleSystemPermission[] | undefined;
  if (Array.isArray(roleSysPerms)) {
    for (const p of roleSysPerms) {
      atoms.push({
        kind: 'systemPerm',
        roleId: p.roleId ?? '',
        permission: p.permission ?? ''
      });
    }
  }

  return atoms;
}
