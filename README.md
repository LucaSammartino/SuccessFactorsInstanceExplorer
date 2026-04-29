# SuccessFactors Instance Explorer

An offline metadata explorer for SAP SuccessFactors. Drop your tenant's exports
(MDF object definitions, RBP roles + permissions, OData metadata, data models,
workflows, business rules) into a local web app and explore the relationships
as a graph: suite architecture map, permission matrix, drilldown views,
blast-radius analysis, two-instance compare.

> **Your data never leaves your machine.** The web server binds to `127.0.0.1`
> only and makes zero outbound network calls. There is no telemetry, no auto-update,
> no cloud component. Uploaded files are processed locally and persisted only in
> the gitignored `projects/` folder under this repository.

## Disclaimer

**Not affiliated with SAP.** "SAP" and "SuccessFactors" are trademarks of SAP SE,
used here only to describe the data formats this tool ingests (nominative fair
use). This project is independent and is not endorsed, sponsored, or supported
by SAP.

**Use at your own risk.** Provided under the MIT License, with **no warranty**.
Before uploading metadata exported from any SuccessFactors tenant, confirm you
are authorized by the data owner (your employer, your customer, or the tenant
admin) to do so. Even though all processing is local, you remain responsible
for compliance with your organization's data-handling policies, NDAs, and any
applicable privacy law (GDPR, CCPA, etc.).

**No PII required.** This tool processes *configuration metadata* — object
definitions, role permissions, workflows, business rules. It does **not** need
employee records, payroll data, or other PII. Do not upload employee data
files; they aren't required and aren't supported.

## Quickstart

Requires Node.js 20+ and npm.

```bash
git clone https://github.com/SafetyRegulationsDoNotApplyHere/SuccessFactorsInstanceExplorer.git
cd SuccessFactorsInstanceExplorer
npm install
npm --prefix ui install
npm run server
```

Then open `http://127.0.0.1:5174` in your browser.

1. Click **New project**.
2. Drag your SuccessFactors exports into the seven dropzones (Object
   Definitions zip, RBP files, OData XML, Corporate + Country data models,
   Succession data model, Workflow CSVs, Business Rules export, Business Rules
   Assignments).
3. Click **Ingest** and wait for the pipeline to finish.
4. Explore the views from the top nav.

To wipe a project's data, delete its UUID folder under `projects/`.

## Try the sample data

Want to see the app without using client data? Import the fake bundle in
[`examples/showcase-data/`](examples/showcase-data/). It includes one small
Object Definitions zip plus matching RBP, OData, data model, workflow, and
business-rule files for a screenshot-friendly demo project.

## What gets ingested

The Import workspace exposes seven dropzones that map to the standard
SuccessFactors exports:

| Section                  | What to drop                                                              |
|--------------------------|----------------------------------------------------------------------------|
| Object Definitions       | Zip from Admin Center → Import & Export Data → Export Data → Object Definition |
| Roles and Permissions    | Any combination of `.csv` and per-role `.json` from RBP exports            |
| OData                    | EDMX metadata XML (`$metadata`)                                            |
| Data Model (CDM + CSF)   | Corporate + Country-Specific data model XMLs (server content-sniffs each) |
| Succession Data Model    | Succession DM XML                                                          |
| Workflow                 | `WFInfo.csv` or the three-file split (`Workflow.csv`, `WorkflowContributor.csv`, `WorkflowCCRole.csv`) |
| Business Rules Export    | `Rule.csv` or a zip containing it                                          |
| Business Rules Assignments | `businessrulesassignments.csv`                                          |

Each section has an **Export log** button that downloads a Markdown
diagnostic report so you can see how each file was classified and any
warnings/errors that came up during ingest.

## Pipeline

Ingest runs nine engines in order, building a single shared graph:

`MdfEngine` → `DataModelEngine` → `RuleEngine` → `RbpEngine` → `RbpJsonEngine`
→ `ODataEngine` → `WorkflowEngine` → `RulesAssignmentEngine` → `ModuleClassifier`

The graph contract — node types, edge types, meta payloads — is documented in
[`docs/GRAPH_CONTRACT.md`](docs/GRAPH_CONTRACT.md). Locked architectural
decisions live in [`docs/DECISIONS.md`](docs/DECISIONS.md). Privacy and
data-handling details: [`docs/PRIVACY.md`](docs/PRIVACY.md).

## Code map

```
src/
  engines/        ingestion engines (MDF, rules, RBP CSV/JSON, OData, data models, workflow, rules assignment)
  ingest/         profile detection, RBP router, workflow CSV merge, IngestLog
  clients/        per-tenant tuning packs (rule overrides, taxonomy hints)
  core/           GraphSchema, GraphDiff, ArchitecturalStats, DashboardExporter, ModuleClassifier
  pipeline.ts     sequential engine runner
  types.ts        shared TypeScript types

ui/lib/
  state.ts          central mutable state + callbacks
  graph-data.ts     scope builders (suite, blueprint, drilldown, lineage, rbp-flow)
  graph-render.ts   D3 renderer dispatch
  matrix/           permission matrix (virtualized tbody)
  inspector.ts      node detail panel
  views/            per-view scope builders
  interactions/     blast-radius, path-find
  overlays/         workflow-heat
  layout/           elk-runner, graph-viewport
  render/           minimap

server.ts        Express API (default port 5174) + static UI
main.ts          Maintainer-only CLI (runs the pipeline against a local sample)
```

## Common commands

```bash
npm run build:runtime          # compile TS → dist-runtime/
npm run server                 # build + start API + serve UI at http://127.0.0.1:5174
npm run benchmark -- 1         # build + single benchmark run
npm --prefix ui run dev        # UI dev server (proxies /api to :5174)
npm --prefix ui run build      # UI production build → ui/dist/
npm run typecheck              # TS type check, no emit
```

## Configuration

Optional environment variables (see [`.env.example`](.env.example)):

| Variable                         | Default       | Effect                                           |
|----------------------------------|---------------|---------------------------------------------------|
| `PORT`                           | `5174`        | API/static server port                            |
| `SUCCESSFACTORS_INSTANCE_EXPLORER_HOST`             | `127.0.0.1`   | Bind address. Only set to `0.0.0.0` on a network you trust — there is no auth. |
| `SUCCESSFACTORS_INSTANCE_EXPLORER_PROJECTS_DIR`     | `./projects`  | Where ingested project workspaces are written     |
| `SUCCESSFACTORS_INSTANCE_EXPLORER_SKIP_UI_BUILD`    | unset         | Skip the auto Vite build before starting          |

## Known limitations

- The CLI (`npm run main`) is maintainer-only — it expects a local sample
  bundle under `sample-data/`. The public flow is `npm run server` + the
  browser UI.
- The local server has no authentication. By default it binds to `127.0.0.1`
  so only your own machine can reach it. Don't set `SUCCESSFACTORS_INSTANCE_EXPLORER_HOST=0.0.0.0`
  on an untrusted network.
- SAP UI5 web components are bundled, not fetched from a CDN. The first build
  takes a moment.

## License

MIT — see [LICENSE](LICENSE). Third-party attribution lives in
[NOTICE](NOTICE).

## Security

Found a security issue? See [SECURITY.md](SECURITY.md).
