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
  ReaderModel,
  RunConfig,
} from './IBenchmark.js';
import { Cache, hashKey } from './Cache.js';
import { CostTracker } from './CostTracker.js';
import { ResultStore } from './ResultStore.js';
import type { IJudge } from '../judges/IJudge.js';
import type { IReader } from '../readers/IReader.js';
import { createReader } from '../readers/createReader.js';
import {
  computeBootstrapCI,
  type BootstrapResult,
} from './metrics/index.js';
import {
  computeJudgeAdversarialRate,
  type AdversarialProbeCase,
} from './metrics/computeJudgeAdversarial.js';

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
    ablateSignal: cfg.ablateSignal,
    ablateMechanism: cfg.ablateMechanism,
    // apiKey stays on the in-memory context so the adapter can use it
    // at retrieval time. Redaction happens in {@link redactSecretsFromConfig}
    // before the config is persisted as part of BenchResult.
    rerank: cfg.rerank,
    // Fingerprint-only: consumers (BenchmarkRunner cache key, sweep
    // reports) need to know WHICH model is generating summaries, not
    // the summarizer instance itself. The instance is plumbed through
    // entry.build() so it lives on the adapter, not ctx.config.
    contextSummaryModel: cfg.contextSummaryModel,
    // How many retrieved chunks the reader sees after rerank. When
    // undefined, the adapter's default (typically 10) applies. When
    // set, case-run cache keys include a `topk:${N}` fingerprint so
    // K=10 and K=15 runs cache independently. See
    // {@link computeCaseRunKeyParts} for the conditional-append logic
    // that preserves pre-change cache entries for K=10 default runs.
    readerTopK: cfg.readerTopK,
    // Step-1 infra: judge-adversarial probe + bootstrap CI knobs.
    // All default-off/undefined; runner treats them as opt-in.
    judgeAdversarial: cfg.judgeAdversarial,
    judgeAdversarialMaxProbes: cfg.judgeAdversarialMaxProbes,
    judgeAdversarialSynthModel: cfg.judgeAdversarialSynthModel,
    bootstrapResamples: cfg.bootstrapResamples,
    // Step-2: session-level hierarchical retrieval knobs.
    sessionRetrieval: cfg.sessionRetrieval,
    sessionRetrievalTopSessions: cfg.sessionRetrievalTopSessions,
    sessionRetrievalChunksPerSession: cfg.sessionRetrievalChunksPerSession,
    // Step-3: hybrid retrieval flag.
    hybridRetrieval: cfg.hybridRetrieval,
    // Step-4: HyDE flag.
    hyde: cfg.hyde,
    // Step-5: FactSupersession flag.
    factSupersession: cfg.factSupersession,
    // Step-6: split-on-ambiguous rerank refinement.
    splitAmbiguous: cfg.splitAmbiguous,
    // Step-7: Observer/Reflector pipeline flag (Tier 2).
    observerReflector: cfg.observerReflector,
    // Step-8: REPLACEMENT semantics for Observer/Reflector.
    observerReflectorReplace: cfg.observerReflectorReplace,
  };
}

/**
 * Produce a persistence-safe copy of a {@link RunConfig} with every
 * secret stripped. Call this before a config is written to disk or
 * serialized into a {@link BenchResult} — run JSONs land in
 * `results/runs/` and can be committed, so the original apiKey must
 * never leave memory.
 */
export function redactSecretsFromConfig(cfg: RunConfig): RunConfig {
  if (!cfg.rerank) return cfg;
  return {
    ...cfg,
    rerank: {
      provider: cfg.rerank.provider,
      model: cfg.rerank.model,
      candidateMultiplier: cfg.rerank.candidateMultiplier,
      // apiKey intentionally omitted — never persist secrets.
    },
  };
}

/**
 * Schema-version marker for cache invalidation. Bump when the base set
 * of parts composed into a case-run cache key changes. Parts are
 * joined via `\x1f` in {@link hashKey}, so adding OR removing a part
 * breaks all prior cache entries — always-append patterns for new
 * fingerprints MUST be conditional (see `readerTopK` below) so
 * backwards-compat stays intact.
 *
 * History:
 *   v2 — initial schema (pre-prompt-version tracking)
 *   v3 — v6 prompt experiment (reverted, regressed -10pp)
 *   v4 — v7 prompt experiment (reverted, regressed all 3 benchmarks)
 *   v5 — v8 prompt (explicit abstention wording, same rule)
 *   v6 — v9 prompt (personalization rule for advice questions)
 *   v7 — Fix A: session-diverse top-K (MAX_CHUNKS_PER_SESSION=3)
 *   v8 — Fix A reverted. Bumped to discard v7 cache entries that
 *        were written during the Fix A smoke — the revert restored
 *        the code but the cache kept the regressed answers. Also
 *        marks the readerTopK-helper extraction (no user-visible
 *        behavior change on the default path, but clean slate lets
 *        the K=10 baseline reflect post-revert code accurately).
 */
const CASE_RUN_SCHEMA_VERSION = 'v8';

/**
 * Fixed context needed for a case-run cache key beyond `RunConfig`:
 * benchmark identity, the case id, and the judge identity.
 */
export interface CaseKeyContext {
  benchmarkId: string;
  benchmarkVersion: string;
  caseId: string;
  judgeModel: string;
  judgeRubricVersion: string;
}

/**
 * Build the ordered `runKeyParts` + `resultKeyParts` arrays that
 * `BenchmarkRunner.runOneCase` feeds into {@link hashKey}. Extracted
 * as a standalone helper so `readerTopK.spec.ts` can verify
 * propagation and backwards-compatibility without spinning up a full
 * benchmark run.
 *
 * Invariants pinned by tests:
 *   - When `config.readerTopK` is undefined, arrays are exactly 12
 *     (run) and 14 (result) elements — matching the pre-readerTopK
 *     layout, so prior cache entries remain valid.
 *   - When `config.readerTopK` is set, a `topk:${N}` element is
 *     appended, producing distinct hashes for K=10 vs K=15.
 */
export function computeCaseRunKeyParts(
  config: BenchContext['config'],
  keyCtx: CaseKeyContext,
): { runKeyParts: unknown[]; resultKeyParts: unknown[] } {
  // When a neural reranker is active the retrieval ordering changes;
  // cache keys MUST reflect that so cognitive-only cached runs don't
  // accidentally pollute a reranked sweep.
  const rerankFingerprint = config.rerank
    ? `rerank:${config.rerank.provider}:${config.rerank.model ?? 'default'}:cm${config.rerank.candidateMultiplier ?? 3}`
    : '';
  // Session-level contextual retrieval (Anthropic Sep 2024 variant)
  // changes every embedded chunk at ingest — the cache key MUST
  // reflect that so a non-contextual run doesn't return answers
  // embedded with context, or vice versa. Fingerprint is just the
  // model id; the summary content hashes live in the summarizer's
  // own on-disk cache. When contextSummaryModel is undefined, the
  // fingerprint is empty so the cache is shared across
  // non-contextual runs.
  const contextSummaryFingerprint = config.contextSummaryModel
    ? `ctx:${config.contextSummaryModel}`
    : '';

  const runKeyParts: unknown[] = [
    'case-run',
    CASE_RUN_SCHEMA_VERSION,
    keyCtx.benchmarkId,
    keyCtx.benchmarkVersion,
    keyCtx.caseId,
    config.reader,
    config.memoryMode,
    config.replayMode,
    // Ablation flags change the retrieval behaviour, so they must
    // participate in the cache key.
    config.ablateSignal ?? '',
    config.ablateMechanism ?? '',
    rerankFingerprint,
    contextSummaryFingerprint,
  ];
  const resultKeyParts: unknown[] = [
    'case-result',
    CASE_RUN_SCHEMA_VERSION,
    keyCtx.benchmarkId,
    keyCtx.benchmarkVersion,
    keyCtx.caseId,
    config.reader,
    config.memoryMode,
    config.replayMode,
    config.ablateSignal ?? '',
    config.ablateMechanism ?? '',
    rerankFingerprint,
    contextSummaryFingerprint,
    keyCtx.judgeModel,
    keyCtx.judgeRubricVersion,
  ];

  // Conditional append (see spec §2): add the readerTopK fingerprint
  // ONLY when explicitly set. `hashKey` joins all parts with `\x1f`
  // separators — appending even an empty-string part would change
  // the canonical serialization and invalidate every prior cache
  // entry. Leaving the array at 12 / 14 elements when readerTopK is
  // undefined preserves pre-change hashes exactly.
  if (config.readerTopK) {
    const topKTag = `topk:${config.readerTopK}`;
    runKeyParts.push(topKTag);
    resultKeyParts.push(topKTag);
  }

  // Session-level retrieval fingerprint (Step 2): conditional append
  // so runs without the flag keep their baseline cache hashes intact.
  // Pattern matches readerTopK from Step 1.
  if (config.sessionRetrieval) {
    const k = config.sessionRetrievalTopSessions ?? 5;
    const m = config.sessionRetrievalChunksPerSession ?? 3;
    const srTag = `session-retrieval:k=${k},m=${m}`;
    runKeyParts.push(srTag);
    resultKeyParts.push(srTag);
  }

  // Hybrid retrieval fingerprint (Step 3): conditional append so
  // non-hybrid runs keep their cache hashes intact.
  if (config.hybridRetrieval) {
    runKeyParts.push('hybrid-retrieval:rrf');
    resultKeyParts.push('hybrid-retrieval:rrf');
  }

  // HyDE fingerprint (Step 4): conditional append so runs without
  // the flag keep their cache hashes intact.
  if (config.hyde) {
    runKeyParts.push('hyde:enabled');
    resultKeyParts.push('hyde:enabled');
  }

  // FactSupersession fingerprint (Step 5): conditional append so
  // non-FS runs keep their cache hashes intact.
  if (config.factSupersession) {
    runKeyParts.push('fact-supersession:llm');
    resultKeyParts.push('fact-supersession:llm');
  }

  // Split-on-ambiguous fingerprint (Step 6): conditional append so
  // runs without the flag keep their cache hashes intact. Threshold
  // is part of the tag so different thresholds cache independently.
  if (config.splitAmbiguous && config.splitAmbiguous > 0) {
    const tag = `split-ambiguous:${config.splitAmbiguous}`;
    runKeyParts.push(tag);
    resultKeyParts.push(tag);
  }

  // Observer/Reflector fingerprint (Step 7 / Step 8): conditional append
  // distinguishes additive overlay (`on`) from replacement. The `-v2`
  // bump on replace invalidates prior Step 8 first-wave cache entries
  // that pre-date the `flushReflection` scopeOverride fix (reflections
  // landed in wrong collections before the fix, producing empty retrieval).
  if (config.observerReflector) {
    const tag = config.observerReflectorReplace
      ? 'observer-reflector:replace-v2'
      : 'observer-reflector:on';
    runKeyParts.push(tag);
    resultKeyParts.push(tag);
  }

  return { runKeyParts, resultKeyParts };
}

// ---------------------------------------------------------------------------
// Post-aggregate enrichment: bootstrap CIs + judge-adversarial probe
// ---------------------------------------------------------------------------

/**
 * Options for {@link attachBootstrapCIs}.
 */
export interface AttachBootstrapCIsOptions {
  /** Bootstrap resamples. Default 10,000. */
  resamples?: number;
  /** Seed for deterministic CIs. When omitted, uses Math.random. */
  seed?: number;
}

/**
 * Layer bootstrap 95 percent CIs onto a {@link BenchResult}. Returns a
 * new result with `accuracyCI`, `weightedAccuracyCI` (when
 * `stratifiedAccuracy` is present), and `byTypeCI` populated.
 *
 * Pure CPU — no API calls. Safe to run inside
 * {@link BenchmarkRunner.run} after `benchmark.aggregate()`.
 *
 * @example
 * ```ts
 * const withCIs = attachBootstrapCIs(aggregate, { seed: 7 });
 * console.log(withCIs.accuracyCI); // { value: 0.85, ciLo: 0.77, ciHi: 0.92, ... }
 * ```
 */
export function attachBootstrapCIs(
  result: BenchResult,
  options: AttachBootstrapCIsOptions = {},
): BenchResult {
  const resamples = options.resamples ?? 10_000;
  const seed = options.seed;

  // Indicator vector: 1 for passed, 0 for failed. Bootstrap over this
  // matches the "sample with replacement from the cases" semantics.
  const indicators = result.cases.map((c) => (c.passed ? 1 : 0));
  if (indicators.length === 0) return result;

  const mean = (s: number[]): number =>
    s.reduce((a, b) => a + b, 0) / s.length;

  const accuracyCI = computeBootstrapCI(indicators, mean, { resamples, seed });

  // Per-type CI: partition indicator by caseType metadata.
  const byTypeIndicators = new Map<string, number[]>();
  for (const c of result.cases) {
    const type =
      ((c.metadata as Record<string, unknown> | undefined)?.caseType as
        | string
        | undefined) ?? 'unknown';
    const arr = byTypeIndicators.get(type) ?? [];
    arr.push(c.passed ? 1 : 0);
    byTypeIndicators.set(type, arr);
  }
  const byTypeCI: Record<string, BootstrapResult> = {};
  for (const [type, arr] of byTypeIndicators) {
    if (arr.length > 0) {
      byTypeCI[type] = computeBootstrapCI(arr, mean, { resamples, seed });
    }
  }

  // Weighted-accuracy CI: resample cases, recompute weighted accuracy
  // each resample using the SAME priors as the original stratified
  // aggregate. Only when stratifiedAccuracy was computed.
  let weightedAccuracyCI: BootstrapResult | undefined;
  if (result.stratifiedAccuracy) {
    const priors = result.stratifiedAccuracy.byType;
    // Build index of case -> type so resamples can reconstruct per-type
    // passed/n counts quickly.
    const typedCases: Array<{ passed: number; type: string }> = result.cases.map(
      (c) => ({
        passed: c.passed ? 1 : 0,
        type:
          ((c.metadata as Record<string, unknown> | undefined)?.caseType as
            | string
            | undefined) ?? 'unknown',
      }),
    );
    const weightedStatistic = (
      sample: Array<{ passed: number; type: string }>,
    ): number => {
      const counts = new Map<string, { n: number; passed: number }>();
      for (const s of sample) {
        const g = counts.get(s.type) ?? { n: 0, passed: 0 };
        g.n += 1;
        g.passed += s.passed;
        counts.set(s.type, g);
      }
      let weighted = 0;
      for (const [type, g] of counts) {
        if (g.n === 0) continue;
        const prior = priors[type]?.prior ?? 0;
        weighted += prior * (g.passed / g.n);
      }
      return weighted;
    };
    weightedAccuracyCI = computeBootstrapCI(typedCases, weightedStatistic, {
      resamples,
      seed,
    });
  }

  return {
    ...result,
    accuracyCI,
    byTypeCI,
    weightedAccuracyCI,
  };
}

/**
 * Parameters for {@link runAdversarialProbeIfEnabled}.
 */
export interface RunAdversarialProbeParams {
  /** The BenchResult produced by the runner so far. */
  result: BenchResult;
  /** The full case list (question, expected, type) — reader outputs unused here. */
  cases: BenchCase[];
  /** Benchmark id (for rubric selection by the judge). */
  benchmarkId: string;
  /** Same judge instance the runner used on real answers. */
  judge: IJudge;
  /** Synthesizer invoker (cheap LLM producing distractors). */
  synthesizer: IReader;
  /** Disk cache dir for synthesized distractors. */
  cacheDir: string;
  /** Run the probe; when false, returns `result` unchanged. */
  enabled: boolean;
  /** Probe count cap. Default 50. */
  maxProbes?: number;
  /** Bootstrap resamples for the FPR CI. Default 10,000. */
  resamples?: number;
  /** Seed for deterministic bootstrap. */
  seed?: number;
}

/**
 * Conditionally run the judge-adversarial probe and merge its result
 * into the supplied {@link BenchResult}. When `params.enabled` is
 * false, returns the input unchanged (no synth, no judge, zero cost).
 *
 * The synthesizer is typically constructed via `createReader` with
 * `RunConfig.judgeAdversarialSynthModel`. Each distractor is
 * cached under `cacheDir` so re-runs with warm cache pay only the
 * judge calls.
 */
export async function runAdversarialProbeIfEnabled(
  params: RunAdversarialProbeParams,
): Promise<BenchResult> {
  if (!params.enabled) return params.result;
  const probe = await computeJudgeAdversarialRate({
    cases: params.cases.map(
      (c): AdversarialProbeCase => ({
        id: c.id,
        type: c.type,
        question: c.question,
        expected: c.expected,
      }),
    ),
    benchmarkId: params.benchmarkId,
    judge: params.judge,
    synthesizer: params.synthesizer,
    cacheDir: params.cacheDir,
    maxProbes: params.maxProbes ?? 50,
    resamples: params.resamples ?? 10_000,
    seed: params.seed,
  });
  return { ...params.result, judgeAdversarialFPR: probe };
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
        config: redactSecretsFromConfig(config),
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

      // Evidence-origin aggregate: bucket per-case evidenceUsed.sourceType
      // across cases that ran the provenance pass. `undefined` on a case
      // means the pass did not run (legacy or non-participating benchmark);
      // `null` means the pass ran but no retrieved trace matched. Attach
      // only when at least one case participated so legacy runs stay
      // clean.
      let evidenceOriginSamples = 0;
      const evidenceOrigin: Record<string, number> = {};
      for (const c of results) {
        if (c.evidenceUsed === undefined) continue;
        evidenceOriginSamples++;
        const key = c.evidenceUsed?.sourceType ?? 'none';
        evidenceOrigin[key] = (evidenceOrigin[key] ?? 0) + 1;
      }
      if (evidenceOriginSamples > 0) {
        finalResult.evidenceOrigin = evidenceOrigin;
      }

      // Layer bootstrap CIs over per-case results (pure CPU, no API
      // calls). Seed flows from RunConfig for reproducibility; undefined
      // seed falls back to Math.random.
      const withCIs = attachBootstrapCIs(finalResult, {
        resamples: ctx.config.bootstrapResamples ?? 10_000,
        seed: ctx.config.seed,
      });

      // Optionally run the judge-adversarial probe. Opt-in because it
      // adds one cheap synth call + one judge call per probed case.
      // Synthesizer constructed only when flag is set so runs that
      // don't need the probe do not require OPENAI_API_KEY for a
      // non-GPT reader.
      const synthModel =
        ctx.config.judgeAdversarialSynthModel ?? 'gpt-5-mini';
      const synthesizer = ctx.config.judgeAdversarial
        ? createReader(synthModel as ReaderModel)
        : undefined;
      const withProbe =
        ctx.config.judgeAdversarial && synthesizer
          ? await runAdversarialProbeIfEnabled({
              result: withCIs,
              cases: allCases,
              benchmarkId: benchmark.id,
              judge: this.opts.judge,
              synthesizer,
              cacheDir: path.join(
                this.opts.dataDir,
                '.judge-adversarial-cache',
              ),
              enabled: true,
              maxProbes: ctx.config.judgeAdversarialMaxProbes ?? 50,
              resamples: ctx.config.bootstrapResamples ?? 10_000,
              seed: ctx.config.seed,
            })
          : withCIs;

      const store = new ResultStore(this.opts.resultsDir);
      await store.save(withProbe, benchmark.family);

      return withProbe;
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
    // Delegate cache-key construction to the shared helper so test
    // coverage (tests/readerTopK.spec.ts) can exercise the key-build
    // path directly, and so conditional-append for readerTopK stays
    // in one place rather than duplicated here and in tests.
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      ctx.config,
      {
        benchmarkId: benchmark.id,
        benchmarkVersion: benchmark.version,
        caseId: c.id,
        judgeModel: ctx.judge.model,
        judgeRubricVersion: ctx.judge.rubricVersion,
      },
    );

    // Step 1 — produce or recall the answer.
    let run = await ctx.cache.get<CaseRun>('case-run', ...runKeyParts);
    // Don't honour cached error responses — the error may be transient
    // (rate limit, network blip) or may be fixed in a later code change
    // (e.g. embedder chunk-splitting). Force a rerun for cached errors.
    if (run?.error) run = undefined;
    if (!run) {
      let errored = false;
      try {
        run = await benchmark.runCase(c, ctx);
      } catch (err: unknown) {
        errored = true;
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
      // Only cache successful runs — errored ones retry next time so
      // future code fixes actually get exercised.
      if (!errored) {
        await ctx.cache.set('case-run', run, ...runKeyParts);
      }
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
