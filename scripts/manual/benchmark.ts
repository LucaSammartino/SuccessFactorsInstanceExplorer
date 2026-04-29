import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SFGraph } from '../../src/core/GraphSchema.js';
import { runPipeline } from '../../src/pipeline.js';
import { resolveRepoRootFromManualScriptDir } from '../../src/repoRoot.js';
import { defaultEngineOptionsForRepo } from '../../src/resolveDataRoots.js';
import type { EngineOptions, PipelineTiming } from '../../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = resolveRepoRootFromManualScriptDir(__dirname);

const DEFAULT_OPTIONS: EngineOptions = defaultEngineOptionsForRepo(ROOT);

function formatDuration(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

function formatMemory(mem: number): string {
  return `${Math.round((mem / 1024 / 1024) * 100) / 100} MB`;
}

async function assertPathsExist(options: EngineOptions): Promise<void> {
  const missing: string[] = [];
  for (const [key, value] of Object.entries(options)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!(await fs.pathExists(item))) missing.push(`${key}: ${item}`);
      }
    } else if (value != null && !(await fs.pathExists(value))) {
      missing.push(`${key}: ${value}`);
    }
  }
  if (missing.length) {
    throw new Error(`Missing required benchmark files:\n${missing.join('\n')}`);
  }
}

interface RunSummary {
  run: number;
  totalMs: number;
  nodeCount: number;
  edgeCount: number;
  heapUsed: number;
  rss: number;
  heapDelta: number;
  timings: PipelineTiming[];
}

async function runBenchmark(iterations: number): Promise<void> {
  await assertPathsExist(DEFAULT_OPTIONS);

  const allRuns: RunSummary[] = [];

  for (let index = 1; index <= iterations; index += 1) {
    console.log(`\n=== Benchmark run ${index} / ${iterations} ===`);
    const graph = new SFGraph();

    const memoryStart = process.memoryUsage();
    const start = process.hrtime.bigint();
    const result = await runPipeline(graph, {
      ...DEFAULT_OPTIONS,
      enableTiming: true,
      onProgress: (step, message) => console.log(`[${step}] ${message}`),
      onTiming: ({ step, message, durationMs }) => console.log(`  - ${step}: ${formatDuration(durationMs)}`)
    });
    const end = process.hrtime.bigint();
    const memoryEnd = process.memoryUsage();

    const totalMs = Number(end - start) / 1e6;
    const deltaHeap = memoryEnd.heapUsed - memoryStart.heapUsed;

    const runSummary: RunSummary = {
      run: index,
      totalMs,
      nodeCount: result.nodeCount,
      edgeCount: result.edgeCount,
      heapUsed: memoryEnd.heapUsed,
      rss: memoryEnd.rss,
      heapDelta: deltaHeap,
      timings: result.timings
    };

    console.log(`Total time: ${formatDuration(totalMs)}`);
    console.log(`Nodes: ${result.nodeCount}, Edges: ${result.edgeCount}`);
    console.log(`Heap used: ${formatMemory(memoryEnd.heapUsed)} (delta ${formatMemory(deltaHeap)})`);
    console.log(`RSS: ${formatMemory(memoryEnd.rss)}`);

    allRuns.push(runSummary);
  }

  const averageMs = allRuns.reduce((sum, run) => sum + run.totalMs, 0) / allRuns.length;
  const averageHeap = allRuns.reduce((sum, run) => sum + run.heapUsed, 0) / allRuns.length;
  const averageRss = allRuns.reduce((sum, run) => sum + run.rss, 0) / allRuns.length;

  console.log('\n=== Benchmark summary ===');
  console.log(`Runs: ${iterations}`);
  console.log(`Average total time: ${formatDuration(averageMs)}`);
  console.log(`Average heap used: ${formatMemory(averageHeap)}`);
  console.log(`Average RSS: ${formatMemory(averageRss)}`);
}

const iterations = Number(process.argv[2] || '1');
runBenchmark(iterations).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Benchmark failed:', message);
  process.exit(1);
});
