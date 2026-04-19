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
      const { prompt, replayStats, recallCount } = await runBaseMemoryCase(
        c,
        ctx,
        this.opts.recallTopK ?? 10,
        retrievalPolicy,
      );
      system = prompt;
      runMetadata.replayStats = replayStats;
      runMetadata.recalledTraces = recallCount;
      runMetadata.retrievalPolicy = retrievalPolicy;
    } else {
      // full-cognitive — real CognitiveMemoryManager, optional observer/
      // reflector pipeline depending on replayMode.
      const out = await runFullCognitiveCase(
        c,
        ctx,
        this.opts.recallTopK ?? 10,
        'longmemeval-s',
        retrievalPolicy,
        this.opts.embedder,
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
): Promise<FullCognitiveOutput> {
  const brainPath = path.join(
    ctx.scratchDir,
    `${adapterId}-cog-${c.id.replace(/[^a-zA-Z0-9-_]/g, '_')}.sqlite`,
  );
  const handle = await createCognitiveManager({
    brainPath,
    embedder,
    disableMechanism: ctx.config.ablateMechanism,
  });
  try {
    const replayStats = await replayForCognitive(c, handle, ctx.config.replayMode);

    // Build a per-call weight override when --ablate-signal is set.
    // Undefined → agentos uses DEFAULT_SCORING_WEIGHTS.
    const scoringWeights = ctx.config.ablateSignal
      ? { [ctx.config.ablateSignal]: 0 }
      : undefined;

    const retrieval = await handle.manager.retrieve(
      c.question,
      { valence: 0, arousal: 0, dominance: 0 },
      {
        topK: recallTopK,
        neutralMood: true,
        policy: retrievalPolicy,
        scoringWeights,
      },
    );
    const wmSlots = handle.manager.getWorkingMemory?.().getSlotCount?.() ?? 0;

    // Drop low-relevance chunks before they reach the reader. Retrieval
    // often returns 10 chunks even when only the top 3-5 are meaningfully
    // related to the question, and the tail dilutes the reader's
    // attention on the actual hero memory. Threshold is conservative
    // (0.2) — retrieved items with a composite score below this are
    // consistently off-topic in the pilot CSVs.
    const filtered = retrieval.retrieved.filter(
      (t) => (t.retrievalScore ?? 0) >= RETRIEVAL_SCORE_MIN,
    );
    // Always include at least the top result so the reader has something
    // to work with even on questions where every chunk scored poorly.
    const reader_chunks =
      filtered.length > 0 ? filtered : retrieval.retrieved.slice(0, 1);

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
const RETRIEVAL_SCORE_MIN = 0.2;

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
): Promise<{
  sessionsReplayed: number;
  turnsReplayed: number;
  durationMs: number;
  observationsEmitted: number;
  /** Per-call encode wall time (ms). One entry per successful encode. */
  encodeMsSamples: number[];
  /** Max working-memory slot count sampled during replay. */
  peakWorkingMemorySlots: number;
}> {
  const start = Date.now();
  const neutralMood = { valence: 0, arousal: 0, dominance: 0 };
  let turns = 0;
  let encodeCalls = 0;
  const encodeMsSamples: number[] = [];
  let peakWorkingMemorySlots = 0;

  const sampleSlots = (): void => {
    const slots = handle.manager.getWorkingMemory?.().getSlotCount?.() ?? 0;
    if (slots > peakWorkingMemorySlots) peakWorkingMemorySlots = slots;
  };

  const timedEncode = async (
    content: string,
    tags: string[],
  ): Promise<void> => {
    const t0 = Date.now();
    await handle.manager.encode(content, neutralMood, '', {
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
  };

  if (mode === 'observe') {
    for (const session of c.haystack) {
      const sessionTag = `${BENCH_SESSION_TAG_PREFIX}${session.sessionId}`;
      for (const turn of session.turns) {
        turns += 1;
        if (!turn.content.trim()) continue;
        const full = `${turn.role}: ${turn.content}`;
        for (const piece of splitForEmbedding(full)) {
          await timedEncode(piece, [sessionTag]);
        }
      }
    }
  } else {
    for (const session of c.haystack) {
      const sessionTag = `${BENCH_SESSION_TAG_PREFIX}${session.sessionId}`;
      const chunks = chunkSessionTurns(session.turns);
      turns += session.turns.length;
      for (const chunk of chunks) {
        if (!chunk.trim()) continue;
        // Prefix each chunk with its session date so temporal-reasoning
        // questions ("how many days between X and Y") have the answer in
        // the chunk text itself, not just the dropped-out metadata.
        const dated = session.date ? `[${session.date}] ${chunk}` : chunk;
        for (const piece of splitForEmbedding(dated)) {
          await timedEncode(piece, [sessionTag]);
        }
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
  // Reader prompt tuning (v4 — balanced across temporal + knowledge-update):
  //
  // v3 fixed temporal (25% → 75%) but regressed knowledge-update
  // (75% → 25%) because the reader started listing both old and new
  // values for updated facts instead of picking the latest. Multi-
  // session also dipped. v4 keeps the temporal-inference guidance,
  // adds a "latest-wins" rule for contradicting facts, and shortens
  // the whole thing so the model isn't over-instructed.
  const header = [
    'Answer the user question from the retrieved conversation excerpts.',
    'Every excerpt is prefixed with [YYYY-MM-DD] — the session date. Use these as the source of truth for dates (ordering, time gaps, "how long ago", "which came first").',
    'If facts conflict across excerpts (someone\'s job, a target weight, an approved amount), prefer the most recent [YYYY-MM-DD]. Earlier contradicting info is superseded.',
    'Be specific: exact names, numbers, dates when you have them. Be concise: one or two sentences is usually right.',
    'Only answer "I don\'t know" when no excerpt contains relevant information. If the evidence is partial or indirect, give your best single answer — don\'t abstain just because no excerpt states the answer literally.',
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
