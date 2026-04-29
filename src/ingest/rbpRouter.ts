/**
 * Smart RBP file router.
 *
 * The Import UI's "Roles and Permissions" dropzone accepts ANY combination
 * of CSVs and JSONs (one or many of each). This router classifies the
 * uploaded files into the four canonical engine inputs:
 *
 *   - csvPaths.primaryRoles            (Role Name + populations)
 *   - csvPaths.legacyRoles             (report_Roles_report_example.csv)
 *   - csvPaths.roleObjectPermissions   (Role Name + Permission Object Name)
 *   - csvPaths.roleSystemPermissions   (Role Name + Permission)
 *
 *   - jsonDir                          (materialised dir of role JSONs)
 *
 * Classification strategy for CSVs:
 *   1. Exact basename match (RolesPermissions.csv, RoleToRuleInformation.csv,
 *      RoleToPermission.csv, RoleToMDFPermission.csv, report_Roles_report_example.csv).
 *   2. Header-sniff fallback — read the first row and route based on column names.
 *
 * For JSONs, every uploaded `.json` is copied into `<workspace>/rbp-json-bundle/`
 * which RbpJsonEngine reads directly. The router emits an info issue per file
 * recording which top-level shape was detected so the consultant can see how
 * each role file was interpreted (V2-nested, V1-flat, V1-compact, …).
 *
 * This replaces the inline filename-only logic that lived at server.ts
 * lines ~794–867 before 2026-04-25.
 */

import path from 'node:path';
import readline from 'node:readline';
import fs from 'fs-extra';
import type { IngestLogBuilder } from './IngestLog.js';

export type RbpJsonShape = 'v2-nested' | 'v1-flat-strings' | 'v1-compact' | 'unknown';

export interface RbpRoutingResult {
  csvPaths: {
    primaryRoles: string | null;
    legacyRoles: string | null;
    roleObjectPermissions: string | null;
    roleSystemPermissions: string | null;
  };
  jsonDir: string | null;
  jsonShapes: RbpJsonShape[];
  unrecognized: Array<{ file: string; reason: string }>;
}

export interface RbpRouterInput {
  /** path: temp upload path, originalname: user-facing filename (case-preserved). */
  files: Array<{ path: string; originalname: string }>;
  /** Project workspace root (e.g. `<projectDir>/extracted`). JSON bundle goes under this. */
  workspaceDir: string;
  /** Optional override for a primary roles CSV (rbpRolesPermissionsCsv multipart slot). */
  primaryRolesOverride?: string | null;
  /** Optional override for an explicit JSON bundle (rbpJsonBundle multipart slot). */
  jsonBundleOverride?: Array<{ path: string; originalname: string }>;
  log?: IngestLogBuilder;
}

export async function routeRbpUploads(input: RbpRouterInput): Promise<RbpRoutingResult> {
  const { files, workspaceDir, primaryRolesOverride, jsonBundleOverride, log } = input;

  const result: RbpRoutingResult = {
    csvPaths: {
      primaryRoles: primaryRolesOverride ?? null,
      legacyRoles: null,
      roleObjectPermissions: null,
      roleSystemPermissions: null
    },
    jsonDir: null,
    jsonShapes: [],
    unrecognized: []
  };

  const csvFiles = files.filter(f => f.originalname.toLowerCase().endsWith('.csv'));
  const jsonFiles = files.filter(f => f.originalname.toLowerCase().endsWith('.json'));
  const otherFiles = files.filter(
    f => !f.originalname.toLowerCase().endsWith('.csv') && !f.originalname.toLowerCase().endsWith('.json')
  );

  for (const stray of otherFiles) {
    result.unrecognized.push({
      file: stray.originalname,
      reason: `Unsupported extension. Roles and Permissions accepts only .csv or .json.`
    });
    log?.rejectFile('rbp', stray.originalname, 'unsupported extension');
    log?.add({
      section: 'rbp',
      severity: 'warn',
      code: 'rbp.upload.unsupportedExtension',
      message: `Skipped ${stray.originalname} — only .csv / .json files are recognised in this section.`,
      file: stray.originalname
    });
  }

  // 1. Classify CSVs by exact basename first; header-sniff covers the rest.
  for (const file of csvFiles) {
    const lower = file.originalname.toLowerCase();
    let bucket: 'primaryRoles' | 'legacyRoles' | 'roleObjectPermissions' | 'roleSystemPermissions' | null = null;
    let reason: 'basename' | 'header-sniff' = 'basename';

    if (lower === 'rolespermissions.csv' || lower === 'roletoruleinformation.csv') bucket = 'primaryRoles';
    else if (lower === 'roletopermission.csv') bucket = 'roleObjectPermissions';
    else if (lower === 'roletomdfpermission.csv') bucket = 'roleSystemPermissions';
    else if (lower === 'report_roles_report_example.csv') bucket = 'legacyRoles';
    else {
      reason = 'header-sniff';
      bucket = await classifyCsvByHeader(file.path);
    }

    if (!bucket) {
      result.unrecognized.push({
        file: file.originalname,
        reason: 'CSV header did not match any known RBP table.'
      });
      log?.rejectFile('rbp', file.originalname, 'unknown CSV header');
      log?.add({
        section: 'rbp',
        severity: 'warn',
        code: 'rbp.csv.unknownHeader',
        message: `Could not classify ${file.originalname} — its header does not match any known RBP table.`,
        file: file.originalname,
        hint: 'Expected one of: RolesPermissions.csv, RoleToRuleInformation.csv, RoleToPermission.csv, RoleToMDFPermission.csv.'
      });
      continue;
    }

    if (!result.csvPaths[bucket]) {
      result.csvPaths[bucket] = file.path;
      log?.acceptFile('rbp', file.originalname);
      log?.add({
        section: 'rbp',
        severity: 'info',
        code: `rbp.csv.routed.${bucket}`,
        message: `Routed ${file.originalname} → ${bucket} (via ${reason}).`,
        file: file.originalname,
        data: { reason, bucket }
      });
    } else {
      result.unrecognized.push({
        file: file.originalname,
        reason: `Duplicate ${bucket} CSV — keeping the first one and ignoring this.`
      });
      log?.add({
        section: 'rbp',
        severity: 'warn',
        code: 'rbp.csv.duplicate',
        message: `Ignored duplicate ${bucket} CSV: ${file.originalname}.`,
        file: file.originalname
      });
    }
  }

  // 2. Materialise every JSON into a single bundle directory for RbpJsonEngine.
  const jsonsToBundle = [...jsonFiles, ...(jsonBundleOverride ?? [])];
  if (jsonsToBundle.length > 0) {
    const bundleDir = path.join(workspaceDir, 'rbp-json-bundle');
    await fs.ensureDir(bundleDir);

    for (const file of jsonsToBundle) {
      try {
        await fs.copy(file.path, path.join(bundleDir, file.originalname));
      } catch (err) {
        const message = (err as Error).message;
        result.unrecognized.push({ file: file.originalname, reason: `Copy failed: ${message}` });
        log?.add({
          section: 'rbp',
          severity: 'error',
          code: 'rbp.json.copyFailed',
          message: `Failed to materialise ${file.originalname} into the RBP JSON bundle: ${message}`,
          file: file.originalname
        });
        continue;
      }

      const shape = await detectRbpJsonShape(file.path);
      result.jsonShapes.push(shape);
      log?.acceptFile('rbp', file.originalname);
      log?.add({
        section: 'rbp',
        severity: shape === 'unknown' ? 'warn' : 'info',
        code: `rbp.json.shape.${shape}`,
        message: `Detected ${shape} shape in ${file.originalname}.`,
        file: file.originalname,
        data: { shape }
      });
    }
    result.jsonDir = bundleDir;
  }

  return result;
}

/**
 * Classify a CSV file by reading its first non-empty line and matching against
 * the column-name fingerprints of the known RBP tables.
 */
async function classifyCsvByHeader(
  filePath: string
): Promise<'primaryRoles' | 'roleObjectPermissions' | 'roleSystemPermissions' | null> {
  let header: string | null = null;
  try {
    header = await readFirstLine(filePath);
  } catch {
    return null;
  }
  if (!header) return null;

  const cols = parseHeaderColumns(header).map(c => c.trim().toLowerCase());
  const has = (name: string) => cols.includes(name.toLowerCase());

  // Role-Object permissions: "Role Name" + "Permission Object Name"
  if (has('Role Name') && has('Permission Object Name')) return 'roleObjectPermissions';

  // Role-System permissions: "Role Name" + "Permission" (no object), with no "Object" column
  if (has('Role Name') && has('Permission') && !cols.some(c => c.includes('object'))) return 'roleSystemPermissions';

  // Primary roles: "Role Name" + ("Target population" || "Granted population")
  if (has('Role Name') && (has('Target population') || has('Granted population'))) return 'primaryRoles';

  return null;
}

async function readFirstLine(filePath: string): Promise<string | null> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.replace(/^﻿/, '').trim();
      if (trimmed) return trimmed;
    }
    return null;
  } finally {
    rl.close();
    stream.destroy();
  }
}

/** Lightweight CSV-header tokenizer. Handles quoted columns + commas inside quotes. */
function parseHeaderColumns(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out.map(c => c.replace(/^"|"$/g, '').trim());
}

/**
 * Inspect a single RBP role JSON and return the detected schema shape.
 *
 * Shapes seen in real client dumps:
 *  - v2-nested      VariantNested: roleId + roleName + permissions[].section.category.items.subItems[{name,access}]
 *  - v1-flat-strings  VariantFlat `admin-systems.json`: role_name + permissions[].category.items[<multi-line strings>]
 *  - v1-compact     VariantFlat `mobile-access.json`: role + perms[].category.items[<simple strings>]
 *  - unknown        Anything else.
 */
export async function detectRbpJsonShape(filePath: string): Promise<RbpJsonShape> {
  let payload: unknown;
  try {
    payload = await fs.readJson(filePath);
  } catch {
    return 'unknown';
  }
  if (typeof payload !== 'object' || payload === null) return 'unknown';

  const obj = payload as Record<string, unknown>;
  const hasV2Markers =
    typeof obj.roleId !== 'undefined' &&
    (typeof obj.roleName !== 'undefined') &&
    (typeof obj.userType !== 'undefined' || typeof obj.status !== 'undefined');

  if (hasV2Markers && Array.isArray(obj.permissions)) {
    // Confirm V2 by spotting a subItems array somewhere in permissions.
    if (anySubItems(obj.permissions)) return 'v2-nested';
    // V2 markers but no subItems is a degenerate V2 — still treat as V2.
    return 'v2-nested';
  }

  if (typeof obj.role_name !== 'undefined' && Array.isArray(obj.permissions)) return 'v1-flat-strings';
  if (typeof obj.role !== 'undefined' && Array.isArray(obj.perms)) return 'v1-compact';
  if (typeof obj.roleName !== 'undefined' && Array.isArray(obj.permissions)) return 'v1-flat-strings';

  return 'unknown';
}

function anySubItems(permissions: unknown[]): boolean {
  for (const group of permissions) {
    if (typeof group !== 'object' || group === null) continue;
    const items = (group as Record<string, unknown>).items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (typeof item === 'object' && item !== null && Array.isArray((item as Record<string, unknown>).subItems)) {
        return true;
      }
    }
  }
  return false;
}
