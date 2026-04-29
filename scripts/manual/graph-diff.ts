/**
 * CLI: compare two dashboard JSON files (same shape as project `data.json`).
 * Usage: node dist-runtime/scripts/manual/graph-diff.js <pathA.json> <pathB.json>
 */
import fs from 'fs-extra';
import path from 'node:path';

import { diffDashboardExports, formatDiffMarkdown } from '../../src/core/GraphDiff.js';

async function main() {
  const [, , aPath, bPath] = process.argv;
  if (!aPath || !bPath) {
    console.error('Usage: graph-diff <dashboard-a.json> <dashboard-b.json>');
    process.exit(1);
  }
  const absA = path.resolve(aPath);
  const absB = path.resolve(bPath);
  if (!(await fs.pathExists(absA)) || !(await fs.pathExists(absB))) {
    console.error('One or both files do not exist.');
    process.exit(1);
  }
  const dashboardA = await fs.readJson(absA);
  const dashboardB = await fs.readJson(absB);
  const result = diffDashboardExports(dashboardA, dashboardB);
  const md = formatDiffMarkdown(result, {
    title: 'Graph diff',
    fromLabel: absA,
    toLabel: absB
  });
  process.stdout.write(md);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
