# Graph contract — SuccessFactors metadata → `SFGraph`

This document is the **authoritative internal spec** for what the ingestion pipeline promises to build: what every node, edge, and meta payload is allowed to contain.

## Pipeline order

1. **MdfEngine** — MDF object definitions, associations, object-level rule bindings (`Object Definition*.csv`).
2. **DataModelEngine** — Foundation list markdown, corporate + country-specific data model XML; enriches object taxonomy on existing nodes.
3. **RuleEngine** — Business rules (`Rules/Rule.csv`); `MODIFIES` edges to base objects where resolvable.
4. **RbpEngine** — RBP roles, object security, role permissions from CSV (summaries in `graph.meta`; selective node/edge inflation).
5. **RbpJsonEngine** — RBP roles and permissions from JSON exports (v1: `role`/`perms`/`assigns` shape; v2: `roleId`/`status`/`userType` hierarchical shape).
6. **ODataEngine** — OData entity sets from EDMX; links to MDF where applicable.
7. **WorkflowEngine** — Normalized workflow summary into `graph.meta.workflow` (not graph nodes/edges by default).
8. **RulesAssignmentEngine** — Business rule assignments (`businessrulesassignments.csv` or `jobResponse*.csv`); links rules to triggering objects.
9. **ModuleClassifier** — Module family/label/subModule for search and UI facets.

## Node types (`addNode` primary `type`)

| Type | Source | Role |
|------|--------|------|
| `MDF_OBJECT` | MDF CSVs, DataModel XML, RBP security | Configurable / FO / GO objects and fields |
| `BUSINESS_RULE` | Rule.csv, MDF rule bindings | Rules; linked via `MODIFIES` and/or `TRIGGERED_BY` |
| `RBP_ROLE` | RBP CSVs | Permission roles (populations, permission summaries) |
| `ODATA_ENTITY` | EDMX | API-exposed entity sets |

Nodes may gain **secondary types** (e.g. `ODATA_ENTITY` merged onto an MDF object) and fields such as `objectClass`, `objectTechnology`, `moduleFamily`, `odataExposed`.

## Edge types (`addEdge` `type`)

| Type | Meaning |
|------|---------|
| `ASSOCIATION` | MDF association between objects |
| `TRIGGERED_BY` | Object → rule (object definition rule binding) |
| `MODIFIES` | Object → rule (rule base object / field modifications) |
| `EXPOSES` | OData entity set → matched MDF object |

Edges whose endpoints are missing from `nodes` remain in `graph.edges` but are excluded from `getRenderableData()` (dropped-edge diagnostics).

## Meta payloads (`graph.meta`)

| Key | Producer | Contents |
|-----|----------|----------|
| `dataModels` | DataModelEngine | Summary counts, by-class/by-technology, source filenames |
| `workflow` | WorkflowEngine | Parsed WFInfo.csv summary, stats, diagnostics |
| `roleObjectPermissions` / `roleSystemPermissions` | RbpEngine | Tabular permission summaries for UI |
| `diagnostics.engines.<name>` | per-engine | Free-form summary stats (`parsedRules`, `bootstrapped`, …) |
| `diagnostics.unresolvedRuleBaseObjects` | RuleEngine | Rules whose base object could not be resolved |
| `diagnostics.ingestLog` | `runPipeline` | Structured per-section ingest issues (see below) |

### `diagnostics.ingestLog` shape

Frozen `IngestLog` produced by `runPipeline` at the end of every ingest. Persisted to `<projectDir>/ingest-log.json` by the server and exposed via `GET /api/projects/:id/ingest-log` for the UI Export-log buttons.

```ts
{
  startedAt: string;         // ISO timestamp
  finishedAt: string;        // ISO timestamp
  profileSlug: string | null;
  issues: Array<{
    section: 'objectDefs' | 'rbp' | 'odata' | 'dataModel'
           | 'successionDm' | 'workflow' | 'rulesCatalog' | 'rulesAssignment';
    engine?: string;
    severity: 'info' | 'warn' | 'error';
    code: string;       // dotted token, e.g. 'csv.metadataLine.skipped', 'rbp.json.shape.v2-nested'
    message: string;
    file?: string;      // basename only — never absolute paths (Windows-safe)
    line?: number;
    hint?: string;
    data?: Record<string, unknown>;
  }>;
  filesAccepted: Record<IngestSection, string[]>;   // basenames per section
  filesRejected: Record<IngestSection, Array<{ file: string; reason: string }>>;
}
```

The eight `section` values match the eight Import dropzones and are the keys the UI Export-log buttons filter by.

## Coverage matrix — SSFF concept vs implementation

Legend: **Y** = modeled in graph/meta, **P** = partial / summary only, **N** = not modeled, **T** = covered by golden snapshot test.

| SSFF / doc topic | Engine(s) | Graph | Meta | Golden snapshot |
|------------------|-----------|-------|------|-----------------|
| MDF object definitions | MdfEngine, DataModelEngine | Y | Y | T |
| MDF associations | MdfEngine | Y | — | T |
| Object-level rule bindings | MdfEngine | Y | — | T |
| Business rules + base object | RuleEngine | Y | diagnostics | T |
| RBP roles & populations | RbpEngine | Y | Y | T |
| RBP permission matrix (full explosion) | RbpEngine | P | Y | T |
| OData entity sets | ODataEngine | Y | — | T |
| Workflow definitions (WFInfo) | WorkflowEngine | N | Y | T (meta counts) |
| Country-specific data model | DataModelEngine | Y (fields on nodes) | Y | T |
| Foundation object taxonomy | DataModelEngine | Y | Y | T |
| Module / product grouping | ModuleClassifier | fields on nodes | — | T (IDs stable post-classifier) |
| IAS, Integration Center, IC triggers | — | N | N | — |
| Real-time / eventing semantics | — | N | N | — |

Update this table when you add engines or change what the UI promises.

## Conformance tooling

- **`src/conformance/graphSnapshot.js`** — `buildGoldenSnapshot(graph)` (full list of node ids per type + edge fingerprints); **`buildGoldenSnapshotLite(graph)`** (counts, meta, SHA-256 of edges + node inventory for smaller PR diffs).
- **`src/conformance/exportSnapshot.js`** — **`buildDashboardExportLite(graph)`** (stable summary of `buildDashboardExport`, what ends up in per-project `data.json` / UI load); **`dashboardExportHasExpectedShape(exp)`** (top-level keys + `permissions` sub-keys).
- **`src/conformance/GraphValidator.js`** — `validateGraphIntegrity(graph)` (MODIFIES/TRIGGERED_BY source/target, ASSOCIATION endpoints, EXPOSES OData-source/MDF-target semantics); helpers `nodeIsBusinessRule`, `nodeIsODataEntity`, `nodeIsValidModifiesOrTriggerSource`.

The serialized dashboard export is the compatibility boundary for the UI and API. Intentional ingestion changes should be reviewed against this contract before release.

Golden hashes use **UTF-16 lexicographic order** (`src/core/deterministicSort.js` → `compareUtf16`) instead of default `localeCompare`, and **`ArchitecturalStats` tie-breaks** numeric sorts with stable id/label keys so **`statsSha256` / `nodeInventorySha256` / `renderableNodeInventorySha256` match Linux CI and Windows** for the same inputs.

## Structural validation (`GraphValidator`)

- **`MODIFIES` / `TRIGGERED_BY`:** both endpoints must exist; **`from` must not be** a business-rule node or **`RBP_ROLE`**; **`to` must be a `BUSINESS_RULE`** (including secondary type).
- **`ASSOCIATION`:** neither endpoint may be a business-rule node (MDF associations are object-to-object).
- **`EXPOSES`:** source must be OData by primary or **`secondaryTypes`** (`ODATA_ENTITY`), target must be MDF by primary or **`secondaryTypes`** (`MDF_OBJECT`), and self-loops are invalid.
- **Other edge types:** dangling endpoints reported as **warnings** (count only), not errors—unless promoted later.

This file does not replace SAP documentation; it records **what we implement**.

## Appendix — Schema detection (ingest profiles)

Ingest **does not** change the graph contract: detection only chooses how uploads are resolved into `EngineOptions` / `PipelineOptions`. Probes are implemented in **`src/ingest/detect.ts`**; the server walks the **full** project workspace (including nested **`uploads/`** and **`extracted/`**) so evidence is not missed when object definitions live in a subfolder.

| Signal | Detected pattern / use |
|--------|-------------------------|
| `Object Definition.csv` at root of object-defs dir | Strong signal for **first-example** layout (may combine with other probes). |
| XML root `<succession-data-model>` | **client-2** succession DM (first-example bundle does not ship this). |
| RBP JSON top-level keys **`roleId`** + **`status`** + **`userType`** | RbpJson **v2** (client-2 style hierarchical export). |
| RBP JSON top-level keys **`role`** + **`perms`** + **`assigns`** | RbpJson **v1** (first-project style). |
| Sibling CSVs **`Workflow.csv`** + **`Dynamic Role.csv`** + **`WorkflowCCRole.csv`** | Workflow **split** bundle (merged server-side into WFInfo-shaped CSV). |
| Single CSV **`WFInfo.csv`** | Workflow **combined** (first-project style). |
| CSV **`RolesPermissions.csv`** with header starting `Role Name,Granted population,Target population` | **client-2** primary RBP roles file. |
| CSV **`businessrulesassignments.csv`** with column **`Rule ID`** | **client-2** rules-assignment source. |
| CSV matching **`jobResponse*.csv`** | First-project rules-assignment source. |

Probe outputs are **per-source** decisions; future tenants may mix formats. For UI/API flow and `ClientProfile` knobs, see root **`README.md`** → “Onboarding a new tenant”.
