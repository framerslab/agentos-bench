/**
 * @file BenchmarkRunner.ts
 * @description Orchestrator that drives one {@link IBenchmark} to completion.
 *
 * The runner owns the case loop, concurrency, caching of
 * {@link CaseRun} / {@link CaseResult}, and populates aggregate cost
 * metrics from the shared {@link CostTracker}. It is intentionally the
 * only place that mutates run-wide state — benchmarks are pure.
 *
 * @module agentos-bench/core/BenchmarkRunner
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  BenchCase,
  BenchContext,
  BenchResult,
  CaseResult,
  CaseRun,
  IBenchmark,
  RunConfig,
} from './IBenchmark.js';
import { Cache, hashKey } from './Cache.js';
import { CostTracker } from './CostTracker.js';
import { ResultStore } from './ResultStore.js';
import type { IJudge } from '../judges/IJudge.js';

/**
 * Options for constructing a {@link BenchmarkRunner}.
 */
export interface BenchmarkRunnerOptions {
  /** Absolute path to the dataset cache directory (persists across runs). */
  dataDir: string;
  /** Absolute path to the results directory. */
  resultsDir: string;
  /** Judge implementation for external benchmarks. Micro-benchmarks ignore. */
  judge: IJudge;
  /** Optional override for the scratch directory root. Defaults to OS tmp. */
  scratchRoot?: string;
}

/**
 * Resolves sensible defaults for a {@link RunConfig}.
 */
export function resolveRunConfig(cfg: RunConfig): BenchContext['config'] {
  return {
    reader: cfg.reader,
    memoryMode: cfg.memoryMode,
    replayMode: cfg.replayMode,
    concurrency: cfg.concurrency ?? 3,
    sampleN: cfg.sampleN,
    tags: cfg.tags,
    seed: cfg.seed,
    maxUsd: cfg.maxUsd,
    retrievalProfile: cfg.retrievalProfile,
    adaptiveRetrieval: cfg.adaptiveRetrieval,
    retrievalK: cfg.retrievalK,
    stratified: cfg.stratified,
    samplePerType: cfg.samplePerType,
    trackFootprint: cfg.trackFootprint,
  };
}

/**
 * Drives one benchmark run end-to-end.
 *
 * @example
 * const runner = new BenchmarkRunner({
 *   dataDir: '/path/to/data',
 *   resultsDir: '/path/to/results',
 *   judge: new LongMemEvalJudge({ model: 'gpt-4o' }),
 * });
 * const result = await runner.run(new LongMemEvalS(), {
 *   reader: 'claude-sonnet-4-6',
 *   memoryMode: 'full-cognitive',
 *   replayMode: 'observe',
 *   sampleN: 20,
 * });
 */
export class BenchmarkRunner {
  constructor(private readonly opts: BenchmarkRunnerOptions) {}

  /** Run the benchmark end-to-end and persist the result. */
  async run(benchmark: IBenchmark, config: RunConfig): Promise<BenchResult> {
    const startedAt = new Date().toISOString();

    const scratchDir = await this.makeScratchDir(benchmark.id, startedAt);
    const cache = new Cache(path.join(this.opts.dataDir, 'cache'));
    const costTracker = new CostTracker();

    const ctx: BenchContext = {
      config: resolveRunConfig(config),
      judge: this.opts.judge,
      cache,
      costTracker,
      dataDir: this.opts.dataDir,
      scratchDir,
    };

    try {
      await benchmark.setup(ctx);

      const allCases = await benchmark.loadTestCases(ctx);
      const cases = typeof config.sampleN === 'number' ? allCases.slice(0, config.sampleN) : allCases;

      const results = await this.runCases(benchmark, cases, ctx);

      const aggregate = benchmark.aggregate(results, ctx);
      // Overwrite runner-owned fields with authoritative values so
      // aggregation implementations can't silently drift.
      const finalResult: BenchResult = {
        ...aggregate,
        benchmarkId: benchmark.id,
        benchmarkVersion: benchmark.version,
        config,
        startedAt,
        completedAt: new Date().toISOString(),
        totalCases: results.length,
        cases: results,
        totalUsd: costTracker.totals.totalUsd,
        totalReaderTokens:
          costTracker.byCategory.reader.totalTokensIn + costTracker.byCategory.reader.totalTokensOut,
        costPerCorrect:
          aggregate.passedCases > 0
            ? costTracker.totals.totalUsd / aggregate.passedCases
            : Number.POSITIVE_INFINITY,
      };

      const store = new ResultStore(this.opts.resultsDir);
      await store.save(finalResult, benchmark.family);

      return finalResult;
    } finally {
      await fs.rm(scratchDir, { recursive: true, force: true });
    }
  }

  /**
   * Run `cases` with bounded concurrency, using the case-run + case-result
   * caches to skip work that's already been done.
   */
  private async runCases(
    benchmark: IBenchmark,
    cases: BenchCase[],
    ctx: BenchContext,
  ): Promise<CaseResult[]> {
    const results: CaseResult[] = new Array(cases.length);
    const limit = ctx.config.concurrency;
    let cursor = 0;

    const worker = async (workerId: number): Promise<void> => {
      void workerId;
      while (true) {
        const i = cursor++;
        if (i >= cases.length) return;
        results[i] = await this.runOneCase(benchmark, cases[i], ctx);
      }
    };

    await Promise.all(Array.from({ length: Math.max(1, limit) }, (_, i) => worker(i)));
    return results;
  }

  private async runOneCase(
    benchmark: IBenchmark,
    c: BenchCase,
    ctx: BenchContext,
  ): Promise<CaseResult> {
    const runKeyParts = [
      'case-run',
      benchmark.id,
      benchmark.version,
      c.id,
      ctx.config.reader,
      ctx.config.memoryMode,
      ctx.config.replayMode,
    ];
    const resultKeyParts = [
      'case-result',
      benchmark.id,
      benchmark.version,
      c.id,
      ctx.config.reader,
      ctx.config.memoryMode,
      ctx.config.replayMode,
      ctx.judge.model,
      ctx.judge.rubricVersion,
    ];

    // Step 1 — produce or recall the answer.
    let run = await ctx.cache.get<CaseRun>('case-run', ...runKeyParts);
    if (!run) {
      try {
        run = await benchmark.runCase(c, ctx);
      } catch (err: unknown) {
        run = {
          caseId: c.id,
          actualOutput: '',
          latencyMs: 0,
          tokensIn: 0,
          tokensOut: 0,
          usd: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      await ctx.cache.set('case-run', run, ...runKeyParts);
    }

    // Step 2 — score it.
    let result = await ctx.cache.get<CaseResult>('case-result', ...resultKeyParts);
    if (!result) {
      if (run.error) {
        result = { ...run, score: 0, passed: false };
      } else {
        try {
          result = await benchmark.scoreCase(c, run, ctx);
        } catch (err: unknown) {
          result = {
            ...run,
            score: 0,
            passed: false,
            scoreMetadata: {
              scoringError: err instanceof Error ? err.message : String(err),
            },
          };
        }
      }
      await ctx.cache.set('case-result', result, ...resultKeyParts);
    }

    return result;
  }

  private async makeScratchDir(benchId: string, stamp: string): Promise<string> {
    const base = this.opts.scratchRoot ?? os.tmpdir();
    const dir = path.join(base, 'agentos-bench', `${benchId}-${hashKey(stamp).slice(0, 8)}`);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }
}
