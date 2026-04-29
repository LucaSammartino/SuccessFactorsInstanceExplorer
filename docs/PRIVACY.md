# Privacy and data handling

SuccessFactors Instance Explorer is a local-only tool. This document spells out exactly what
that means in practice — what data the software touches, where it's stored,
and what it never does.

## What the software does **not** do

- **No outbound network calls.** The server makes no HTTP requests to any
  third-party host. The browser UI's `fetch()` calls only target the
  bundled local API at `/api/*`. There is no telemetry, error reporting,
  crash analytics, ping-home, or update check.
- **No external CDN dependencies at runtime.** SAP UI5 web components,
  D3, and all other JS/CSS are bundled into `ui/dist/` at build time.
  When you load the UI in your browser, every asset comes from your own
  local server.
- **No authentication backend, no user accounts.** The server is a
  single-tenant, single-user, single-machine tool by design. Bind it to a
  network interface only if you understand and accept the consequences.
- **No PII parsing.** The pipeline ingests *configuration metadata* —
  object definitions, role permissions, workflow definitions, business
  rules. It does not request or process employee records, payroll data,
  or other personal data files.

## Network exposure

By default the server binds to `127.0.0.1` only. This means:

- Only programs running on the same machine can connect. Other devices
  on your Wi-Fi, your office LAN, or the internet cannot reach it.
- The `localhost` / loopback interface is treated as private by every
  major OS firewall.

If you set `SUCCESSFACTORS_INSTANCE_EXPLORER_HOST=0.0.0.0` (or any non-loopback address),
the server becomes reachable from your local network. **There is no
authentication on any endpoint.** Anyone who can reach the host:port can
list projects, upload files, and trigger ingest. Only do this on a
network you trust, and consider running the server on a machine you
control rather than a shared one.

## Where uploaded data lives

When you ingest files through the UI, they are written to disk under:

```
<repo>/projects/<project-uuid>/
├── meta.json          – name, timestamps, optional client profile slug
├── data.json          – the dashboard export (graph + stats) the UI renders
├── ingest-log.json    – per-section diagnostics for the Export-log buttons
├── uploads/           – persisted copies of the files you uploaded
└── extracted/         – contents of any zip you uploaded, expanded
```

`projects/` is in `.gitignore`, so an accidental `git add .` will not
commit your data. To override the location, set
`SUCCESSFACTORS_INSTANCE_EXPLORER_PROJECTS_DIR` to an absolute path before running
`npm run server`.

Multipart uploads are first written to a temporary `.incoming/<uuid>/`
directory under the project, then moved into `uploads/` once the request
completes. The server sweeps `.incoming/` directories older than one
hour at startup to clean up after aborted uploads.

## How to delete your data

To wipe everything for a single project, close the browser tab and
delete its UUID folder under `projects/`:

```bash
rm -rf projects/<uuid>/
```

To wipe all projects, delete the whole folder:

```bash
rm -rf projects/
```

Nothing about your projects is persisted anywhere else on disk by
SuccessFactors Instance Explorer.

## Defenses against malformed input

A user could in principle upload a malicious file that targets the
parser rather than the workflow it represents. The server applies
defense-in-depth before parsing:

- **Filename sanitization.** Multipart filenames are reduced to a safe
  basename before any path is built from them.
- **Zip-slip guard.** Every entry in an uploaded zip is resolved
  against the extraction target; entries that escape are rejected
  before extraction starts.
- **Zip bomb cap.** Zips are rejected if their total uncompressed size
  exceeds 500 MB or any individual entry's compression ratio exceeds
  100×.
- **XXE protection.** The XML parsers (used for OData EDMX, Corporate
  and Country data models, Succession data model) are configured with
  `processEntities: false`, so malicious DOCTYPE / external-entity
  declarations cannot reach the file system or fan out via entity
  expansion.

These defenses are not a substitute for trust. Only ingest exports from
sources you know.

## What's stored elsewhere

Build artefacts (`dist-runtime/`, `ui/dist/`) are produced from this
source code by `tsc` and Vite respectively, both running locally. Both
directories are gitignored.

`node_modules/` contains the installed dependencies. They run on your
machine like any other npm package; their behaviour is governed by their
own licenses (see [NOTICE](../NOTICE)) and source code.
