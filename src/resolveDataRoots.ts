import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { EngineOptions } from './types.js';

/**
 * SSFFRealinstancefiles bundle layout (in-repo `sample-data/`):
 *
 * - **first-example** (nested folder) — `Object Definitions/`, `RBP Files/` with
 *   `RoleToPermissionJSONS/*.json` (v1 role/perms/assigns), `WorkflowsData/WFInfo.csv`,
 *   `Rules/Rule.csv`, `DataModels/*.xml`.
 * - **client-2** (separate bundle) — per-role RBP JSON (v2), split workflow CSVs,
 *   `RolesPermissions.csv`, `businessrulesassignments.csv`, etc.
 *
 * `resolveDefaultSsffRoot` picks the nested folder under `SSFFRealinstancefiles` that contains
 * `Object Definitions/` with the strongest first-example signals (RBP CSVs, workflow export, JSON count);
 * ties favor `DEFAULT_NESTED_INSTANCE_DIR`, then lexicographic order.
 *
 * `defaultEngineOptionsForRepo` is consumed by the CLI entrypoint (`main.ts`) for benchmarking
 * against a local sample bundle. The public flow (`npm run server` + browser UI) does not depend
 * on any of these paths existing — uploads are routed by the server's ingest endpoints.
 */
const SSFF_INSTANCE = 'SSFFRealinstancefiles';
const LEGACY_OBJECT_DEFS_DIR = 'Object Definitions';
/** Preferred nested sample folder under `SSFFRealinstancefiles` when object defs live in a subfolder. */
const DEFAULT_NESTED_INSTANCE_DIR = 'first-example';

function resolveDefaultSsffRoot(sampleDataRoot: string): string {
  const ssffRoot = path.join(sampleDataRoot, SSFF_INSTANCE);
  const directLayout = path.join(ssffRoot, LEGACY_OBJECT_DEFS_DIR);
  if (existsSync(directLayout)) return ssffRoot;

  try {
    const names = readdirSync(ssffRoot, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .filter(name => existsSync(path.join(ssffRoot, name, LEGACY_OBJECT_DEFS_DIR)))
      .sort((a, b) => a.localeCompare(b, 'en'));

    /** Prefer first-example-style trees when multiple instance folders exist (stable, no folder-name allowlists). */
    const scoreNested = (instanceName: string): number => {
      const base = path.join(ssffRoot, instanceName);
      let s = 0;
      if (existsSync(path.join(base, 'RBP Files', 'RoleToRuleInformation.csv'))) s += 100;
      if (existsSync(path.join(base, 'RBP Files', 'RoleToPermission.csv'))) s += 40;
      if (existsSync(path.join(base, 'RBP Files', 'RoleToMDFPermission.csv'))) s += 40;
      if (existsSync(path.join(base, 'WorkflowsData', 'WFInfo.csv'))) s += 50;
      if (existsSync(path.join(base, 'Rules', 'Rule.csv'))) s += 10;
      const rbpJsonDir = path.join(base, 'RBP Files', 'RoleToPermissionJSONS');
      if (existsSync(rbpJsonDir)) {
        try {
          const n = readdirSync(rbpJsonDir).filter(f => f.toLowerCase().endsWith('.json')).length;
          s += Math.min(n, 80);
        } catch {
          /* ignore */
        }
      }
      const wfInfo = path.join(base, 'WorkflowsData', 'WFInfo.csv');
      if (existsSync(wfInfo)) {
        try {
          s += Math.min(Math.floor(statSync(wfInfo).size / 50_000), 40);
        } catch {
          /* ignore */
        }
      }
      return s;
    };

    let best: string | null = null;
    let bestScore = -1;
    for (const name of names) {
      const sc = scoreNested(name);
      if (sc > bestScore) {
        bestScore = sc;
        best = name;
      } else if (sc === bestScore && best !== null) {
        if (name === DEFAULT_NESTED_INSTANCE_DIR && best !== DEFAULT_NESTED_INSTANCE_DIR) best = name;
        else if (best !== DEFAULT_NESTED_INSTANCE_DIR && name !== DEFAULT_NESTED_INSTANCE_DIR && name.localeCompare(best, 'en') < 0)
          best = name;
      }
    }
    if (best) return path.join(ssffRoot, best);
  } catch {
    /* ignore missing or unreadable ssffRoot */
  }

  return ssffRoot;
}

/** In-repo `<repo>/sample-data/` (gitignored; populated locally for benchmarking). */
export function resolveSampleDataRoot(repoRoot: string): string {
  return path.join(repoRoot, 'sample-data');
}

/** In-repo `<repo>/SSFFArchitectureResearch/` (gitignored; optional reference content). */
export function resolveResearchRoot(repoRoot: string): string {
  return path.join(repoRoot, 'SSFFArchitectureResearch');
}

/** Absolute engine paths for the default SSFF sample bundle (no reliance on `process.cwd()` or repo junctions). */
export function defaultEngineOptionsForRepo(repoRoot: string): EngineOptions {
  const ssff = resolveDefaultSsffRoot(resolveSampleDataRoot(repoRoot));
  const research = resolveResearchRoot(repoRoot);
  return {
    objectDefsDir: path.join(ssff, 'Object Definitions') + path.sep,
    rulesPath: path.join(ssff, 'Rules', 'Rule.csv'),
    rbpPrimaryRoles: path.join(ssff, 'RBP Files', 'RoleToRuleInformation.csv'),
    rbpLegacyRoles: path.join(ssff, 'RBP Files', 'report_Roles_report_example.csv'),
    rbpRoleObjectPermissions: path.join(ssff, 'RBP Files', 'RoleToPermission.csv'),
    rbpRoleSystemPermissions: path.join(ssff, 'RBP Files', 'RoleToMDFPermission.csv'),
    rbpSecurity: path.join(ssff, 'Object Definitions', 'Object Definition-Security.csv'),
    rbpRolePermissionJsonDir: path.join(ssff, 'RBP Files', 'RoleToPermissionJSONS'),
    odataXml: path.join(ssff, 'DataModels', 'ExampleSSFF-Metadata.xml'),
    corporateDataModel: path.join(ssff, 'DataModels', 'CDM-backup-data-model-V1.xml'),
    countrySpecificModels: [path.join(ssff, 'DataModels', 'CSF-for-corporate-DM.xml')],
    foundationReference: path.join(research, 'ListofFObjects.md'),
    filePath: path.join(ssff, 'WorkflowsData', 'WFInfo.csv')
  };
}
