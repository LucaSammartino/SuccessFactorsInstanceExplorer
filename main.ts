import fs from 'fs-extra';
import path from 'node:path';
import { SFGraph } from './src/core/GraphSchema.js';
import { ArchitecturalStats } from './src/core/ArchitecturalStats.js';
import { buildDashboardExport } from './src/core/DashboardExporter.js';
import { runPipeline } from './src/pipeline.js';
import { resolveRepoRootFromEntrypoint } from './src/repoRoot.js';
import { defaultEngineOptionsForRepo } from './src/resolveDataRoots.js';

const REPO_ROOT = resolveRepoRootFromEntrypoint(import.meta.url);

async function main(): Promise<void> {
  console.log('--- SuccessFactors Instance Explorer ---');
  console.log('Initializing Graph Mesh...');

  const opts = defaultEngineOptionsForRepo(REPO_ROOT);
  if (!opts.objectDefsDir || !fs.existsSync(opts.objectDefsDir)) {
    console.error(
      `\n[main] No sample bundle found at ${opts.objectDefsDir}\n` +
      `       The CLI runs the pipeline against a local sample bundle and is intended for\n` +
      `       maintainer benchmarking. To explore your own SuccessFactors export, run:\n\n` +
      `         npm run server\n\n` +
      `       and upload your files through the browser UI.\n`
    );
    process.exit(1);
  }

  const graph = new SFGraph();

  await runPipeline(graph, opts);

  const stats = new ArchitecturalStats(graph).calculate();

  console.log('\n--- SUCCESSFACTORS ARCHITECTURE REPORT ---');
  console.log(`MDF Objects: ${stats.instanceOverview.mdfObjects}`);
  console.log(`Business Rules: ${stats.instanceOverview.businessRules}`);
  console.log(`RBP Roles: ${stats.instanceOverview.rbpRoles}`);
  console.log(`OData Entities: ${stats.instanceOverview.odataEntities}`);
  console.log(`Total Relationships: ${stats.instanceOverview.totalRelationships}`);

  console.log('\n--- DEPENDENCY HUBS ---');
  console.log(`Associations: ${stats.associationAnalysis.totalAssociations}`);
  console.log(`Orphan Objects: ${stats.associationAnalysis.orphanCount}`);

  console.log('\n--- API EXPOSURE ---');
  console.log(
    `OData Coverage: ${stats.apiExposure.exposedCount} / ${stats.apiExposure.totalMdfObjects} (${stats.apiExposure.coveragePct}%)`
  );

  console.log('\n--- MODULE CLASSIFICATION ---');
  console.log(`Classified Nodes: ${stats.moduleBreakdown.classifiedNodeCount}`);
  console.log(`Unclassified Nodes: ${stats.moduleBreakdown.unclassifiedNodeCount}`);

  console.log('\n--- OBJECT TAXONOMY ---');
  console.log(`Foundation Objects: ${stats.objectTaxonomy.byClass.FOUNDATION || 0}`);
  console.log(`Generic Objects: ${stats.objectTaxonomy.byClass.GENERIC || 0}`);
  console.log(`MDF Objects: ${stats.objectTaxonomy.byClass.MDF || 0}`);

  console.log('\n--- RULE DIAGNOSTICS ---');
  console.log(`Unresolved Base Object Aliases: ${graph.meta.diagnostics.unresolvedRuleBaseObjects.length}`);

  const wfSummary = graph.meta.workflow as { summary?: { present?: boolean; recordCount?: number; workflowCount?: number; duplicateHeaders?: unknown[] }; stats?: { averageStepCount?: number } } | null;
  if (wfSummary?.summary?.present) {
    console.log('\n--- WORKFLOW DISCOVERY ---');
    console.log(`Workflow Records: ${wfSummary.summary.recordCount}`);
    console.log(`Workflow Definitions: ${wfSummary.summary.workflowCount}`);
    console.log(`Duplicate Workflow Headers: ${wfSummary.summary.duplicateHeaders?.length}`);
    console.log(`Average Workflow Steps: ${wfSummary.stats?.averageStepCount || 0}`);
  }

  const output = buildDashboardExport(graph, stats);
  // `ui/data.json` is gitignored — regenerate via this CLI or via the server's ingest endpoint.
  await fs.writeJSON(path.join(REPO_ROOT, 'ui', 'data.json'), output, { spaces: 2 });
  console.log('\n[Export] ui/data.json written successfully.');
}

main().catch(error => {
  console.error('System Failure:', error);
});
