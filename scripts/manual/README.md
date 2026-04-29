# Manual Scripts

Small command-line helpers for local diagnostics, benchmarking, and one-off data inspection. They compile into `dist-runtime/scripts/manual/`; run them through the npm scripts from the repository root unless you need custom arguments.

| Script | npm command | Purpose |
|--------|-------------|---------|
| `benchmark.ts` | `npm run benchmark -- 1` | Runs the full pipeline one or more times and prints timing/memory summaries. |
| `graph-diff.ts` | `npm run graph-diff -- <a.json> <b.json>` | Compares two dashboard exports and writes a Markdown diff to stdout. |
These scripts are intentionally manual helpers. Keep new helpers read-only by default, and document any filesystem writes in the file header.
