import { ModuleClassifier } from './core/ModuleClassifier.js';
import { validateGraphIntegrity } from './conformance/GraphValidator.js';
import { DataModelEngine } from './engines/DataModelEngine.js';
import { MdfEngine } from './engines/MdfEngine.js';
import { ODataEngine } from './engines/ODataEngine.js';
import { RbpEngine } from './engines/RbpEngine.js';
import { RbpJsonEngine } from './engines/RbpJsonEngine.js';
import { RuleEngine } from './engines/RuleEngine.js';
import { RulesAssignmentEngine } from './engines/RulesAssignmentEngine.js';
import { WorkflowEngine } from './engines/WorkflowEngine.js';
import { IngestLogBuilder } from './ingest/IngestLog.js';

import type { SFGraph } from './core/GraphSchema.js';
import type { PipelineOptions, PipelineResult, PipelineTiming } from './types.js';

const MAX_INTEGRITY_SAMPLES = 20;

/**
 * Run the full SuccessFactors ingestion pipeline.
 *
 * Threads a single `IngestLogBuilder` through every engine via
 * `EngineOptions.ingestLog`, then freezes the resulting log into
 * `graph.meta.diagnostics.ingestLog` so downstream callers (server.ts
 * persists it; UI Export-Log buttons fetch it) can surface diagnostics.
 *
 * Callers may pass their own builder via `options.ingestLog` (the server
 * does this so it can record routing-layer issues that fire before any
 * engine constructor runs); otherwise a fresh builder is created here.
 */
export async function runPipeline(graph: SFGraph, options: PipelineOptions = {}): Promise<PipelineResult> {
  const {
    onProgress = () => {},
    onTiming = () => {},
    enableTiming = false,
    ingestLog: providedLog,
    ...rest
  } = options;

  const ingestLog = providedLog ?? new IngestLogBuilder();
  if (options.clientSlug) ingestLog.setProfileSlug(options.clientSlug);

  const engineOptions = { ...rest, ingestLog, clientSlug: options.clientSlug };

  const timings: PipelineTiming[] = [];
  async function measure(step: string, message: string, action: () => Promise<void>): Promise<void> {
    onProgress(step, message);
    const start = process.hrtime.bigint();
    const result = await action();
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const timing: PipelineTiming = { step, message, durationMs: Math.round(durationMs * 100) / 100 };
    timings.push(timing);
    if (enableTiming) onTiming(timing);
    return result;
  }

  await measure('mdf', 'Processing MDF Object Definitions\u2026', () => new MdfEngine(graph, engineOptions).run());
  await measure('datamodel', 'Processing Data Models\u2026', () => new DataModelEngine(graph, engineOptions).run());
  await measure('rules', 'Processing Business Rules\u2026', () => new RuleEngine(graph, engineOptions).run());
  await measure('rbp', 'Processing RBP Roles\u2026', () => new RbpEngine(graph, engineOptions).run());
  await measure('rbp_json', 'Enriching RBP semantics from role JSONs\u2026', () => new RbpJsonEngine(graph, engineOptions).run());
  await measure('odata', 'Processing OData Metadata\u2026', () => new ODataEngine(graph, engineOptions).run());
  await measure('workflow', 'Processing Workflow Configuration\u2026', () => new WorkflowEngine(graph, engineOptions).run());
  await measure('assignment', 'Cross-referencing Business Rules assignment info\u2026', () => new RulesAssignmentEngine(graph, engineOptions).run());
  await measure('module-classifier', 'Classifying modules\u2026', () => Promise.resolve(new ModuleClassifier(graph).run()));

  const integrity = validateGraphIntegrity(graph);
  if (integrity.errors.length > 0) {
    ingestLog.add({
      section: 'objectDefs',
      severity: 'error',
      code: 'pipeline.integrity.errors',
      message: `Graph integrity validation found ${integrity.errors.length} error(s).`,
      data: {
        totalCount: integrity.errors.length,
        samples: integrity.errors.slice(0, MAX_INTEGRITY_SAMPLES)
      }
    });
  }
  if (integrity.warnings.length > 0) {
    ingestLog.add({
      section: 'objectDefs',
      severity: 'warn',
      code: 'pipeline.integrity.warnings',
      message: `Graph integrity validation found ${integrity.warnings.length} warning(s).`,
      data: {
        totalCount: integrity.warnings.length,
        samples: integrity.warnings.slice(0, MAX_INTEGRITY_SAMPLES)
      }
    });
  }

  graph.setIngestLog(ingestLog.build());

  return {
    graph,
    timings,
    nodeCount: graph.nodes.size,
    edgeCount: graph.edges.length
  };
}
