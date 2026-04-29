import path from 'node:path';
import type { SFGraph } from '../core/GraphSchema.js';
import type { EngineOptions, RoleObjectPermission, RoleSystemPermission, StreamCsvOptions } from '../types.js';
import type { IngestLogBuilder } from '../ingest/IngestLog.js';
import { compareUtf16 } from '../core/deterministicSort.js';
import {
  compact,
  compositeKey,
  existsAsync,
  makeEngineIssueReporter,
  pickColumn,
  resolveEngineDataPath,
  streamCsv
} from './utils.js';

/**
 * RBP Ingestion Engine
 *
 * Loads role populations plus MDF and system permission summaries without
 * inflating the default graph with permission nodes or edges.
 */
const DEFAULT_RBP_PATHS = {
  primaryRoles: 'sample-data/SSFFRealinstancefiles/RBP Files/RoleToRuleInformation.csv',
  legacyRoles: 'sample-data/SSFFRealinstancefiles/RBP Files/report_Roles_report_example.csv',
  roleObjectPermissions: 'sample-data/SSFFRealinstancefiles/RBP Files/RoleToPermission.csv',
  roleSystemPermissions: 'sample-data/SSFFRealinstancefiles/RBP Files/RoleToMDFPermission.csv',
  security: 'sample-data/SSFFRealinstancefiles/Object Definitions/Object Definition-Security.csv'
};

type RbpCsvRow = Record<string, string>;

type AggregatedRoleObjectPermission = {
  roleId: string;
  objectId: string;
  permissions: Set<string>;
  categories: Set<string>;
  structures: Set<string>;
  fieldOverrides: Set<string>;
};

type AggregatedRoleSystemPermission = {
  roleId: string;
  permission: string;
  categories: Set<string>;
};

type RbpPaths = {
  primaryRoles: string;
  legacyRoles: string;
  roleObjectPermissions: string;
  roleSystemPermissions: string;
  security: string;
};

export class RbpEngine {
  graph: SFGraph;
  paths: RbpPaths;
  ingestLog?: IngestLogBuilder;
  private parsedRoles = 0;
  private parsedRoleObjectRows = 0;
  private parsedRoleSystemRows = 0;

  constructor(graph: SFGraph, options: EngineOptions = {}) {
    this.graph = graph;
    this.paths = {
      primaryRoles: resolveEngineDataPath(options.rbpPrimaryRoles, DEFAULT_RBP_PATHS.primaryRoles),
      legacyRoles: resolveEngineDataPath(options.rbpLegacyRoles, DEFAULT_RBP_PATHS.legacyRoles),
      roleObjectPermissions: resolveEngineDataPath(
        options.rbpRoleObjectPermissions,
        DEFAULT_RBP_PATHS.roleObjectPermissions
      ),
      roleSystemPermissions: resolveEngineDataPath(
        options.rbpRoleSystemPermissions,
        DEFAULT_RBP_PATHS.roleSystemPermissions
      ),
      security: resolveEngineDataPath(options.rbpSecurity, DEFAULT_RBP_PATHS.security)
    };
    this.ingestLog = options.ingestLog;
  }

  /** Mutates the shared graph with RBP role nodes, permission summaries, and role-to-rule/object links. */
  async run(): Promise<void> {
    const inputs = compact({
      primaryRoles: this.paths.primaryRoles && path.basename(this.paths.primaryRoles),
      roleObjectPermissions:
        this.paths.roleObjectPermissions && path.basename(this.paths.roleObjectPermissions),
      roleSystemPermissions:
        this.paths.roleSystemPermissions && path.basename(this.paths.roleSystemPermissions)
    });
    console.log('[RBP Engine] Starting ingestion...');
    console.log(
      `[RBP Engine] CSV inputs: ${
        Object.values(inputs).join(', ') || 'none'
      } (object permissions may also come from RBP JSON v2)`
    );
    makeEngineIssueReporter(this.ingestLog, 'rbp', 'RbpEngine')?.({
      severity: 'info',
      code: 'rbp.csv.inputs',
      message: `RBP CSV inputs: ${Object.values(inputs).join(', ') || 'none'}.`,
      data: inputs
    });

    await this.parseRoles();
    await this.parseObjectSecurity();
    await this.parseRoleObjectPermissions();
    await this.parseRoleSystemPermissions();

    this.graph.addEngineDiagnostic('rbp', {
      parsedRoles: this.parsedRoles,
      parsedRoleObjectRows: this.parsedRoleObjectRows,
      parsedRoleSystemRows: this.parsedRoleSystemRows
    });
    console.log('[RBP Engine] Ingestion complete.');
  }

  async parseRoles(): Promise<void> {
    if (await existsAsync(this.paths.primaryRoles)) {
      const baseName = path.basename(this.paths.primaryRoles);
      const isRolesPermissions = baseName.toLowerCase() === 'rolespermissions.csv';
      const fileLabel = isRolesPermissions ? 'RolesPermissions.csv' : 'RoleToRuleInformation.csv';
      await this.readCsv(
        this.paths.primaryRoles,
        row => {
          const roleName = pickColumn(row, ['Role Name', 'role_name', 'roleName', 'role']);
          if (!roleName) return;
          this.parsedRoles += 1;

          this.graph.addNode(
            roleName,
            'RBP_ROLE',
            compact({
              label: roleName,
              targetPopulation: row['Target population'],
              grantedPopulation: row['Granted population'],
              includeSelf: row['Include self'],
              // first-example columns
              accessUserStatus: row['Access User Status'],
              excludeByPerson: row['Exclude by Person'],
              excludeByUser: row['Exclude by User'],
              memberCount: row.Count,
              // client-2 columns
              excludeLoginUser: row['Exclude login user'],
              criteriaObjectName: row['Criteria object name'],
              criteria: row['Criteria'],
              roleSource: fileLabel
            })
          );
        },
        { skipLabelRow: false, onIssue: makeEngineIssueReporter(this.ingestLog, 'rbp', 'RbpEngine', baseName) }
      );
    }

    if (!(await existsAsync(this.paths.legacyRoles))) return;

    const legacyBase = path.basename(this.paths.legacyRoles);
    await this.readCsv(
      this.paths.legacyRoles,
      row => {
        const roleName = pickColumn(row, ['Role Name', 'role_name', 'roleName']);
        if (!roleName) return;

        this.graph.addNode(
          roleName,
          'RBP_ROLE',
          compact({
            label: roleName,
            targetPopulation: row['Target population'],
            grantedPopulation: row['Granted population'],
            roleSource: this.graph.nodes.has(roleName) ? undefined : 'report_Roles_report_example.csv'
          })
        );
      },
      { skipLabelRow: false, onIssue: makeEngineIssueReporter(this.ingestLog, 'rbp', 'RbpEngine', legacyBase) }
    );
  }

  async parseObjectSecurity(): Promise<void> {
    if (!(await existsAsync(this.paths.security))) return;
    const baseName = path.basename(this.paths.security);

    await this.readCsv(
      this.paths.security,
      row => {
        const objectId = row.id;
        if (!objectId) return;

        this.graph.addNode(
          objectId,
          'MDF_OBJECT',
          compact({
            isSecured: row['rbpConfig.securedByRBP'] === 'YES',
            permissionCategory: row['rbpConfig.permissionCategory']
          })
        );
      },
      { onIssue: makeEngineIssueReporter(this.ingestLog, 'rbp', 'RbpEngine', baseName) }
    );
  }

  async parseRoleObjectPermissions(): Promise<void> {
    if (!(await existsAsync(this.paths.roleObjectPermissions))) return;
    const baseName = path.basename(this.paths.roleObjectPermissions);

    const aggregated = new Map<string, AggregatedRoleObjectPermission>();

    await this.readCsv(
      this.paths.roleObjectPermissions,
      row => {
        const roleId = pickColumn(row, ['Role Name', 'role_name', 'roleName']);
        const objectId = pickColumn(row, ['Permission Object Name', 'permission_object_name', 'objectName']);
        if (!roleId || !objectId) return;
        this.parsedRoleObjectRows += 1;

        const key = compositeKey(roleId, objectId);
        if (!aggregated.has(key)) {
          aggregated.set(key, {
            roleId,
            objectId,
            permissions: new Set<string>(),
            categories: new Set<string>(),
            structures: new Set<string>(),
            fieldOverrides: new Set<string>()
          });
        }

        const entry = aggregated.get(key)!;
        splitPermissions(row['Object Level Permission']).forEach(permission => entry.permissions.add(permission));
        if (row.Category) entry.categories.add(row.Category);
        if (row.Structure) entry.structures.add(row.Structure);
        if (row['Field Level Overrides']) entry.fieldOverrides.add(row['Field Level Overrides']);
      },
      { skipLabelRow: false, onIssue: makeEngineIssueReporter(this.ingestLog, 'rbp', 'RbpEngine', baseName) }
    );

    const summaries: RoleObjectPermission[] = Array.from(aggregated.values())
      .map(entry => ({
        roleId: entry.roleId,
        objectId: entry.objectId,
        permissions: Array.from(entry.permissions),
        categories: Array.from(entry.categories),
        structures: Array.from(entry.structures),
        fieldOverrides: Array.from(entry.fieldOverrides),
        searchText: [
          entry.roleId,
          entry.objectId,
          ...entry.permissions,
          ...entry.categories,
          ...entry.structures
        ].join(' | ')
      }))
      .sort((left, right) => {
        const leftKey = `${left.roleId} ${left.objectId}`;
        const rightKey = `${right.roleId} ${right.objectId}`;
        return compareUtf16(leftKey, rightKey);
      });

    this.graph.meta.roleObjectPermissions = summaries;

    const byRole = new Map<string, RoleObjectPermission[]>();
    const byObject = new Map<string, RoleObjectPermission[]>();

    summaries.forEach(entry => {
      if (!byRole.has(entry.roleId)) byRole.set(entry.roleId, []);
      if (!byObject.has(entry.objectId)) byObject.set(entry.objectId, []);
      byRole.get(entry.roleId)!.push(entry);
      byObject.get(entry.objectId)!.push(entry);
    });

    byRole.forEach((entries, roleId) => {
      this.graph.addNode(roleId, 'RBP_ROLE', {
        mdfPermissionObjectCount: entries.length,
        mdfPermissionCategories: Array.from(new Set(entries.flatMap(entry => entry.categories))).sort()
      });
    });

    byObject.forEach((entries, objectId) => {
      this.graph.addNode(objectId, 'MDF_OBJECT', {
        roleAccessCount: entries.length
      });
    });
  }

  async parseRoleSystemPermissions(): Promise<void> {
    if (!(await existsAsync(this.paths.roleSystemPermissions))) return;
    const baseName = path.basename(this.paths.roleSystemPermissions);

    const aggregated = new Map<string, AggregatedRoleSystemPermission>();

    await this.readCsv(
      this.paths.roleSystemPermissions,
      row => {
        const roleId = pickColumn(row, ['Role Name', 'role_name', 'roleName']);
        const permission = pickColumn(row, ['Permission', 'permission']);
        if (!roleId || !permission) return;
        this.parsedRoleSystemRows += 1;

        const key = compositeKey(roleId, permission);
        if (!aggregated.has(key)) {
          aggregated.set(key, {
            roleId,
            permission,
            categories: new Set<string>()
          });
        }

        const entry = aggregated.get(key)!;
        if (row.Category) entry.categories.add(row.Category);
      },
      { skipLabelRow: false, onIssue: makeEngineIssueReporter(this.ingestLog, 'rbp', 'RbpEngine', baseName) }
    );

    const summaries: RoleSystemPermission[] = Array.from(aggregated.values())
      .map(entry => ({
        roleId: entry.roleId,
        permission: entry.permission,
        categories: Array.from(entry.categories),
        searchText: [entry.roleId, entry.permission, ...entry.categories].join(' | ')
      }))
      .sort((left, right) => {
        const leftKey = `${left.roleId} ${left.permission}`;
        const rightKey = `${right.roleId} ${right.permission}`;
        return compareUtf16(leftKey, rightKey);
      });

    this.graph.meta.roleSystemPermissions = summaries;

    const byRole = new Map<string, RoleSystemPermission[]>();
    summaries.forEach(entry => {
      if (!byRole.has(entry.roleId)) byRole.set(entry.roleId, []);
      byRole.get(entry.roleId)!.push(entry);
    });

    byRole.forEach((entries, roleId) => {
      this.graph.addNode(roleId, 'RBP_ROLE', {
        systemPermissionCount: entries.length,
        systemPermissionCategories: Array.from(new Set(entries.flatMap(entry => entry.categories))).sort()
      });
    });
  }

  readCsv(filePath: string, onRow: (row: RbpCsvRow) => void, options: StreamCsvOptions = {}): Promise<void> {
    return streamCsv<RbpCsvRow>(filePath, onRow, options);
  }
}

function splitPermissions(rawValue: string | undefined): string[] {
  const s = `${rawValue || ''}`.trim();
  if (!s) return [];
  if (!s.includes(':')) return [s];
  const parts = s.split(':');
  const out: string[] = [];
  for (const value of parts) {
    const t = value.trim();
    if (t) out.push(t);
  }
  return out;
}
