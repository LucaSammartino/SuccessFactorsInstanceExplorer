import fs from 'fs-extra';
import path from 'path';
import type { IngestProfile } from './IngestProfile.js';
import { detectProfile } from './detect.js';

export interface UploadPaths {
  objectDefsDir: string | null;
  rulesExtractDir: string | null;
  odataXml: string | null;
  corporateDm: string | null;
  countryDms: string[];
  successionDm: string | null;
  countrySuccessionModels: string[];
  workflowCsv: string | null;
  workflowSplitCsvs: { workflow?: string; dynamicRole?: string; ccRole?: string; contributor?: string };
  rulesExportCsv: string | null;
  businessRulesAssignmentsCsv: string | null;
  rbpPrimaryRoles: string | null;
  rbpLegacyRoles: string | null;
  rbpRoleObjectPermissions: string | null;
  rbpRoleSystemPermissions: string | null;
  rbpRolePermissionJsonDir: string | null;
  rbpSecurity: string | null;
}

export async function resolveIngestProfile(
  projectDir: string,
  uploads: UploadPaths
): Promise<IngestProfile> {
  // Detect against the full project workspace so nested uploads/extracted sources
  // contribute evidence instead of biasing toward object-defs only.
  const detected = await detectProfile(projectDir);
  const slug = detected?.slug ?? 'unknown';
  const displayName = detected?.displayName ?? 'Unknown';

  // Determine RBP JSON schema version by sampling a file
  let rbpJsonSchema: 'v1' | 'v2' = 'v1';
  if (uploads.rbpRolePermissionJsonDir) {
    try {
      const jsonFiles = (await fs.readdir(uploads.rbpRolePermissionJsonDir)).filter(f => f.endsWith('.json'));
      if (jsonFiles.length > 0) {
        const sample = await fs.readJson(path.join(uploads.rbpRolePermissionJsonDir, jsonFiles[0]));
        if ('roleId' in sample && 'status' in sample) rbpJsonSchema = 'v2';
      }
    } catch { /* leave as v1 */ }
  }

  // Determine rules CSV path
  const rulesCsvInsideObjectDefs = slug === 'first-example';
  const resolvedRulesCsv =
    uploads.businessRulesAssignmentsCsv ||
    uploads.rulesExportCsv ||
    (rulesCsvInsideObjectDefs && uploads.objectDefsDir
      ? path.join(uploads.objectDefsDir, 'Rule.csv')
      : null) ||
    undefined;

  // Determine workflow inputs
  const hasSplit =
    !!(
      uploads.workflowSplitCsvs.workflow ||
      uploads.workflowSplitCsvs.ccRole ||
      uploads.workflowSplitCsvs.contributor
    );
  const workflowInputs = hasSplit
    ? { split: uploads.workflowSplitCsvs }
    : { combined: uploads.workflowCsv ?? undefined };

  const profile: IngestProfile = {
    slug,
    displayName,
    sourceRoot: projectDir,
    mdf: {
      objectDefsDir: uploads.objectDefsDir,
      rulesCsvInsideObjectDefs
    },
    rules: {
      exportCsv: resolvedRulesCsv
    },
    dataModel: {
      odataXml: uploads.odataXml ?? undefined,
      corporate: uploads.corporateDm ?? undefined,
      country: uploads.countryDms.length ? uploads.countryDms : undefined,
      succession: uploads.successionDm ?? undefined,
      countrySuccession: uploads.countrySuccessionModels.length ? uploads.countrySuccessionModels : undefined
    },
    rbp: {
      primaryRoles: uploads.rbpPrimaryRoles ?? uploads.rbpSecurity ? uploads.rbpPrimaryRoles ?? undefined : undefined,
      legacyRoles: uploads.rbpLegacyRoles ?? undefined,
      roleObjectPermissions: uploads.rbpRoleObjectPermissions ?? undefined,
      roleSystemPermissions: uploads.rbpRoleSystemPermissions ?? undefined,
      rolePermissionJsonDir: uploads.rbpRolePermissionJsonDir ?? undefined,
      rolePermissionJsonSchema: rbpJsonSchema,
      security: uploads.rbpSecurity ?? undefined
    },
    workflow: workflowInputs,
    clientOverrides: slug !== 'unknown' ? { slug } : undefined
  };

  return profile;
}
