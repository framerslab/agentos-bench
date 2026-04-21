/**
 * @file LongMemEvalS.ts
 * @description LongMemEval-S benchmark adapter.
 *
 * Drives AgentOS memory through the canonical 500-case LongMemEval-S
 * set (~115k-token haystacks). Each case:
 *
 *   1. Build a fresh memory instance for this run's memory mode.
 *   2. Replay `case.haystack` via {@link ConversationReplay} (observe
 *      for cognitive, ingest for base, no-op for none).
 *   3. Recall the top-K traces relevant to `case.question`.
 *   4. Invoke the reader with a system prompt composed of the
 *      retrieved context plus the question as the user message.
 *   5. Return the answer text.
 *
 * Scoring uses {@link LongMemEvalJudge} with GPT-4o. Per-type accuracy
 * breakdown is emitted in {@link BenchResult.byType}.
 *
 * This adapter pins against the public facade APIs (`Memory`,
 * `CognitiveMemoryManager`) so internal memory refactors don't break
 * the benchmark harness.
 *
 * @module agentos-bench/benchmarks/longmemeval/LongMemEvalS
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Memory } from '@framers/agentos';
import type { MemoryRetrievalPolicy } from '@framers/agentos';
import type { ScoredTrace } from '@framers/agentos';
import type { IEmbeddingManager } from '@framers/agentos/core/embeddings/IEmbeddingManager';
import type {
  BenchCase,
  BenchContext,
  BenchResult,
  CaseResult,
  CaseRun,
  IBenchmark,
} from '../../core/IBenchmark.js';
import {
  buildHaystackContext,
  replayViaIngest,
} from '../../core/ConversationReplay.js';
import { mean, percentile, stdDev } from '../../core/statsUtil.js';
import {
  computeRetrievalMetrics,
  computeLatencyBreakdown,
  computeStratifiedAccuracy,
  computeTokenEfficiency,
  LONGMEMEVAL_S_PRIORS,
  type MemoryFootprint,
} from '../../core/metrics/index.js';
import type { IReader } from '../../readers/IReader.js';
import type { SessionSummarizer } from '@framers/agentos/memory';
import { createCognitiveManager } from '../../cognitive/createCognitiveManager.js';
import { loadLongMemEvalDataset, type LongMemEvalVariant } from './dataset.js';
import {
  BENCH_SESSION_TAG_PREFIX,
  extractBenchSessionTag,
} from './extractBenchSessionTag.js';

/**
 * Configuration specific to the LongMemEval adapter. Separate from
 * {@link RunConfig} because the reader and the (optional) memory
 * provider live outside the general bench context.
 */
export interface LongMemEvalAdapterOptions {
  /** Reader LLM for answering questions. Bench tests inject a MockReader. */
  reader: IReader;
  /** Variant — `s`, `m`, or `oracle`. */
  variant: LongMemEvalVariant;
  /** Maximum reader answer tokens. Defaults to 256 — answers are usually short. */
  maxAnswerTokens?: number;
  /** How many recalled memory traces to fold into the reader's prompt. */
  recallTopK?: number;
  /**
   * Optional {@link IEmbeddingManager} for the full-cognitive path.
   * Defaults to the CharHashEmbedder stub (offline, deterministic
   * lexical only). Production / publishable runs should inject an
   * OpenAIEmbedder or equivalent so the cognitive retrieval path sees
   * real semantic similarity.
   */
  embedder?: IEmbeddingManager;
  /**
   * Optional session-level contextual-retrieval summarizer
   * (Anthropic Sep 2024 variant, `@framers/agentos/memory`). When set,
   * every chunk fed to the cognitive memory's embedder is prepended
   * with a 50-100 token LLM-generated summary of its source session,
   * giving the embedding session-wide context it would otherwise miss.
   * The CLI constructs this from `--context-summary <model>` and
   * passes it here so the adapter stays framework-agnostic.
   */
  sessionSummarizer?: SessionSummarizer;
  /**
   * Step-2 session-level retrieval store. When set, summaries
   * produced by `sessionSummarizer` are indexed into this store during
   * replay, and the runFullCognitive path uses a `SessionRetriever`
   * backed by this store instead of single-stage `manager.retrieve`.
   */
  sessionSummaryStore?: import('@framers/agentos/memory').SessionSummaryStore;
  /** Step-2: K sessions for Stage 1 (default 5). */
  sessionRetrievalTopSessions?: number;
  /** Step-2: M chunks per session for Stage 2 (default 3). */
  sessionRetrievalChunksPerSession?: number;
  /**
   * Step-3: enable hybrid BM25 + dense RRF retrieval. The per-case
   * `HybridRetriever` is constructed inside `runFullCognitiveCase`
   * using the manager's `MemoryStore`. Mutually exclusive with
   * `sessionSummaryStore` in MVP — throws a runtime error if both
   * are set.
   */
  hybridRetrievalEnabled?: boolean;
  /**
   * Step-4: enable HyDE (Hypothetical Document Embedding). When
   * true, the adapter builds a cheap LLM invoker wrapping the main
   * `reader` and passes it to `createCognitiveManager` as
   * `hydeLlmInvoker`. On the baseline branch it sets `hyde: true`
   * in the `manager.retrieve(...)` options. On the hybrid branch it
   * passes `manager.getHydeRetriever()` into the `HybridRetriever`
   * constructor so the hypothesis queries BOTH dense and sparse.
   */
  hydeEnabled?: boolean;
  /**
   * Step-5: enable FactSupersession post-retrieval filter. Adapter
   * constructs a cheap LLM invoker around the main `reader` and
   * runs `FactSupersession.resolve()` on the retrieved traces
   * before feeding them to the reader's system prompt.
   */
  factSupersessionEnabled?: boolean;
  /**
   * Step-6: threshold for split-on-ambiguous rerank refinement. When
   * > 0 and `hybridRetrievalEnabled` is true, the adapter passes this
   * to the `HybridRetriever` constructor. Typical: 0.3.
   */
  splitAmbiguousThreshold?: number;
  /**
   * Step-7 (Tier 2): enable Observer/Reflector pipeline. Adapter builds
   * a gpt-5-mini invoker, passes to `createCognitiveManager` as
   * `observerReflectorLlmInvoker`, and calls `manager.observe(...)` on
   * each conversation turn during `replayForCognitive`. At end of each
   * benchmark case, force-drains buffered notes through compression
   * and reflection cycles.
   */
  observerReflectorEnabled?: boolean;
}

/**
 * LongMemEval-S benchmark adapter.
 *
 * Memory-mode handling:
 *
 * - `none`        → haystack is concatenated into the reader's system prompt.
 * - `base-memory` → TODO(v2): needs `Memory.create` + retrieval wiring.
 *                   This commit focuses on the `none` path so the runner
 *                   and judge pipelines can be validated end-to-end.
 * - `full-cognitive` → TODO(v2): replay via `CognitiveMemoryManager.observe`
 *                   once the mock-free manager bootstrap is stabilised.
 *
 * When a mode is not yet implemented the adapter throws with a clear
 * message, which the runner surfaces as a per-case error without
 * aborting the whole run.
 */
export class LongMemEvalS implements IBenchmark {
  readonly id: string;
  readonly version = '1.0.0';
  readonly family = 'external' as const;
  readonly passThreshold = 0.5;

  constructor(private readonly opts: LongMemEvalAdapterOptions) {
    this.id = `longmemeval-${opts.variant}`;
  }

  async setup(_ctx: BenchContext): Promise<void> {
    // The dataset must be pre-placed in <dataDir>/longmemeval/. The
    // setup CLI command handles download/extract; this method is a no-op.
  }

  async loadTestCases(ctx: BenchContext): Promise<BenchCase[]> {
    const allCases = await loadLongMemEvalDataset(ctx.dataDir, this.opts.variant);
    const perType = ctx.config.samplePerType;
    // Stratified sampling: take up to `samplePerType` cases from each
    // case type, preserving dataset order within a type. Caps at the
    // available case count when the type has fewer than N cases.
    if (ctx.config.stratified && typeof perType === 'number' && perType > 0) {
      const groups = new Map<string, BenchCase[]>();
      for (const c of allCases) {
        const g = groups.get(c.type) ?? [];
        if (g.length < perType) g.push(c);
        groups.set(c.type, g);
      }
      // Flatten, preserving a stable type-order by case-type name.
      return Array.from(groups.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([, cases]) => cases);
    }
    return allCases;
  }

  async runCase(c: BenchCase, ctx: BenchContext): Promise<CaseRun> {
    const start = Date.now();
    const mode = ctx.config.memoryMode;

    let system: string;
    const retrievalPolicy = buildBenchRetrievalPolicy(ctx);
    const runMetadata: Record<string, unknown> = {
      memoryMode: mode,
      replayMode: ctx.config.replayMode,
      caseType: c.type,
    };

    if (mode === 'none') {
      system = buildNoMemorySystemPrompt(c);
    } else if (mode === 'base-memory') {
      // Resolution priority for K:
      //   1. ctx.config.readerTopK  (from --reader-top-k CLI flag)
      //   2. this.opts.recallTopK   (from adapter construction)
      //   3. 10                     (hardcoded fallback)
      // `??` propagates only on null/undefined, so an explicit 0 from
      // ctx.config would stick — but parsePositiveInteger at the CLI
      // layer rejects 0, so this branch can't actually produce K=0.
      const effectiveRecallTopK =
        ctx.config.readerTopK ?? this.opts.recallTopK ?? 10;
      const { prompt, replayStats, recallCount } = await runBaseMemoryCase(
        c,
        ctx,
        effectiveRecallTopK,
        retrievalPolicy,
      );
      system = prompt;
      runMetadata.replayStats = replayStats;
      runMetadata.recalledTraces = recallCount;
      runMetadata.retrievalPolicy = retrievalPolicy;
    } else {
      // full-cognitive — real CognitiveMemoryManager, optional observer/
      // reflector pipeline depending on replayMode.
      //
      // Resolution priority for K mirrors the base-memory branch:
      //   1. ctx.config.readerTopK  (from --reader-top-k CLI flag)
      //   2. this.opts.recallTopK   (from adapter construction)
      //   3. 10                     (hardcoded fallback)
      const effectiveRecallTopK =
        ctx.config.readerTopK ?? this.opts.recallTopK ?? 10;
      const out = await runFullCognitiveCase(
        c,
        ctx,
        effectiveRecallTopK,
        'longmemeval-s',
        retrievalPolicy,
        this.opts.embedder,
        this.opts.sessionSummarizer,
        this.opts.sessionSummaryStore,
        ctx.config.sessionRetrievalTopSessions,
        ctx.config.sessionRetrievalChunksPerSession,
        this.opts.hybridRetrievalEnabled,
        this.opts.hydeEnabled,
        this.opts.reader,
        this.opts.factSupersessionEnabled,
        this.opts.splitAmbiguousThreshold,
        this.opts.observerReflectorEnabled,
      );
      system = out.prompt;
      runMetadata.replayStats = out.replayStats;
      runMetadata.recalledTraces = out.recallCount;
      runMetadata.workingMemorySlots = out.workingMemorySlots;
      runMetadata.observationsEmitted = out.observationsEmitted;
      runMetadata.retrievedEvidence = out.retrievedEvidence;
      runMetadata.retrievalPolicy = retrievalPolicy;
      // v2 metric inputs — consumed by scoreCase via attachPerCaseMetrics.
      runMetadata.encodeMsSamples = out.encodeMsSamples;
      runMetadata.peakWorkingMemorySlots = out.peakWorkingMemorySlots;
      runMetadata.retrieveDiagnostics = out.retrieveDiagnostics;
      runMetadata.traceCount = out.traceCount;
      runMetadata.brainBytes = out.brainBytes;
    }

    const response = await this.opts.reader.invoke({
      system,
      user: c.question,
      maxTokens: this.opts.maxAnswerTokens ?? 256,
      temperature: 0,
    });

    const usd = ctx.costTracker.record({
      category: 'reader',
      model: response.model,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      tag: c.id,
    });

    return {
      caseId: c.id,
      actualOutput: response.text,
      latencyMs: Date.now() - start,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      usd,
      metadata: runMetadata,
    };
  }

  async scoreCase(c: BenchCase, run: CaseRun, ctx: BenchContext): Promise<CaseResult> {
    const judgment = await ctx.cache.memoize(
      'judge',
      () =>
        ctx.judge.judge({
          benchmarkId: this.id,
          caseId: c.id,
          caseType: c.type,
          question: c.question,
          actual: run.actualOutput,
          expected: c.expected,
          acceptableAnswers: c.acceptableAnswers,
          hints: { abstention: Boolean(c.metadata?.abstention) },
        }),
      this.id,
      this.version,
      c.id,
      ctx.config.reader,
      ctx.config.memoryMode,
      ctx.config.replayMode,
      ctx.judge.model,
      ctx.judge.rubricVersion,
      run.actualOutput,
    );

    ctx.costTracker.record({
      category: 'judge',
      model: judgment.judgeModel,
      tokensIn: judgment.tokensIn,
      tokensOut: judgment.tokensOut,
      tag: c.id,
    });

    const baseResult: CaseResult = {
      ...run,
      score: judgment.score,
      passed: judgment.correct,
      scoreMetadata: {
        judgeModel: judgment.judgeModel,
        rubricVersion: judgment.rubricVersion,
        reasoning: judgment.reasoning,
      },
    };

    return this.attachPerCaseMetrics(c, run, baseResult);
  }

  /**
   * Attach v2 metric fields to a scored case result. Returns the
   * input result unchanged for paths that don't produce metrics
   * inputs (e.g. memory-mode=none runs emit no encodeMsSamples).
   */
  private attachPerCaseMetrics(
    c: BenchCase,
    run: CaseRun,
    base: CaseResult,
  ): CaseResult {
    const md = (run.metadata ?? {}) as Record<string, unknown>;
    const retrievedEvidence =
      (md.retrievedEvidence as Array<{ sessionId?: string }> | undefined) ?? [];
    const goldSessionIds =
      (c.metadata?.answerSessionIds as string[] | undefined) ?? [];
    const k = retrievedEvidence.length > 0 ? retrievedEvidence.length : 10;

    const retrievalMetrics = computeRetrievalMetrics({
      goldSessionIds,
      retrievedSessionIds: retrievedEvidence.map((e) => e.sessionId),
      k,
    });

    const encodeMsSamples = (md.encodeMsSamples as number[] | undefined) ?? [];
    const diagnostics = md.retrieveDiagnostics as
      | import('@framers/agentos').CognitiveRetrievalResult['diagnostics']
      | undefined;
    const replayDurationMs =
      (md.replayStats as { durationMs?: number } | undefined)?.durationMs ?? 0;

    const encodeMsMean =
      encodeMsSamples.length === 0
        ? 0
        : encodeMsSamples.reduce((s, v) => s + v, 0) / encodeMsSamples.length;

    const latencyBreakdown = diagnostics
      ? {
          encodeMs: encodeMsMean,
          retrieveMs: diagnostics.totalTimeMs ?? 0,
          vectorSearchMs: diagnostics.vectorSearchTimeMs ?? 0,
          scoringMs: diagnostics.scoringTimeMs ?? 0,
          replayMs: replayDurationMs,
        }
      : undefined;

    const peakSlots = (md.peakWorkingMemorySlots as number | undefined) ?? 0;
    const encodeCalls = (md.observationsEmitted as number | undefined) ?? 0;
    const traceCount = (md.traceCount as number | undefined) ?? 0;
    const brainBytes = (md.brainBytes as number | undefined) ?? 0;

    const memoryFootprint: MemoryFootprint | undefined =
      md.brainBytes !== undefined
        ? {
            brainBytes,
            traceCount,
            peakWorkingMemorySlots: peakSlots,
            encodeCalls,
          }
        : undefined;

    return {
      ...base,
      retrievalMetrics,
      latencyBreakdown,
      memoryFootprint,
      goldSessionIds,
    };
  }

  aggregate(results: CaseResult[], ctx: BenchContext): BenchResult {
    const scores = results.map((r) => r.score);
    const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const passed = results.filter((r) => r.passed).length;
    const avgScore = scores.reduce((s, v) => s + v, 0) / Math.max(1, scores.length);

    const byType: BenchResult['byType'] = {};
    const groups = new Map<string, { n: number; passed: number; score: number }>();
    for (const r of results) {
      const caseType = ((r.metadata as Record<string, unknown> | undefined)?.caseType as string) ?? 'unknown';
      const g = groups.get(caseType) ?? { n: 0, passed: 0, score: 0 };
      g.n += 1;
      if (r.passed) g.passed += 1;
      g.score += r.score;
      groups.set(caseType, g);
    }
    for (const [type, g] of groups) {
      byType[type] = {
        n: g.n,
        accuracy: g.passed / g.n,
        avgScore: g.score / g.n,
      };
    }

    // --- v2 aggregate metrics ---

    const scoredWithGold = results.filter(
      (r) => r.retrievalMetrics !== null && r.retrievalMetrics !== undefined,
    );
    const aggregateRetrievalMetrics =
      scoredWithGold.length === 0
        ? undefined
        : {
            meanRecallAtK: mean(scoredWithGold.map((r) => r.retrievalMetrics!.recallAtK)),
            meanPrecisionAtK: mean(scoredWithGold.map((r) => r.retrievalMetrics!.precisionAtK)),
            meanNdcgAtK: mean(scoredWithGold.map((r) => r.retrievalMetrics!.ndcgAtK)),
            meanMrr: mean(scoredWithGold.map((r) => r.retrievalMetrics!.mrr)),
            k: scoredWithGold[0]!.retrievalMetrics!.k,
            sampleSize: scoredWithGold.length,
          };

    // Flatten per-case latency samples into per-op arrays. encodeMs is a
    // per-case MEAN (one entry per case, not per encode), so the aggregate
    // is mean-of-means — good enough for the leaderboard pitch.
    const encodeMsAll = results
      .map((r) => r.latencyBreakdown?.encodeMs ?? 0)
      .filter((v) => v > 0);
    const retrieveMsAll = results
      .map((r) => r.latencyBreakdown?.retrieveMs ?? 0)
      .filter((v) => v > 0);
    const vectorSearchMsAll = results
      .map((r) => r.latencyBreakdown?.vectorSearchMs ?? 0)
      .filter((v) => v > 0);
    const scoringMsAll = results
      .map((r) => r.latencyBreakdown?.scoringMs ?? 0)
      .filter((v) => v > 0);
    const replayMsAll = results
      .map((r) => r.latencyBreakdown?.replayMs ?? 0)
      .filter((v) => v > 0);

    const aggregateLatencyBreakdown =
      results.some((r) => r.latencyBreakdown !== undefined)
        ? computeLatencyBreakdown({
            encodeMs: encodeMsAll,
            retrieveMs: retrieveMsAll,
            vectorSearchMs: vectorSearchMsAll,
            scoringMs: scoringMsAll,
            replayMs: replayMsAll,
          })
        : undefined;

    const stratifiedAccuracy = computeStratifiedAccuracy(
      results,
      this.opts.variant === 's' ? LONGMEMEVAL_S_PRIORS : {},
    );

    const footprintSamples = results
      .map((r) => r.memoryFootprint)
      .filter((fp): fp is MemoryFootprint => fp !== undefined);
    const brainBytesSorted = footprintSamples
      .map((fp) => fp.brainBytes)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    const aggregateMemoryFootprint =
      footprintSamples.length === 0
        ? undefined
        : {
            meanBrainBytes: mean(brainBytesSorted),
            p95BrainBytes: percentile(brainBytesSorted, 95),
            meanTraceCount: mean(footprintSamples.map((fp) => fp.traceCount)),
            maxPeakWorkingMemorySlots: Math.max(
              0,
              ...footprintSamples.map((fp) => fp.peakWorkingMemorySlots),
            ),
            totalEncodeCalls: footprintSamples.reduce((s, fp) => s + fp.encodeCalls, 0),
          };

    const tokensPerCorrect = computeTokenEfficiency(ctx.costTracker, passed);

    return {
      benchmarkId: this.id,
      benchmarkVersion: this.version,
      config: ctx.config,
      totalCases: results.length,
      passedCases: passed,
      accuracy: passed / Math.max(1, results.length),
      avgScore,
      scoreStdDev: stdDev(scores),
      byType,
      avgLatencyMs: latencies.reduce((s, v) => s + v, 0) / Math.max(1, latencies.length),
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      totalReaderTokens: ctx.costTracker.byCategory.reader.totalTokensIn + ctx.costTracker.byCategory.reader.totalTokensOut,
      totalUsd: ctx.costTracker.totals.totalUsd,
      costPerCorrect: passed > 0 ? ctx.costTracker.totals.totalUsd / passed : 0,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      retrievalMetrics: aggregateRetrievalMetrics,
      latencyBreakdown: aggregateLatencyBreakdown,
      stratifiedAccuracy,
      memoryFootprint: aggregateMemoryFootprint,
      tokensPerCorrect,
      cases: results,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildNoMemorySystemPrompt(c: BenchCase): string {
  const haystack = c.haystack.length > 0 ? buildHaystackContext(c.haystack) : '';
  const header = [
    'You are being evaluated on long-term conversation memory.',
    'Answer the question based on the conversation history below.',
    'Be concise. If you cannot find the answer in the history, say "I don\'t know".',
  ].join(' ');
  const dateHeader = c.questionDate ? `\n\n[Question asked on ${c.questionDate}]` : '';
  return `${header}${dateHeader}\n\n--- Conversation History ---\n${haystack}\n--- End History ---`;
}

interface BaseMemoryCaseOutput {
  prompt: string;
  replayStats: { sessionsReplayed: number; turnsReplayed: number; durationMs: number };
  recallCount: number;
}

/**
 * Run one case through the base-memory path:
 *  1. Open a fresh SQLite-backed {@link Memory} under ctx.scratchDir.
 *  2. Replay the haystack via `Memory.remember` (one trace per session).
 *  3. Recall the top-K relevant traces for the question.
 *  4. Build the reader system prompt from the recalled traces.
 *  5. Close the Memory and delete its SQLite file (best-effort).
 *
 * No embedding function is wired in this adapter — recall falls back to
 * Memory's FTS5 path, which is sufficient for a functional end-to-end
 * pipeline. Real benchmark sweeps should pair this adapter with an
 * embedder via a subclass or config extension before publishing numbers.
 */
async function runBaseMemoryCase(
  c: BenchCase,
  ctx: BenchContext,
  recallTopK: number,
  retrievalPolicy: MemoryRetrievalPolicy,
): Promise<BaseMemoryCaseOutput> {
  const brainPath = path.join(
    ctx.scratchDir,
    `bench-${c.id.replace(/[^a-zA-Z0-9-_]/g, '_')}.sqlite`,
  );
  const mem = await Memory.create({ path: brainPath, selfImprove: false });
  try {
    const replayStats = await replayViaIngest(c.haystack, mem);
    const recalled = await mem.recall(c.question, {
      limit: recallTopK,
      policy: retrievalPolicy,
    });
    return {
      prompt: buildBaseMemoryPrompt(c, recalled),
      replayStats: {
        sessionsReplayed: replayStats.sessionsReplayed,
        turnsReplayed: replayStats.turnsReplayed,
        durationMs: replayStats.durationMs,
      },
      recallCount: recalled.length,
    };
  } finally {
    await mem.close().catch(() => {});
    await fs.rm(brainPath, { force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Full-cognitive path
// ---------------------------------------------------------------------------

interface FullCognitiveOutput {
  prompt: string;
  replayStats: { sessionsReplayed: number; turnsReplayed: number; durationMs: number };
  recallCount: number;
  workingMemorySlots: number;
  observationsEmitted: number;
  /** Compact audit trail of what memory returned for the question. */
  retrievedEvidence: Array<{
    id: string;
    score: number;
    snippet: string;
    /**
     * Source session ID parsed off the `bench-session:` tag on the
     * retrieved trace. Undefined when the retrieved trace carries no
     * bench-session tag.
     */
    sessionId?: string;
  }>;
  /** Per-call encode wall time (ms). One entry per successful encode. */
  encodeMsSamples: number[];
  /** Max working-memory slot count sampled during replay. */
  peakWorkingMemorySlots: number;
  /**
   * Retrieval diagnostics emitted by CognitiveMemoryManager.retrieve;
   * used by downstream metric helpers (computeLatencyBreakdown) for
   * per-case vectorSearchMs / scoringMs / totalTimeMs attribution.
   */
  retrieveDiagnostics: import('@framers/agentos').CognitiveRetrievalResult['diagnostics'];
  /**
   * Post-replay trace count in the manager's in-memory cache. Captured
   * before cleanup via the agentos public `getTraceCount()`.
   */
  traceCount: number;
  /**
   * SQLite brain file path — used by memory-footprint probes to
   * measure bytes-on-disk before the file is deleted on case close.
   */
  brainPath: string;
  /**
   * Brain file size in bytes, measured before `close()` deletes the
   * file. Zero when the brain was never materialised.
   */
  brainBytes: number;
}

/**
 * Run one case through the full-cognitive path:
 *   1. Open a scratch `CognitiveMemoryManager` (SQLite brain +
 *      SqliteKnowledgeGraph + InMemoryVectorStore + CharHashEmbedder).
 *   2. Replay the haystack. `observe` drives per-turn
 *      {@link CognitiveMemoryManager.observe} (exercises the observer /
 *      reflector / working-memory pipeline). `ingest` drives the more
 *      direct `encode` path, session by session.
 *   3. `retrieve(question, topK)` for the reader context.
 *   4. Build the system prompt from the retrieved traces.
 *   5. Close the manager, delete the brain file.
 *
 * The CharHashEmbedder is deterministic lexical (not semantic). Real
 * benchmark sweeps should inject an API-backed embedder via a subclass
 * override or a direct `createCognitiveManager({ embedder })` wrapper.
 *
 * Exported so Locomo (and future adapters) can reuse the same path.
 */
export async function runFullCognitiveCase(
  c: BenchCase,
  ctx: BenchContext,
  recallTopK: number,
  adapterId: string,
  retrievalPolicy: MemoryRetrievalPolicy,
  embedder?: IEmbeddingManager,
  sessionSummarizer?: SessionSummarizer,
  sessionSummaryStore?: import('@framers/agentos/memory').SessionSummaryStore,
  sessionRetrievalTopSessions?: number,
  sessionRetrievalChunksPerSession?: number,
  hybridRetrievalEnabled?: boolean,
  hydeEnabled?: boolean,
  hydeReader?: IReader,
  factSupersessionEnabled?: boolean,
  splitAmbiguousThreshold?: number,
  observerReflectorEnabled?: boolean,
): Promise<FullCognitiveOutput> {
  // Step 3 mutex: combined hybrid + session-level retrieval is Step 7
  // territory; MVP rejects the combination explicitly.
  if (hybridRetrievalEnabled && sessionSummaryStore) {
    throw new Error(
      '--hybrid-retrieval and --session-retrieval are mutually exclusive in Step 3 MVP.',
    );
  }

  const brainPath = path.join(
    ctx.scratchDir,
    `${adapterId}-cog-${c.id.replace(/[^a-zA-Z0-9-_]/g, '_')}.sqlite`,
  );
  // Resolve reranker config. `apiKey` precedence: RunConfig override →
  // COHERE_API_KEY env. When rerank is requested but no key is found,
  // we fall through (createCognitiveManager no-ops the reranker
  // gracefully) and log so sweeps surface the misconfiguration fast.
  const rerankRequest = ctx.config.rerank;
  const rerankApiKey = rerankRequest
    ? rerankRequest.apiKey ?? process.env.COHERE_API_KEY ?? ''
    : '';
  if (rerankRequest && !rerankApiKey) {
    // eslint-disable-next-line no-console
    console.warn(
      '[longmemeval] rerank requested but no Cohere API key resolved. ' +
        'Set COHERE_API_KEY or pass --rerank-api-key. Falling back to cognitive-only scoring.',
    );
  }

  // Step-4: HyDE invoker. Reuses the main reader to keep the CLI
  // surface tiny and cost tracked through the existing CostTracker.
  // Low-temp, short-token budget keeps per-call cost under $0.0003.
  let hydeLlmInvoker:
    | ((systemPrompt: string, userPrompt: string) => Promise<string>)
    | undefined;
  if (hydeEnabled && hydeReader) {
    hydeLlmInvoker = async (systemPrompt: string, userPrompt: string) => {
      const resp = await hydeReader.invoke({
        system: systemPrompt,
        user: userPrompt,
        maxTokens: 150,
        temperature: 0.3,
      });
      ctx.costTracker.record({
        category: 'reader',
        model: resp.model,
        tokensIn: resp.tokensIn,
        tokensOut: resp.tokensOut,
        tag: `hyde:${c.id}`,
      });
      return resp.text;
    };
  }

  // Step-7 (Tier 2): Observer/Reflector invoker. Uses the bench reader
  // abstraction — summarization doesn't need the main reader's quality,
  // and Mastra's OM uses gpt-5-mini. Costs tracked per-case via the
  // bench's CostTracker.
  let observerReflectorLlmInvoker:
    | ((systemPrompt: string, userPrompt: string) => Promise<string>)
    | undefined;
  if (observerReflectorEnabled && hydeReader) {
    observerReflectorLlmInvoker = async (systemPrompt: string, userPrompt: string) => {
      const resp = await hydeReader.invoke({
        system: systemPrompt,
        user: userPrompt,
        maxTokens: 2000,
        temperature: 0.3,
      });
      ctx.costTracker.record({
        category: 'reader',
        model: resp.model,
        tokensIn: resp.tokensIn,
        tokensOut: resp.tokensOut,
        tag: `observer-reflector:${c.id}`,
      });
      return resp.text;
    };
  }

  const handle = await createCognitiveManager({
    brainPath,
    embedder,
    disableMechanism: ctx.config.ablateMechanism,
    reranker:
      rerankRequest && rerankApiKey
        ? {
            provider: 'cohere',
            apiKey: rerankApiKey,
            model: (rerankRequest.model as
              | 'rerank-v3.5'
              | 'rerank-v4.0-pro'
              | 'rerank-v4.0-fast'
              | undefined) ?? 'rerank-v3.5',
          }
        : undefined,
    hydeLlmInvoker,
    observerReflectorLlmInvoker,
  });
  try {
    // Step 3: construct per-case HybridRetriever if enabled. The
    // reranker is pulled from the manager via the public getter added
    // for Step 3 — matches baseline rerank wiring exactly.
    let hybridRetriever:
      | import('@framers/agentos/memory').HybridRetriever
      | undefined;
    if (hybridRetrievalEnabled) {
      const { HybridRetriever } = await import('@framers/agentos/memory');
      hybridRetriever = new HybridRetriever({
        memoryStore: handle.manager.getStore(),
        rerankerService: handle.manager.getRerankerService?.() ?? undefined,
        hydeRetriever:
          hydeEnabled
            ? handle.manager.getHydeRetriever?.() ?? undefined
            : undefined,
        splitAmbiguousThreshold,
      });
    }

    const replayStats = await replayForCognitive(
      c,
      handle,
      ctx.config.replayMode,
      sessionSummarizer,
      sessionSummaryStore,
      hybridRetriever?.bm25,
      observerReflectorEnabled,
    );

    // Build a per-call weight override when --ablate-signal is set.
    // Undefined → agentos uses DEFAULT_SCORING_WEIGHTS.
    const scoringWeights = ctx.config.ablateSignal
      ? { [ctx.config.ablateSignal]: 0 }
      : undefined;

    // Widen the candidate pool when a reranker is active so the
    // cross-encoder has meaningfully more options than the final
    // reader K. Default 3× on rerank, 1× otherwise.
    const rerankActive = Boolean(rerankRequest && rerankApiKey);
    const candidateMultiplier = rerankActive
      ? Math.max(1, rerankRequest?.candidateMultiplier ?? 3)
      : 1;
    const retrievalTopK = Math.max(recallTopK, recallTopK * candidateMultiplier);

    // Step 2/3: swap retrieval path based on which opt-in retriever is
    // configured. HybridRetriever wins when both (guarded by mutex
    // at function entry). Same CognitiveRetrievalResult shape so
    // downstream score-floor + slice-to-recallTopK logic continues
    // unchanged.
    let retrieval: import('@framers/agentos').CognitiveRetrievalResult;
    if (hybridRetriever) {
      retrieval = await hybridRetriever.retrieve(
        c.question,
        { valence: 0, arousal: 0, dominance: 0 },
        { scope: 'user', scopeId: 'bench' },
        { recallTopK: retrievalTopK },
      );
    } else if (sessionSummaryStore && embedder) {
      const { SessionRetriever } = await import('@framers/agentos/memory');
      const sessionRetriever = new SessionRetriever({
        summaryStore: sessionSummaryStore,
        memoryStore: handle.manager.getStore(),
        embeddingManager: embedder,
        defaultTopSessions: sessionRetrievalTopSessions ?? 5,
        defaultChunksPerSession: sessionRetrievalChunksPerSession ?? 3,
      });
      retrieval = await sessionRetriever.retrieve(
        c.question,
        { valence: 0, arousal: 0, dominance: 0 },
        { scope: 'user', scopeId: 'bench' },
        { recallTopK: retrievalTopK },
      );
    } else {
      retrieval = await handle.manager.retrieve(
        c.question,
        { valence: 0, arousal: 0, dominance: 0 },
        {
          topK: retrievalTopK,
          neutralMood: true,
          policy: retrievalPolicy,
          scoringWeights,
          hyde: hydeEnabled === true ? true : undefined,
        },
      );
    }

    // Step-5: FactSupersession post-retrieval filter. Runs when
    // --fact-supersession is set. Uses the already-threaded
    // `hydeReader` (the main adapter reader) as the LLM invoker.
    // Drops traces whose facts are superseded by later traces about
    // the same subject. Errors fall back to the unfiltered set.
    if (factSupersessionEnabled && retrieval.retrieved.length > 0) {
      const fsReader = hydeReader;
      if (!fsReader) {
        throw new Error(
          'FactSupersession requires a reader to be threaded through runFullCognitiveCase.',
        );
      }
      const { FactSupersession } = await import('@framers/agentos/memory');
      const fsInvoker = async (system: string, user: string) => {
        const resp = await fsReader.invoke({
          system,
          user,
          maxTokens: 200,
          temperature: 0,
        });
        ctx.costTracker.record({
          category: 'reader',
          model: resp.model,
          tokensIn: resp.tokensIn,
          tokensOut: resp.tokensOut,
          tag: `fact-supersession:${c.id}`,
        });
        return resp.text;
      };
      const fs = new FactSupersession({ llmInvoker: fsInvoker });
      const fsResult = await fs.resolve({
        traces: retrieval.retrieved,
        query: c.question,
      });
      retrieval = {
        ...retrieval,
        retrieved: fsResult.traces,
        diagnostics: {
          ...retrieval.diagnostics,
          factSupersession: {
            droppedIds: fsResult.droppedIds,
            parseOk: fsResult.diagnostics.parseOk,
            llmLatencyMs: fsResult.diagnostics.llmLatencyMs,
            ...(fsResult.diagnostics.notes ? { notes: fsResult.diagnostics.notes } : {}),
          },
        },
      };
    }
    const wmSlots = handle.manager.getWorkingMemory?.().getSlotCount?.() ?? 0;

    // Drop low-relevance chunks before they reach the reader. Retrieval
    // often returns 10 chunks even when only the top 3-5 are meaningfully
    // related to the question, and the tail dilutes the reader's
    // attention on the actual hero memory. Threshold is conservative
    // (0.2) — retrieved items with a composite score below this are
    // consistently off-topic in the pilot CSVs.
    //
    // When the neural reranker is active, retrieve blends 0.7 cog + 0.3
    // neural; a chunk with a perfect neural score (1.0) but a mediocre
    // cognitive score (0.2) sits at 0.44 after blend. Lowering the
    // cutoff to RETRIEVAL_SCORE_MIN_RERANKED keeps that chunk in.
    const scoreFloor = rerankActive
      ? RETRIEVAL_SCORE_MIN_RERANKED
      : RETRIEVAL_SCORE_MIN;
    const filtered = retrieval.retrieved.filter(
      (t) => (t.retrievalScore ?? 0) >= scoreFloor,
    );
    // Always include at least the top result so the reader has something
    // to work with even on questions where every chunk scored poorly.
    // After score-floor filtering, truncate to the reader K so the
    // prompt doesn't balloon when we over-fetched for rerank candidates.
    //
    // Failed experiment log — session-diverse top-K (Fix A, 2026-04-19):
    //   Tried capping MAX_CHUNKS_PER_SESSION=3 to force retrieval
    //   across multiple sessions. Targeted the 3/5 multi-session
    //   failures at Phase A where gold-session coverage was 2/3 to
    //   4/5 of required sessions in top-10. Smoke result: multi-session
    //   crashed 100% → 25% and overall 95.8% → 79.2% at N=24. Root
    //   cause of regression: Cohere rerank already orders chunks by
    //   genuine relevance; displacing rank 1-10 with rank 11-30 chunks
    //   from other sessions added noise without adding gold coverage
    //   when the answer legitimately lived in 1-2 sessions. The
    //   candidate pool — not the final slice — was the actual coverage
    //   gap. Reverted 2026-04-19.
    const reader_chunks = (filtered.length > 0
      ? filtered
      : retrieval.retrieved.slice(0, 1)
    ).slice(0, recallTopK);

    const retrievedEvidence = reader_chunks.map((t) => ({
      id: t.id,
      score: t.retrievalScore ?? 0,
      snippet: String(t.content ?? '').slice(0, 280),
      sessionId: extractBenchSessionTag(t.tags),
    }));

    // Snapshot footprint fields BEFORE close() deletes the brain file.
    const traceCount = handle.manager.getTraceCount?.() ?? 0;
    let brainBytes = 0;
    try {
      const stat = await fs.stat(brainPath);
      brainBytes = stat.size;
    } catch {
      // brain file may not exist (e.g., close was called prematurely)
    }

    return {
      prompt: buildFullCognitivePrompt(c, reader_chunks),
      replayStats: {
        sessionsReplayed: replayStats.sessionsReplayed,
        turnsReplayed: replayStats.turnsReplayed,
        durationMs: replayStats.durationMs,
      },
      recallCount: reader_chunks.length,
      workingMemorySlots: wmSlots,
      observationsEmitted: replayStats.observationsEmitted,
      retrievedEvidence,
      encodeMsSamples: replayStats.encodeMsSamples,
      peakWorkingMemorySlots: replayStats.peakWorkingMemorySlots,
      retrieveDiagnostics: retrieval.diagnostics,
      traceCount,
      brainPath,
      brainBytes,
    };
  } finally {
    await handle.close();
  }
}

/**
 * Composite-score threshold below which a retrieved trace is dropped
 * from the reader prompt. Items below this consistently turned out to
 * be off-topic in the pilot CSVs (0.25 top hit = semantically adjacent
 * but wrong session). Too aggressive a floor drops real recall, so we
 * always keep at least the top-1 result regardless.
 */
/**
 * Reader-prompt version tag. Bumped whenever `buildFullCognitivePrompt`
 * or `buildBaseMemoryPrompt` changes materially, so the run-cache key
 * invalidates and prior-version answers don't leak into new sweeps.
 *
 * History:
 *   v4 — temporal-balanced, anti-abstention, latest-wins
 *   v5 — temporal CoT scratchpad, mandatory "Answer:" final line
 *   v6 — hardened anti-chat framing, explicit memory-lookup role
 */
export const READER_PROMPT_VERSION = 'v9';

const RETRIEVAL_SCORE_MIN = 0.2;

/**
 * Lower floor applied when the neural reranker is active. With the
 * manager's 0.7 cognitive + 0.3 neural blend, a perfect neural score
 * (1.0) paired with a mediocre cognitive score (0.2) lands at 0.44;
 * a weak neural signal on an already-good cognitive hit may fall
 * slightly below 0.2. Dropping to 0.1 keeps high-neural low-cognitive
 * rescues in the reader context without flooding it with noise.
 */
const RETRIEVAL_SCORE_MIN_RERANKED = 0.1;

/**
 * Safe upper bound on chunk text length sent to embedders. OpenAI's
 * `text-embedding-3-*` enforces an 8192-token limit. Token:char ratio
 * varies widely: plain English ~4 chars/token, dense structured text
 * (Wikipedia with acronyms / citations / numeric references) ~1-1.5
 * chars/token. A 10k-char piece of Wikipedia content has been observed
 * to exceed 8192 tokens (confirmed live: question_id=852ce960 failed
 * at chunk lengths up to 10.4k chars even after splitting). 6k chars
 * fits under 8192 tokens for every content profile we've seen in
 * LongMemEval-S — even 1:1 char/token pathological content.
 *
 * Chunks above this are split at newline / whitespace boundaries until
 * every piece fits. All pieces carry the same bench-session tag so
 * session-level retrieval metrics still work.
 *
 * TODO(future): replace with a real tokenizer (gpt-tokenizer) for
 * precise token-level splitting. The char-level fallback is
 * intentionally conservative.
 */
const SAFE_EMBEDDING_CHAR_LIMIT = 6_000;

/**
 * Split a single chunk into embedding-safe pieces. Recursively halves
 * the chunk along line or whitespace boundaries until every piece is
 * under {@link SAFE_EMBEDDING_CHAR_LIMIT}.
 */
export function splitForEmbedding(chunk: string): string[] {
  if (chunk.length <= SAFE_EMBEDDING_CHAR_LIMIT) return [chunk];
  // Prefer splitting at a newline near the midpoint; fall back to any
  // whitespace; last resort is a hard slice.
  const mid = Math.floor(chunk.length / 2);
  const searchFrom = Math.max(0, mid - 500);
  const searchTo = Math.min(chunk.length, mid + 500);
  const window = chunk.slice(searchFrom, searchTo);
  let cut = window.indexOf('\n');
  if (cut < 0) cut = window.lastIndexOf(' ');
  const splitAt = cut >= 0 ? searchFrom + cut + 1 : mid;
  const left = chunk.slice(0, splitAt);
  const right = chunk.slice(splitAt);
  return [...splitForEmbedding(left), ...splitForEmbedding(right)];
}

function buildBenchRetrievalPolicy(ctx: BenchContext): MemoryRetrievalPolicy {
  return {
    profile: ctx.config.retrievalProfile ?? 'balanced',
    adaptive: ctx.config.adaptiveRetrieval ?? true,
  };
}

/**
 * Replay the haystack into a cognitive manager. The observer /
 * reflector pipeline requires an LLM invoker which benchmarks run
 * without, so we fall back to direct {@link CognitiveMemoryManager.encode}
 * calls.
 *
 * Replay modes:
 *   - `observe` — one encode per turn (finest granularity, highest
 *     embedding-call count). Best retrieval fidelity but expensive.
 *   - `ingest` — one encode per **turn-pair** (user + following
 *     assistant turn). Reduces embedding calls by ~2× vs observe while
 *     still giving retrieval enough signal to surface the specific
 *     exchange that holds the hero memory. Empirically a ~3-turn
 *     window is the sweet spot — per-session ingest (the previous
 *     behaviour) buried hero memories in 3k-token traces and tanked
 *     retrieval; per-turn-pair keeps traces ~300–600 tokens.
 *
 * `observationsEmitted` tracks how many `encode` calls landed so
 * callers have a cognitive-path activity signal.
 */
async function replayForCognitive(
  c: BenchCase,
  handle: { manager: import('@framers/agentos').CognitiveMemoryManager },
  mode: 'observe' | 'ingest',
  sessionSummarizer?: SessionSummarizer,
  sessionSummaryStore?: import('@framers/agentos/memory').SessionSummaryStore,
  hybridBm25?: import('@framers/agentos/memory').HybridRetriever['bm25'],
  observerReflectorEnabled?: boolean,
): Promise<{
  sessionsReplayed: number;
  turnsReplayed: number;
  durationMs: number;
  observationsEmitted: number;
  /** Per-call encode wall time (ms). One entry per successful encode. */
  encodeMsSamples: number[];
  /** Max working-memory slot count sampled during replay. */
  peakWorkingMemorySlots: number;
  /**
   * Count of sessions for which a contextual-retrieval summary was
   * generated (cached hits + fresh LLM calls both count). Zero when
   * no {@link SessionSummarizer} is wired. Surfaced so the sweep
   * report can attribute ingest-side LLM cost to context summaries.
   */
  sessionsContextualized: number;
}> {
  const start = Date.now();
  const neutralMood = { valence: 0, arousal: 0, dominance: 0 };
  let turns = 0;
  let encodeCalls = 0;
  let sessionsContextualized = 0;
  const encodeMsSamples: number[] = [];
  let peakWorkingMemorySlots = 0;

  // Build the full text of a session once so the summarizer can hash
  // it for cache-key generation. `speaker: content` matches what the
  // per-chunk encode path emits, so the summary embeds on the same
  // text shape the reader later sees.
  const sessionAsText = (session: typeof c.haystack[number]): string =>
    session.turns
      .filter((t) => t.content.trim().length > 0)
      .map((t) => `${t.role}: ${t.content}`)
      .join('\n');

  const sampleSlots = (): void => {
    const slots = handle.manager.getWorkingMemory?.().getSlotCount?.() ?? 0;
    if (slots > peakWorkingMemorySlots) peakWorkingMemorySlots = slots;
  };

  const timedEncode = async (
    content: string,
    tags: string[],
  ): Promise<string> => {
    const t0 = Date.now();
    const trace = await handle.manager.encode(content, neutralMood, '', {
      type: 'episodic',
      scope: 'user',
      scopeId: 'bench',
      tags,
    });
    encodeMsSamples.push(Date.now() - t0);
    encodeCalls += 1;
    // Sample working-memory slots every 10 encodes — peak is stable
    // within a window, so finer sampling adds no signal but doubles
    // the observation overhead.
    if (encodeCalls % 10 === 0) sampleSlots();
    return trace.id;
  };

  if (mode === 'observe') {
    for (const session of c.haystack) {
      const sessionTag = `${BENCH_SESSION_TAG_PREFIX}${session.sessionId}`;
      // Optional session-level context summary (Anthropic Sep 2024
      // contextual retrieval, session-granularity variant). One LLM
      // call per unique session; cached on disk so re-runs amortize
      // to ~0. Empty string when summarizer is not configured → the
      // rest of the loop degrades cleanly to pre-contextual behavior.
      let sessionContext = '';
      if (sessionSummarizer) {
        const text = sessionAsText(session);
        if (text.length > 0) {
          sessionContext = await sessionSummarizer.summarize(
            `${c.id}:${session.sessionId}`,
            text,
          );
          if (sessionContext) sessionsContextualized += 1;
          // Step 2: index the summary in the per-run SessionSummaryStore
          // so SessionRetriever's Stage 1 can find it. Cheap: embedding
          // call only, cached via the shared embedder's cache.
          if (sessionSummaryStore && sessionContext) {
            await sessionSummaryStore.indexSession({
              scope: 'user',
              scopeId: 'bench',
              sessionId: session.sessionId,
              summary: sessionContext,
              sessionDate: session.date,
            });
          }
        }
      }
      for (const turn of session.turns) {
        turns += 1;
        if (!turn.content.trim()) continue;
        const full = sessionContext
          ? `[Session context] ${sessionContext}\n${turn.role}: ${turn.content}`
          : `${turn.role}: ${turn.content}`;
        for (const piece of splitForEmbedding(full)) {
          const traceId = await timedEncode(piece, [sessionTag]);
          // Step 3: also index into BM25 when hybrid retrieval is active.
          if (hybridBm25) {
            hybridBm25.addDocument(traceId, piece, { tag: sessionTag });
          }
        }
        // Step 7: feed the raw turn into Observer/Reflector pipeline.
        // The pipeline fires internal LLM calls at its own thresholds
        // (30k-token buffer, 50-note compression, 40k-token reflection).
        // Reflection-derived traces get encoded automatically.
        if (observerReflectorEnabled) {
          const role = turn.role as 'user' | 'assistant' | 'system' | 'tool';
          if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') {
            try {
              await handle.manager.observe(role, turn.content, neutralMood);
            } catch {
              // Observer errors are non-critical; continue ingest.
            }
          }
        }
      }
    }
  } else {
    for (const session of c.haystack) {
      const sessionTag = `${BENCH_SESSION_TAG_PREFIX}${session.sessionId}`;
      // Session-level context summary — same as the observe branch
      // above. Generated once per session, prepended to every chunk
      // before the date prefix so the final chunk shape is:
      //   `[Session context] <summary>\n[YYYY-MM-DD] <chunk text>`
      let sessionContext = '';
      if (sessionSummarizer) {
        const text = sessionAsText(session);
        if (text.length > 0) {
          sessionContext = await sessionSummarizer.summarize(
            `${c.id}:${session.sessionId}`,
            text,
          );
          if (sessionContext) sessionsContextualized += 1;
          // Step 2: index the summary in the per-run SessionSummaryStore
          // so SessionRetriever's Stage 1 can find it. Cheap: embedding
          // call only, cached via the shared embedder's cache.
          if (sessionSummaryStore && sessionContext) {
            await sessionSummaryStore.indexSession({
              scope: 'user',
              scopeId: 'bench',
              sessionId: session.sessionId,
              summary: sessionContext,
              sessionDate: session.date,
            });
          }
        }
      }
      const chunks = chunkSessionTurns(session.turns);
      turns += session.turns.length;
      for (const chunk of chunks) {
        if (!chunk.trim()) continue;
        // Prepend order matters: context summary first, then date,
        // then chunk text. The date prefix stays canonical for the
        // reader's temporal-reasoning scratchpad.
        const contextualized = sessionContext
          ? `[Session context] ${sessionContext}\n${chunk}`
          : chunk;
        const dated = session.date
          ? `[${session.date}] ${contextualized}`
          : contextualized;
        for (const piece of splitForEmbedding(dated)) {
          const traceId = await timedEncode(piece, [sessionTag]);
          // Step 3: also index into BM25 when hybrid retrieval is active.
          if (hybridBm25) {
            hybridBm25.addDocument(traceId, piece, { tag: sessionTag });
          }
        }
      }
      // Step 7: feed original per-turn role+content into Observer.
      // Observer wants the conversational structure, not chunked text.
      if (observerReflectorEnabled) {
        for (const turn of session.turns) {
          if (!turn.content.trim()) continue;
          const role = turn.role as 'user' | 'assistant' | 'system' | 'tool';
          if (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'tool') continue;
          try {
            await handle.manager.observe(role, turn.content, neutralMood);
          } catch {
            // Observer errors are non-critical; continue ingest.
          }
        }
      }
    }
  }

  // Step 7: force-drain any remaining buffered observation notes through
  // compression + reflection at end of replay. Without this flush, partial
  // buffers from the last session don't produce reflection traces.
  if (observerReflectorEnabled) {
    const observer = handle.manager.getObserver?.();
    if (observer) {
      try {
        await observer.extractNotes(neutralMood);
        await observer.compressIfNeeded();
        await observer.reflectIfNeeded();
      } catch {
        // Flush errors are non-critical; proceed to retrieve.
      }
    }
  }

  // Final sample so the peak covers the end of replay.
  sampleSlots();

  return {
    sessionsReplayed: c.haystack.length,
    turnsReplayed: turns,
    durationMs: Date.now() - start,
    observationsEmitted: encodeCalls,
    encodeMsSamples,
    peakWorkingMemorySlots,
    sessionsContextualized,
  };
}

/**
 * Split a session's turns into retrieval-friendly chunks. Groups are
 * {user, assistant} turn-pairs — each pair is a self-contained unit
 * of memory. Lone user turns at the end of a session become their own
 * chunk. System / tool turns are appended to the most recent user or
 * assistant turn so they share retrieval surface area.
 *
 * Empirically this shape gets retrieval to surface specific exchanges
 * instead of whole sessions, which was the core cause of the pilot's
 * 40% accuracy on LongMemEval-S.
 */
export function chunkSessionTurns(
  turns: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>,
): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let sawUser = false;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push(current.join('\n'));
    current = [];
    sawUser = false;
  };

  for (const turn of turns) {
    const line = `${turn.role}: ${turn.content}`;
    if (turn.role === 'user') {
      // Starting a fresh user turn → flush the previous exchange.
      if (sawUser) flush();
      current.push(line);
      sawUser = true;
    } else if (turn.role === 'assistant') {
      current.push(line);
      // assistant reply closes a user→assistant pair — flush now so
      // the retrieval unit is exactly one exchange.
      flush();
    } else {
      // system / tool — stick to the in-flight chunk.
      current.push(line);
    }
  }
  flush();
  return chunks;
}

function buildFullCognitivePrompt(
  c: BenchCase,
  recalled: Array<{ id: string; content: string; retrievalScore?: number }>,
): string {
  // Reader prompt tuning (v9 — v8 + personalization rule for advice):
  //
  // Phase A (102-case LME-S) surfaced a new failure mode on
  // single-session-preference: reader gave generic well-reasoned
  // advice while IGNORING retrieved personal context. 8 of 9 failures
  // had the user's specific preferences / recent purchases / past
  // experiments in the retrieved chunks (confirmed via keyword
  // search: "turbinado sugar" in 4 chunks, "slow cooker" in 7,
  // "mid-century dresser" in 6, etc.) but the reader produced
  // textbook best-practices advice ("reduce screen brightness",
  // "use browned butter") with zero reference to what the user said.
  //
  // Judge rubric for single-session-preference:
  //   "The response is correct as long as it recalls and utilizes
  //    the user's personal information correctly."
  // Generic advice violates this criterion by construction.
  //
  // v9 fix: scoped instruction for recommendation/advice questions
  // ("any tips", "can you suggest", "advice on"). Tells the reader
  // to START the answer from the user's specific context in the
  // excerpts and only then provide practice tips. Does NOT change
  // abstention boundary, format rigidity, or any other behavior —
  // scoped to question type, not prompt-wide.
  //
  // Earlier failure modes investigated:
  //   FM1 (LOCOMO adversarial): judge rejected bare "I don't know"
  //     → fixed in v8 with explicit "excerpts do not mention X"
  //     wording; lifted adversarial 17% → 33% at N=6.
  //   FM2 (LOCOMO adversarial): reader fabricated from loose semantic
  //     matches; structural fix pending (CRAG retrieval grading).
  //   FM3 (LME-S preference): reader ignores retrieved personal
  //     context → THIS is what v9 attacks.
  //
  // Failed experiments log:
  //   v6: rigid ROLE/FORMAT. -10pp weighted on LongMemEval.
  //   v7: two-branch abstention rule. Broke all three benchmarks.
  //
  // v5/v4/v8 backbone preserved:
  //   - [YYYY-MM-DD] prefix canonical for dates
  //   - Latest-wins on contradicting facts
  //   - Anti-abstention: commit on partial evidence
  //   - Temporal scratchpad for time-interval questions
  //   - Final line always "Answer: <...>"
  //   - v8 explicit abstention wording ("excerpts do not mention X")
  const header = [
    'You answer questions from retrieved conversation excerpts. Every excerpt starts with [YYYY-MM-DD] — that is the session date and the only authoritative source for time ordering, intervals, and "how long ago / before / after" questions.',
    'If facts conflict across excerpts (job, weight, approved amount, preferences), prefer the most recent [YYYY-MM-DD]. Earlier contradicting info is superseded; do not list both.',
    'For time-interval questions ("how many days since X", "how long ago was Y", "when did Z happen relative to now"), first write a short scratchpad on separate lines:',
    '  Scratch: relevant session date(s) = [YYYY-MM-DD]',
    '  Scratch: interval = <days/weeks/months> between <date A> and <date B or "Question asked on" date>',
    'Then produce a single final line that begins literally with "Answer: " followed by the answer. For non-temporal questions, skip the scratchpad and emit the Answer line directly.',
    'Be specific: exact names, numbers, dates. Be concise: the answer itself is usually one or two sentences.',
    // v8: abstention WORDING (not rule) — give the reader a format
    // that the gpt-4o judge reliably accepts as identifying the
    // question as unanswerable. Rule itself is unchanged from v5.
    'When you abstain (no excerpt contains relevant information), write the answer as: "Answer: I don\'t know — the excerpts do not mention <topic>" where <topic> names the specific thing the question asks about (e.g., "the charity race", "the adoption agency", "the necklace"). This explicit framing is required; bare "I don\'t know" is ambiguous.',
    'If the evidence is partial or indirect, give your best single answer — do not abstain just because no excerpt states the answer literally. Off-by-one day errors on intervals are acceptable; refusing to commit when the topic appears in the excerpts is not.',
    // v9: personalization rule for recommendation / advice questions.
    'For recommendation or advice questions (e.g., "any tips for...", "can you suggest...", "do you have ideas on...", "what should I do about..."), your answer MUST reference the user\'s specific context from the excerpts — their stated preferences, recent purchases, past experiments, cultural background, named items they mentioned (e.g., "turbinado sugar", "Instagram art accounts", "portable power bank", "mid-century dresser"). Begin the answer with that personal detail ("Since you\'ve been using turbinado sugar, try..."; "Building on your mid-century style..."), then give targeted advice. A generic best-practices answer that could apply to anyone is wrong even if well-written — preference questions are specifically evaluated on whether the response utilizes the user\'s personal information from the excerpts.',
  ].join(' ');
  const dateHeader = c.questionDate ? `\n\nQuestion asked on: ${c.questionDate}` : '';
  const body =
    recalled.length > 0
      ? recalled
          .map(
            (r, i) =>
              `#${i + 1} (retrieval score ${(r.retrievalScore ?? 0).toFixed(3)})\n${r.content}`,
          )
          .join('\n\n')
      : '(no relevant memories surfaced)';
  return `${header}${dateHeader}\n\n--- Retrieved Memory ---\n${body}\n--- End Memory ---`;
}

// ---------------------------------------------------------------------------
// Base-memory path helpers
// ---------------------------------------------------------------------------

function buildBaseMemoryPrompt(c: BenchCase, recalled: ScoredTrace[]): string {
  const header = [
    'You answer questions about a user based on retrieved memory excerpts from past conversations.',
    'The excerpts are sorted by retrieval relevance. Extract the single best answer supported by the excerpts — be specific with names, numbers, and dates.',
    'Only say "I don\'t know" when no excerpt is relevant to the question at all.',
  ].join(' ');
  const dateHeader = c.questionDate ? `\n\n[Question asked on ${c.questionDate}]` : '';
  const body =
    recalled.length > 0
      ? recalled
          .map((r, i) => `#${i + 1} (score ${r.score.toFixed(3)})\n${r.trace.content}`)
          .join('\n\n')
      : '(no relevant memories surfaced)';
  return `${header}${dateHeader}\n\n--- Retrieved Memory ---\n${body}\n--- End Memory ---`;
}
