/**
 * Single source of truth for multipart field names + limits on POST /api/projects/:id/ingest
 * and /ingest/detect. The UI FormData whitelist imports `INGEST_MULTIPART_FIELD_NAME_LIST`.
 *
 * Hard-cut history (2026-04-25): the old `objectDefsCsvFiles`, `corporateDm`, and
 * `countryDms` fields were removed when the Import UI consolidated to a single
 * Object Definitions zip dropzone and a single merged Data Model XML dropzone
 * (`dataModelXmls`). External callers must update accordingly — see
 * `docs/DECISIONS.md`.
 */
export const INGEST_MULTIPART_FIELDS = [
  { name: 'objectDefsZip', maxCount: 1 },
  { name: 'rbpFiles', maxCount: 500 },
  { name: 'odataXml', maxCount: 1 },
  /** Combined Corporate (CDM) + Country-Specific (CSF) data model XMLs — server classifies by content + filename. */
  { name: 'dataModelXmls', maxCount: 40 },
  { name: 'successionDm', maxCount: 20 },
  { name: 'countrySuccessionDms', maxCount: 20 },
  { name: 'workflowCsv', maxCount: 20 },
  { name: 'rulesExport', maxCount: 1 },
  { name: 'rulesExportCsv', maxCount: 1 },
  { name: 'rulesExportZip', maxCount: 1 },
  { name: 'workflowSplitCsvs', maxCount: 20 },
  { name: 'rbpJsonBundle', maxCount: 500 },
  { name: 'rbpRolesPermissionsCsv', maxCount: 1 },
  { name: 'businessRulesAssignmentsCsv', maxCount: 1 }
] as const;

/** Plain list for browser `Set` / whitelist checks. */
export const INGEST_MULTIPART_FIELD_NAME_LIST: string[] = INGEST_MULTIPART_FIELDS.map(f => f.name);
