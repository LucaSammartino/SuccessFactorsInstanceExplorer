import path from 'node:path';
import fs from 'fs-extra';
import type { SFGraph } from '../core/GraphSchema.js';
import type { EngineOptions, FieldItem, PopulationAssignment, RoleObjectPermission } from '../types.js';
import type { IngestLogBuilder } from '../ingest/IngestLog.js';
import { existsAsync, isEngineOptionUnset, makeEngineIssueReporter, resolveEngineDataPath } from './utils.js';

const DEFAULT_RBP_JSON_DIR = 'sample-data/SSFFRealinstancefiles/RBP Files/RoleToPermissionJSONS';

const ACTION_TYPE_RULES = [
  { regex: /view\s*history/i, type: 'VIEW_HISTORY' },
  { regex: /view\s*current|\bview\b|ver/i, type: 'VIEW' },
  { regex: /edit\s*\/\s*insert|edit|insert|editar|insertar/i, type: 'EDIT_INSERT' },
  { regex: /correct|corregir/i, type: 'CORRECT' },
  { regex: /delete|eliminar/i, type: 'DELETE' }
] as const;

type JsonPermissionGroup = {
  category?: unknown;
  items?: unknown;
};

type RbpJsonPayload = {
  role_name?: unknown;
  /** Compact VariantFlat shape: `role` instead of `role_name`. */
  role?: unknown;
  /** Some V1 exports use `roleName` (camelCase) without the V2 markers. */
  roleName?: unknown;
  permissions?: unknown;
  /** Compact VariantFlat shape: `perms` instead of `permissions`. */
  perms?: unknown;
  assignments?: unknown;
  assigns?: unknown;
};

/** Detected shape per role JSON file. */
type RbpJsonShape = 'v2-nested' | 'v1-flat' | 'unknown';

// v2 schema (client-2): {roleId, roleName, status, userType, permissions:[{section, category, items}]}
type RbpJsonPayloadV2 = {
  roleId?: unknown;
  roleName?: unknown;
  status?: unknown;
  userType?: unknown;
  /** Array of {section, category, items:[{name, subItems:[{name, access}]}]} */
  permissions?: unknown;
  /** Legacy alias used in some drafts — kept for fallback */
  section?: unknown;
  assignments?: unknown;
};

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null;
}

function isV2Schema(raw: unknown): raw is RbpJsonPayloadV2 {
  if (!isRecord(raw)) return false;
  // VariantNested pattern: roleId + roleName + (userType OR status). Don't require all three —
  // some V2 exports omit `userType` when the role has no user-type lock.
  if (!('roleId' in raw) || !('roleName' in raw)) return false;
  return 'userType' in raw || 'status' in raw;
}

function isV1Schema(raw: unknown): raw is RbpJsonPayload {
  if (!isRecord(raw)) return false;
  if ('role_name' in raw && Array.isArray(raw.permissions)) return true;
  if ('role' in raw && Array.isArray(raw.perms)) return true;
  if ('roleName' in raw && Array.isArray(raw.permissions)) return true;
  return false;
}

function toPermissionGroups(raw: unknown): JsonPermissionGroup[] {
  return Array.isArray(raw) ? raw.filter(isRecord) : [];
}

function toRecords(raw: unknown): Record<string, unknown>[] {
  return Array.isArray(raw) ? raw.filter(isRecord) : [];
}

function toActionStrings(raw: unknown): string[] {
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split('|').map(value => value.trim()).filter(Boolean);
  }
  if (Array.isArray(raw)) {
    return raw.map(value => `${value}`.trim()).filter(Boolean);
  }
  return [];
}

function toActionsFromAccessOrActions(access: unknown, actions: unknown): string[] {
  const accessActions = toActionStrings(access);
  return accessActions.length > 0 ? accessActions : toActionStrings(actions);
}

/** Per-file schema detector — V2 takes precedence; otherwise V1 if any flat shape matches. */
function detectShape(raw: unknown): RbpJsonShape {
  if (!isRecord(raw)) return 'unknown';
  if (isV2Schema(raw)) return 'v2-nested';
  if (isV1Schema(raw)) return 'v1-flat';
  return 'unknown';
}

/** Pick a role display name from any of the known V1 keys, falling back to filename. */
function resolveV1RoleName(raw: unknown, fileName: string): string {
  if (isRecord(raw)) {
    const candidate =
      `${raw.role_name ?? ''}`.trim() ||
      `${raw.roleName ?? ''}`.trim() ||
      `${raw.role ?? ''}`.trim();
    if (candidate) return candidate;
  }
  return fileName.replace(/\.json$/i, '').replace(/^\d+_/, '').trim();
}

/** Prefer CSV / RbpEngine role node keys (Role Name) over numeric JSON roleId so permissions join the same node. */
function resolveV2RoleNodeId(
  graph: SFGraph,
  roleIdRaw: string,
  roleName: string,
  payload: RbpJsonPayloadV2
): string | null {
  const nameKey = `${roleName || ''}`.trim();
  const idKey = `${roleIdRaw || ''}`.trim();

  if (nameKey && graph.nodes.get(nameKey)?.type === 'RBP_ROLE') return nameKey;
  if (idKey && graph.nodes.get(idKey)?.type === 'RBP_ROLE') return idKey;

  const primary = idKey || nameKey;
  if (!primary) return null;

  if (!graph.nodes.has(primary)) {
    graph.addNode(primary, 'RBP_ROLE', {
      label: nameKey || primary,
      userType: `${payload.userType || ''}`.trim() || undefined,
      status: `${payload.status || ''}`.trim() || undefined,
      roleSource: 'rbp-json-v2'
    });
  }
  return primary;
}

/** Minimum fuzzy-match score to treat an MDF object as the permission surface (avoid weak false positives). */
const V2_OBJECT_MATCH_MIN_SCORE = 8;

function matchMdfObjectIdForHint(graph: SFGraph, objectHint: string): string | null {
  const hintNorm = normalizeKey(objectHint);
  if (!hintNorm) return null;
  const hintTokens = tokenSetForNorm(hintNorm);

  let bestId: string | null = null;
  let bestScore = 0;

  for (const node of graph.nodes.values()) {
    if (node.type !== 'MDF_OBJECT') continue;
    const idNorm = normalizeKey(node.id);
    const labelNorm = normalizeKey(`${node.label || ''}`);
    let score = 0;
    if (idNorm === hintNorm || labelNorm === hintNorm) {
      score = 100;
    } else {
      if (labelNorm.includes(hintNorm) || hintNorm.includes(labelNorm)) score = Math.max(score, 45);
      if (idNorm.includes(hintNorm) || hintNorm.includes(idNorm)) score = Math.max(score, 40);
      score += overlapScoreSets(hintTokens, tokenSetForNorm(labelNorm)) * 4;
      score += overlapScoreSets(hintTokens, tokenSetForNorm(idNorm)) * 3;
    }

    if (score > bestScore) {
      bestScore = score;
      bestId = node.id;
    }
  }

  if (bestId && bestScore >= V2_OBJECT_MATCH_MIN_SCORE) return bestId;
  return null;
}

/**
 * Map JSON permission surface labels to MDF object ids when possible; otherwise ensure a placeholder MDF node
 * so `prepareData` keeps role–object rows and the permission matrix can render.
 */
function resolveV2ObjectHintToGraphObjectId(graph: SFGraph, objectHint: string): string {
  const hint = `${objectHint || ''}`.trim();
  if (!hint) return 'general';

  const matched = matchMdfObjectIdForHint(graph, hint);
  if (matched) return matched;

  if (!graph.nodes.has(hint)) {
    graph.addNode(hint, 'MDF_OBJECT', {
      label: hint,
      moduleFamily: 'Unclassified',
      subModule: 'RBP JSON',
      rbpJsonPermissionSurface: true
    });
  }
  return hint;
}

type EntryScored = {
  entry: RoleObjectPermission;
  objectLabel: string;
  objectLabelNorm: string;
  objectIdNorm: string;
  labelTokens: Set<string>;
  idTokens: Set<string>;
};

const normKeyCache = new Map<string, string>();

export class RbpJsonEngine {
  graph: SFGraph;
  jsonDir: string;
  _usingDefaultJsonDir: boolean;
  ingestLog?: IngestLogBuilder;

  constructor(graph: SFGraph, options: EngineOptions = {}) {
    this.graph = graph;
    this.jsonDir = resolveEngineDataPath(options.rbpRolePermissionJsonDir, DEFAULT_RBP_JSON_DIR);
    this._usingDefaultJsonDir = isEngineOptionUnset(options.rbpRolePermissionJsonDir);
    this.ingestLog = options.ingestLog;
  }

  /** Mutates the shared graph with field-level role permissions parsed from V1/V2 RBP JSON exports. */
  async run(): Promise<void> {
    normKeyCache.clear();
    if (!(await existsAsync(this.jsonDir))) {
      if (this._usingDefaultJsonDir) console.log('[RBP JSON Engine] skipping - no path configured');
      else console.log(`[RBP JSON Engine] Directory not found, skipping: ${this.jsonDir || '(empty)'}`);
      return;
    }

    const files = (await fs.readdir(this.jsonDir))
      .filter((name: string) => name.toLowerCase().endsWith('.json'));

    if (files.length === 0) {
      console.log('[RBP JSON Engine] No JSON files found; skipping.');
      return;
    }

    let v2Bootstrapped = 0;
    let v1Bootstrapped = 0;
    let v1Enriched = 0;
    let parsedFieldItems = 0;
    let parsedAssignments = 0;
    const shapeCounts: Record<RbpJsonShape, number> = { 'v2-nested': 0, 'v1-flat': 0, unknown: 0 };

    for (const fileName of files) {
      const fullPath = path.join(this.jsonDir, fileName);
      let payload: unknown;
      try {
        payload = await fs.readJson(fullPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[RBP JSON Engine] Failed to read ${fileName}: ${message}`);
        makeEngineIssueReporter(this.ingestLog, 'rbp', 'RbpJsonEngine', fileName)?.({
          severity: 'warn',
          code: 'rbp.json.parseFailed',
          message: `Failed to read ${fileName}: ${message}`
        });
        continue;
      }

      const shape = detectShape(payload);
      shapeCounts[shape] += 1;

      if (isV2Schema(payload)) {
        const stats = this.bootstrapV2(payload, fileName);
        v2Bootstrapped += stats.bootstrappedRoles;
        parsedFieldItems += stats.fieldItems;
        continue;
      }

      if (isV1Schema(payload)) {
        const permissionGroups = payload.permissions ?? payload.perms;
        const fieldItems = extractFieldItems(permissionGroups);
        const compactPermissions = fieldItems.length === 0 ? extractCompactPermissions(permissionGroups) : [];
        const populationAssignments = extractPopulationAssignments(payload);
        parsedFieldItems += fieldItems.length;
        parsedAssignments += populationAssignments.length;

        const roleName = resolveV1RoleName(payload, fileName);

        // Existing CSV-derived rows for this role decide enrichment vs bootstrap.
        const summaries = this.graph.meta.roleObjectPermissions || [];
        const roleEntries = summaries.filter(entry => entry.roleId === roleName);

        if (roleEntries.length > 0) {
          const enriched = this.enrichV1ExistingRows(roleEntries, fieldItems, populationAssignments);
          v1Enriched += enriched;
        } else {
          const bootstrapped = this.bootstrapV1(roleName, fieldItems, populationAssignments, compactPermissions);
          if (bootstrapped > 0) v1Bootstrapped += 1;
        }
        continue;
      }

      // Unknown shape — surface a warn so the consultant can fix the upload.
      makeEngineIssueReporter(this.ingestLog, 'rbp', 'RbpJsonEngine', fileName)?.({
        severity: 'warn',
        code: 'rbp.json.shape.unknown',
        message: `Skipped ${fileName} — could not detect a known RBP JSON shape (V2-nested or V1-flat).`,
        hint: 'Expected one of: { roleId, roleName, permissions[].subItems } (V2) or { role_name | role, permissions | perms } (V1).'
      });
    }

    const summary = {
      v2Bootstrapped,
      v1Bootstrapped,
      v1Enriched,
      parsedFieldItems,
      parsedAssignments,
      shapeCounts
    };
    console.log(
      `[RBP JSON Engine] Done. v2-nested bootstrapped: ${v2Bootstrapped}, v1-flat bootstrapped: ${v1Bootstrapped}, v1-flat enriched: ${v1Enriched}, field items: ${parsedFieldItems}, assignments: ${parsedAssignments}`
    );
    this.graph.addEngineDiagnostic?.('rbpJson', summary);

    if (shapeCounts.unknown > 0) {
      makeEngineIssueReporter(this.ingestLog, 'rbp', 'RbpJsonEngine')?.({
        severity: 'warn',
        code: 'rbp.json.shape.unknownCount',
        message: `${shapeCounts.unknown} role JSON file(s) had an unrecognised shape and were skipped.`,
        data: { ...shapeCounts }
      });
    }
  }

  /** Bootstrap mode for V2-nested files (VariantNested). Returns counts for the summary. */
  private bootstrapV2(payload: RbpJsonPayloadV2, fileName: string): { bootstrappedRoles: number; fieldItems: number } {
    const roleIdRaw = `${payload.roleId || ''}`.trim();
    const roleName =
      `${payload.roleName || ''}`.trim() ||
      fileName.replace(/^\d+_/, '').replace(/\.json$/i, '').trim();

    const roleKey = resolveV2RoleNodeId(this.graph, roleIdRaw, roleName, payload);
    if (!roleKey) return { bootstrappedRoles: 0, fieldItems: 0 };

    const fieldItems = extractFieldItemsV2(payload.permissions ?? payload.section);
    if (fieldItems.length === 0) return { bootstrappedRoles: 0, fieldItems: 0 };

    const byObject = new Map<string, FieldItem[]>();
    for (const fi of fieldItems) {
      const hint = fi.objectHint || 'general';
      const objectKey = resolveV2ObjectHintToGraphObjectId(this.graph, hint);
      if (!byObject.has(objectKey)) byObject.set(objectKey, []);
      byObject.get(objectKey)!.push(fi);
    }

    const existing = (this.graph.meta.roleObjectPermissions ??= []);
    const populationAssignments = extractPopulationAssignmentsV2(payload);
    for (const [objectId, rawItems] of byObject) {
      const deduped = dedupeFieldItems(rawItems);
      const actionTypesRollup = Array.from(new Set(deduped.flatMap(i => i.actionTypes || []))).sort();
      existing.push({
        roleId: roleKey,
        objectId,
        permissions: Array.from(new Set(deduped.flatMap(i => i.actions))),
        categories: Array.from(new Set(deduped.map(i => i.category).filter(Boolean))),
        structures: [],
        fieldOverrides: [],
        searchText: `${roleKey} ${roleName} ${objectId}`.toLowerCase(),
        fieldItems: deduped,
        fieldItemCount: deduped.length,
        actionTypesRollup,
        populationAssignments
      });
    }
    return { bootstrappedRoles: 1, fieldItems: fieldItems.length };
  }

  /**
   * V1-flat bootstrap path (VariantFlat). Used when no RBP CSVs were uploaded — the role
   * does not exist as an RBP_ROLE node yet, and there are no `roleObjectPermissions`
   * to enrich. Synthesises a role node + one `roleObjectPermissions` entry per
   * resolved MDF object so the permission matrix can render.
   *
   * `compactPermissions` carries simple-string permissions (VariantFlat compact shape:
   * `{ role, perms: [{ category, items: ['Mobile Access', …] }] }`) where there's no
   * field-level breakdown. Each becomes a categories/permissions roll-up on a single
   * synthetic row so the role still surfaces in the matrix.
   */
  private bootstrapV1(
    roleName: string,
    fieldItems: FieldItem[],
    populationAssignments: PopulationAssignment[],
    compactPermissions: Array<{ category: string; items: string[] }> = []
  ): number {
    const hasCompact = compactPermissions.some(p => p.items.length > 0);
    if (
      !roleName ||
      (fieldItems.length === 0 && populationAssignments.length === 0 && !hasCompact)
    ) {
      return 0;
    }

    if (!this.graph.nodes.has(roleName)) {
      this.graph.addNode(roleName, 'RBP_ROLE', { label: roleName, roleSource: 'rbp-json-v1' });
    }

    const byObject = new Map<string, FieldItem[]>();
    for (const fi of fieldItems) {
      const hint = fi.objectHint || 'general';
      const objectKey = resolveV2ObjectHintToGraphObjectId(this.graph, hint);
      if (!byObject.has(objectKey)) byObject.set(objectKey, []);
      byObject.get(objectKey)!.push(fi);
    }

    const existing = (this.graph.meta.roleObjectPermissions ??= []);

    if (byObject.size === 0) {
      // Compact / pure-assignment payload — keep a synthetic generic row so the role surfaces in the UI.
      const flatPermissions = Array.from(new Set(compactPermissions.flatMap(p => p.items))).sort();
      const flatCategories = Array.from(new Set(compactPermissions.map(p => p.category).filter(Boolean))).sort();
      if (flatPermissions.length === 0 && populationAssignments.length === 0) return 0;
      existing.push({
        roleId: roleName,
        objectId: 'general',
        permissions: flatPermissions,
        categories: flatCategories,
        structures: [],
        fieldOverrides: [],
        searchText: `${roleName} general ${flatPermissions.join(' ')}`.toLowerCase(),
        fieldItems: [],
        fieldItemCount: 0,
        actionTypesRollup: [],
        populationAssignments
      });
      return 1;
    }

    let added = 0;
    for (const [objectId, rawItems] of byObject) {
      const deduped = dedupeFieldItems(rawItems);
      const actionTypesRollup = Array.from(new Set(deduped.flatMap(i => i.actionTypes || []))).sort();
      existing.push({
        roleId: roleName,
        objectId,
        permissions: Array.from(new Set(deduped.flatMap(i => i.actions))),
        categories: Array.from(new Set(deduped.map(i => i.category).filter(Boolean))),
        structures: [],
        fieldOverrides: [],
        searchText: `${roleName} ${objectId}`.toLowerCase(),
        fieldItems: deduped,
        fieldItemCount: deduped.length,
        actionTypesRollup,
        populationAssignments
      });
      added += 1;
    }
    return added;
  }

  /** Pre-2026 V1 enrichment behaviour: enrich existing CSV-derived rows. */
  private enrichV1ExistingRows(
    roleEntries: RoleObjectPermission[],
    fieldItems: FieldItem[],
    populationAssignments: PopulationAssignment[]
  ): number {
    if (fieldItems.length === 0 && populationAssignments.length === 0) return 0;

    const scored: EntryScored[] = roleEntries.map(entry => {
      const objectLabel = `${this.graph.nodes.get(entry.objectId)?.label || entry.objectId}`;
      const objectLabelNorm = normalizeKey(objectLabel);
      const objectIdNorm = normalizeKey(entry.objectId);
      return {
        entry,
        objectLabel,
        objectLabelNorm,
        objectIdNorm,
        labelTokens: tokenSetForNorm(objectLabelNorm),
        idTokens: tokenSetForNorm(objectIdNorm)
      };
    });

    const matchedByEntry = new Map<RoleObjectPermission, FieldItem[]>(
      roleEntries.map(entry => [entry, [] as FieldItem[]])
    );

    for (const item of fieldItems) {
      const match = matchFieldItemToEntry(item, scored);
      if (!match) continue;
      matchedByEntry.get(match)!.push(item);
    }

    let enrichedRows = 0;
    roleEntries.forEach(entry => {
      const matchedItems = dedupeFieldItems(matchedByEntry.get(entry) || []);
      const actionTypesRollup = Array.from(new Set(matchedItems.flatMap(item => item.actionTypes || []))).sort();
      entry.fieldItems = matchedItems;
      entry.fieldItemCount = matchedItems.length;
      entry.actionTypesRollup = actionTypesRollup;
      entry.populationAssignments = populationAssignments;
      if (matchedItems.length > 0 || populationAssignments.length > 0) enrichedRows += 1;
    });
    return enrichedRows;
  }
}

function extractFieldItems(permissionGroups: unknown): FieldItem[] {
  const groups = toPermissionGroups(permissionGroups);
  const items: FieldItem[] = [];

  for (const group of groups) {
    const category = `${group.category || ''}`.trim();
    const groupItems = Array.isArray(group.items) ? group.items : [];

    for (const raw of groupItems) {
      if (typeof raw !== 'string') continue;
      parsePermissionItem(raw, category).forEach(entry => items.push(entry));
    }
  }

  return dedupeFieldItems(items);
}

/**
 * Compact V1 shape (VariantFlat `mobile-access.json`) where `items` is an array of
 * single-string permission names with no field-level structure. Falls through
 * `parsePermissionItem` with no result, so we capture the raw item names here
 * to roll up into a synthetic permission row in the V1 bootstrap path.
 */
function extractCompactPermissions(permissionGroups: unknown): Array<{ category: string; items: string[] }> {
  const groups = toPermissionGroups(permissionGroups);
  const out: Array<{ category: string; items: string[] }> = [];
  for (const group of groups) {
    const category = `${group.category || ''}`.trim();
    const groupItems = Array.isArray(group.items) ? group.items : [];
    const collected: string[] = [];
    for (const raw of groupItems) {
      if (typeof raw !== 'string') continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      // Only treat as compact when there's no embedded action delimiter — otherwise
      // it's a structured V1 string handled by parsePermissionItem.
      if (trimmed.includes('|')) continue;
      collected.push(trimmed.split('\n')[0].trim());
    }
    if (collected.length > 0) out.push({ category, items: collected });
  }
  return out;
}

/**
 * v2 parser — two accepted shapes:
 *
 * Shape A (typical client-2 / v2 export):
 *   permissions: [{section, category, items: [{name, subItems: [{name, access: "View | Edit"}]}]}]
 *
 * Shape B (legacy object-keyed, kept for fallback):
 *   section: { "User Permissions": { category, items: [{name, subItems: [{name, actions: [...]}]}] } }
 *
 * Accepts `permissions` array (primary) or a `section` object (fallback).
 */
function extractFieldItemsV2(permissionsOrSection: unknown): FieldItem[] {
  const items: FieldItem[] = [];

  if (Array.isArray(permissionsOrSection)) {
    // Shape A: permissions array
    for (const group of permissionsOrSection) {
      if (!isRecord(group)) continue;
      const category = `${group.category ?? group.section ?? ''}`.trim();
      const groupItems = Array.isArray(group.items) ? group.items : [];

      for (const item of groupItems) {
        if (!isRecord(item)) continue;
        const objectHint = `${item.name ?? item.label ?? ''}`.trim();
        if (!objectHint) continue;

        const subItems = Array.isArray(item.subItems) ? item.subItems : [];
        for (const sub of subItems) {
          if (!isRecord(sub)) continue;
          const fieldName = `${sub.name ?? sub.label ?? ''}`.trim();
          if (!fieldName) continue;

          // access: "View | Edit | Insert" OR actions: ["View", "Edit"]
          const rawActions = toActionsFromAccessOrActions(sub.access, sub.actions);
          if (rawActions.length === 0) continue;

          items.push({
            objectHint,
            fieldName,
            actions: rawActions,
            actionTypes: normalizeActionTypes(rawActions),
            category
          });
        }
      }
    }
  } else if (typeof permissionsOrSection === 'object' && permissionsOrSection !== null) {
    // Shape B: section object keyed by section name
    if (!isRecord(permissionsOrSection)) return dedupeFieldItems(items);
    for (const sectionKey of Object.keys(permissionsOrSection)) {
      const sectionEntry = permissionsOrSection[sectionKey];
      if (!isRecord(sectionEntry)) continue;
      const sectionRecord = sectionEntry;
      const rawItems = Array.isArray(sectionRecord.items)
        ? sectionRecord.items
        : Object.values(sectionRecord).filter(Array.isArray).flat();
      const category = `${sectionRecord.category ?? sectionKey}`.trim();

      for (const item of rawItems) {
        if (!isRecord(item)) continue;
        const objectHint = `${item.name ?? item.label ?? ''}`.trim();
        if (!objectHint) continue;
        const subItems = Array.isArray(item.subItems) ? item.subItems : [];
        for (const sub of subItems) {
          if (!isRecord(sub)) continue;
          const fieldName = `${sub.name ?? sub.label ?? ''}`.trim();
          if (!fieldName) continue;
          const rawActions = toActionsFromAccessOrActions(sub.access, sub.actions);
          if (rawActions.length === 0) continue;
          items.push({
            objectHint,
            fieldName,
            actions: rawActions,
            actionTypes: normalizeActionTypes(rawActions),
            category
          });
        }
      }
    }
  }

  return dedupeFieldItems(items);
}

function parsePermissionItem(raw: string, category: string): FieldItem[] {
  const lines = `${raw || ''}`
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  let objectHint = sanitizeHeader(lines[0]);
  const parsed: FieldItem[] = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];

    if (looksLikeSectionHeader(current)) {
      objectHint = sanitizeHeader(current);
      continue;
    }

    if (!looksLikeActionLine(next)) continue;

    const actions = next
      .split('|')
      .map(value => value.trim())
      .filter(Boolean);
    if (actions.length === 0) continue;

    parsed.push({
      objectHint,
      fieldName: current,
      actions,
      actionTypes: normalizeActionTypes(actions),
      category
    });
  }

  return parsed;
}

/** Extract population assignments from v2 JSON (column names: ID, Name, Access Population). */
function extractPopulationAssignmentsV2(payload: RbpJsonPayloadV2): PopulationAssignment[] {
  const assignments = toRecords(payload.assignments);
  return assignments
    .map(entry => ({
      id: `${entry['ID'] ?? entry['id'] ?? ''}`.trim(),
      name: `${entry['Name'] ?? entry['name'] ?? ''}`.trim(),
      population: `${entry['Access Population'] ?? entry['population'] ?? ''}`.trim()
    }))
    .filter(e => e.id || e.name || e.population);
}

function extractPopulationAssignments(payload: RbpJsonPayload): PopulationAssignment[] {
  const assignments = Array.isArray(payload.assignments)
    ? toRecords(payload.assignments)
    : Array.isArray(payload.assigns)
      ? toRecords(payload.assigns)
      : [];

  return assignments.map(entry => ({
    id: `${entry.id || ''}`.trim(),
    name: `${entry.name || ''}`.trim(),
    population: `${entry.population || ''}`.trim()
  })).filter(entry => entry.id || entry.name || entry.population);
}

function matchFieldItemToEntry(fieldItem: FieldItem, scored: EntryScored[]): RoleObjectPermission | null {
  const fieldNameNorm = normalizeKey(fieldItem.fieldName);
  const objectHintNorm = normalizeKey(fieldItem.objectHint);
  if (!objectHintNorm) return null;
  const objectHintTokens = tokenSetForNorm(objectHintNorm);

  let bestEntry: RoleObjectPermission | null = null;
  let bestScore = 0;

  for (const row of scored) {
    const objectLabelNorm = row.objectLabelNorm;
    const objectIdNorm = row.objectIdNorm;
    let score = 0;

    if (objectLabelNorm.includes(objectHintNorm) || objectIdNorm.includes(objectHintNorm)) {
      score += 6;
    }
    if (objectHintNorm.includes(objectLabelNorm) || objectHintNorm.includes(objectIdNorm)) {
      score += 4;
    }

    const overlap =
      overlapScoreSets(objectHintTokens, row.labelTokens) + overlapScoreSets(objectHintTokens, row.idTokens);
    score += overlap;

    if (fieldNameNorm && (objectLabelNorm.includes(fieldNameNorm) || objectIdNorm.includes(fieldNameNorm))) {
      score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestEntry = row.entry;
    }
  }

  if (bestEntry) return bestEntry;
  if (scored.length === 1) return scored[0].entry;
  return null;
}

function dedupeFieldItems(items: FieldItem[]): FieldItem[] {
  const seen = new Set<string>();
  const output: FieldItem[] = [];

  for (const item of items) {
    const key = [
      normalizeKey(item.objectHint),
      normalizeKey(item.fieldName),
      (item.actions || []).map(action => normalizeKey(action)).join('|')
    ].join('::');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
}

function normalizeActionTypes(actions: string[]): string[] {
  const actionTypes = new Set<string>();

  for (const action of actions) {
    const raw = `${action || ''}`.trim();
    let matched = false;
    for (const rule of ACTION_TYPE_RULES) {
      if (rule.regex.test(raw)) {
        actionTypes.add(rule.type);
        matched = true;
      }
    }
    if (!matched) actionTypes.add('OTHER');
  }

  return Array.from(actionTypes).sort();
}

function looksLikeActionLine(value: string): boolean {
  const normalized = `${value || ''}`.trim();
  if (!normalized.includes('|')) return false;
  return /view|edit|insert|delete|correct|history/i.test(normalized);
}

function looksLikeSectionHeader(value: string): boolean {
  const text = `${value || ''}`.trim();
  if (!text) return false;
  if (text.includes('†')) return true;
  if (/\bactions?\b/i.test(text)) return true;
  if (/\bpermissions?\b/i.test(text) && !text.includes('|')) return true;
  return false;
}

function sanitizeHeader(value: string): string {
  return `${value || ''}`
    .replace(/†/g, '')
    .replace(/\s*actions?\s*$/i, '')
    .trim();
}

function tokenSetForNorm(norm: string): Set<string> {
  return new Set(norm.split(' ').filter(Boolean));
}

function overlapScoreSets(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let matches = 0;
  small.forEach(token => {
    if (large.has(token)) matches += 1;
  });
  return matches;
}

function normalizeKeyCore(value: string): string {
  return `${value || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeKey(value: string): string {
  const hit = normKeyCache.get(value);
  if (hit !== undefined) return hit;
  const out = normalizeKeyCore(value);
  normKeyCache.set(value, out);
  return out;
}

function buildGroupedMap<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  items.forEach(item => {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  });
  return map;
}
