# Architecture Decisions

Locked design decisions for SuccessFactors Instance Explorer. These reflect constraints and trade-offs that are non-obvious from reading the code alone. Full implementation narratives live in `docs/archive/`.

---

## Multi-tenancy & ingest architecture

**Schema detection is content-based, not filename-based.**
Probes in `src/ingest/detect.ts` inspect XML roots, CSV headers, and JSON shapes. File names are unreliable across client exports. The server walks the full project workspace (including nested `uploads/` and `extracted/`) so evidence is not missed when object definitions live in a subfolder.

**RBP parsing is split across two engines, orchestrated by a smart router.**
- `RbpEngine` handles CSV-based role data (`RolesPermissions.csv`, 7-column format).
- `RbpJsonEngine` handles JSON exports in two top-level formats with three concrete shapes:
  - **v2-nested** (VariantNested / client-2): `{ roleId, roleName, userType?, status?, permissions[].section.category.items.subItems[{name, access}] }`
  - **v1-flat-strings** (VariantFlat `admin-systems.json`): `{ role_name | roleName, permissions[].category.items[<multi-line strings>] }`
  - **v1-compact** (VariantFlat `mobile-access.json`): `{ role, perms[].category.items[<simple strings>] }`
- `src/ingest/rbpRouter.ts` (`routeRbpUploads`) accepts any combination of `.csv` + `.json` uploads in a single dropzone, classifies CSVs by basename → header-sniff fallback, classifies JSONs by content-sniff, and materialises every JSON into `<projectDir>/extracted/rbp-json-bundle/`.

**RBP V1-flat bootstraps roles when no CSVs are uploaded.**
Pre-2026-04-25, `RbpJsonEngine` only enriched existing CSV-derived `roleObjectPermissions` rows — meaning VariantFlat JSON-only uploads silently produced zero roles. The V1 path now bootstraps role nodes + synthetic `roleObjectPermissions` rows the same way V2 does. The compact-shape items (no `|` delimiter) collapse into a single `general` row per role with category/permission rollups.

**Engine output vocabulary is frozen; multi-tenancy is on the input side.**
`SFGraph` node/edge types do not change per tenant. All client-specific adaptation happens in `EngineOptions` and `IngestProfile` resolution, before engines run.

**CLI (`main.ts`) stays single-tenant.**
`main.ts` uses the first-project hardcoded layout. All multi-tenant ingest goes through the web server (`POST /api/projects/:id/ingest`) + `detectProfile` + `resolveIngestProfile`. Do not add multi-tenancy to `main.ts`.

**Per-client tuning lives in `src/clients/<slug>.ts`.**
Fields: `ruleBaseObjectOverrides`, `moduleTaxonomyExtensions`, `odataCountrySuffixes`. The `getClientProfile(slug)` registry loads the right pack at ingest time. New tenants: create a new file, register the slug.

**`businessrulesassignments.csv` has a metadata preamble.**
Skip leading non-data lines with `csv-parser skipLines` option — the file begins with boilerplate metadata before the header row. The shared `detectLeadingMetadataLine` helper in `src/engines/utils.ts` is used by every CSV-reading engine; pass `streamCsv(path, fn, { skipLeadingMetadata: true })` to opt in.

**Data Model XMLs (CDM + CSF) collapse to a single Import dropzone.**
The Import UI used to expose two separate dropzones — one for the corporate-data-model XML, one for the country-region-specific XML. Both shipped together in real exports, so we collapsed them into a single `dataModelXmls` slot. The server's `classifyDataModelXmls` helper reads the first 4KB of each XML, matches `<corporate-data-model>` vs `<country-region-data-model>` / `<country-specific-fields>`, and falls back to filename hints (`csf`, `country-specific`) for ambiguous cases. Each routing decision is logged to the IngestLog so the consultant sees how each file was classified.

**Hard-cut deprecated multipart fields (2026-04-25).**
`objectDefsCsvFiles`, `corporateDm`, `countryDms` were removed from `INGEST_MULTIPART_FIELDS`. The Object Definitions step now only accepts the standard `.zip` export. The Data Model step uses the new `dataModelXmls` slot. External callers posting to `/api/projects/:id/ingest` must update accordingly — the multer middleware will reject the old field names.

**IngestLog is the canonical diagnostic surface.**
Every engine accepts `EngineOptions.ingestLog?: IngestLogBuilder` and emits structured `{section, severity, code, message, file?, line?, hint?, data?}` issues. `runPipeline` instantiates one builder, threads it through, and freezes the result on `graph.meta.diagnostics.ingestLog`. The server persists the final log to `<projectDir>/ingest-log.json` and exposes it via `GET /api/projects/:id/ingest-log`. The Import UI renders per-section Markdown reports via the "Export log" button on each upload square. Section names match the 8 Import dropzones: `objectDefs | rbp | odata | dataModel | successionDm | workflow | rulesCatalog | rulesAssignment`.

**RbpJsonEngine v2 bootstrap mode.**
When only a roles-permission JSON is present (no assignments CSV), `RbpJsonEngine` runs in bootstrap mode — emitting role nodes with permission metadata but skipping the assignment edges that require a separate source. Per-file shape detection means a project can mix V2-nested and V1-flat files without one shape blocking the other.

**`RbpJsonEngine` v2 bootstrap mode.**
When only a roles-permission JSON is present (no assignments CSV), `RbpJsonEngine` runs in bootstrap mode — emitting role nodes with permission metadata but skipping the assignment edges that require a separate source.

---

## Compare feature

**Permission data source is `data.json → permissions.*`, not `graph.meta`.**
`roleObjectPermissions` and `roleSystemPermissions` live in the dashboard export (`data.json`), which is the serialized project state. Reading from `graph.meta` directly during compare bypasses DashboardExporter normalization and produces inconsistent results.

**`fieldOverrides` is heterogeneous.**
Values are either bare `"field:value"` strings **or** `{ field, value }` objects — both appear in real client data. Any code reading `fieldOverrides` must handle both shapes. See `ui/lib/matrix/filters.ts:36-73`.

**`fieldItems` needs a multi-fallback read.**
The permission type key varies by export version: try in order `permission | permissionType | actionType | access | fieldPermission`.

**Blast radius v1 = direct-dependents count (O(1)).**
Transitive impact calculation is out of scope for v1. The count shown in the UI is first-degree only.

**Compare mode is available in the Matrix view.**
The permission Matrix supports side-by-side base/target rendering when split compare is active. Keep the single-project path fast first, then validate target-pane rendering against the same diagnostics and leak checks.

---

**Golden snapshot hashes use UTF-16 lexicographic order.**
`src/core/deterministicSort.ts → compareUtf16` ensures hash parity between Linux CI and Windows for the same inputs. Do not replace with `localeCompare` or `<` string comparison.
