/**
 * @file Beam.ts
 * @description BEAM benchmark adapter (Beyond a Million Tokens, ICLR 2026).
 *
 * BEAM measures memory-recall on conversation histories sized 100K–10M
 * tokens. The benchmark publishes per-tier datasets at
 * github.com/vectorize-io/agent-memory-benchmark and the HuggingFace
 * mirror at huggingface.co/datasets/Mohammadta/BEAM. AgentOS-bench
 * ships v1 with the **100K tier** (170 documents, 400 queries spread
 * across 10 question categories × 40 queries each).
 *
 * Adapter shape mirrors {@link Locomo}:
 *   1. Load all cases via {@link loadBeamDataset}.
 *   2. Per case: replay the user's documents into the chosen memory
 *      mode using the same {@link runFullCognitiveCase} pipeline as
 *      LongMemEval.
 *   3. Invoke reader, return answer.
 *   4. Judge via the existing rubric library, remapping BEAM's 10
 *      categories to LongMemEval's six for the judge prompt.
 *
 * The 500K / 1M / 10M tiers are wired with the same adapter shape but
 * gated on the user downloading the upstream files locally — those
 * tiers exceed local hardware memory budgets and are queued for
 * remote-machine execution.
 *
 * @module agentos-bench/benchmarks/beam/Beam
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Memory } from '@framers/agentos';
import type { MemoryRetrievalPolicy } from '@framers/agentos';
import type {
  BenchCase,
  BenchContext,
  BenchResult,
  CaseResult,
  CaseRun,
  IBenchmark,
} from '../../core/IBenchmark.js';
import { buildHaystackContext, replayViaIngest } from '../../core/ConversationReplay.js';
import { percentile, stdDev } from '../../core/statsUtil.js';
import type { IReader } from '../../readers/IReader.js';
import { runFullCognitiveCase } from '../longmemeval/LongMemEvalS.js';
import { loadBeamDataset, type BeamTier } from './dataset.js';
import type { IEmbeddingManager } from '@framers/agentos/core/embeddings/IEmbeddingManager';

/** Options for constructing a BEAM adapter. */
export interface BeamAdapterOptions {
  reader: IReader;
  tier: BeamTier;
  /** How many recalled traces the reader sees. Default 10. */
  recallTopK?: number;
  /** Reader answer-token cap. Default 256. */
  maxAnswerTokens?: number;
  /** Optional embedder for full-cognitive ingest. */
  embedder?: IEmbeddingManager;
  /** Optional session summarizer (Anthropic Sep 2024 contextual retrieval). */
  sessionSummarizer?: import('@framers/agentos/memory').SessionSummarizer;
  /** Optional summary store for hierarchical retrieval. */
  sessionSummaryStore?: import('@framers/agentos/memory').SessionSummaryStore;
  /** Stage-1 K (default 5). */
  sessionRetrievalTopSessions?: number;
  /** Stage-2 chunks-per-session (default 3). */
  sessionRetrievalChunksPerSession?: number;
  /** Step-3: enable hybrid BM25 + dense RRF retrieval. */
  hybridRetrievalEnabled?: boolean;
  /** Step-4: enable HyDE. */
  hydeEnabled?: boolean;
  /** Step-5: enable FactSupersession. */
  factSupersessionEnabled?: boolean;
  /** Step-6: split-on-ambiguous threshold. */
  splitAmbiguousThreshold?: number;
  /** Step-7 (Tier 2): observer/reflector. */
  observerReflectorEnabled?: boolean;
  /** Step-8 observer-reflector REPLACE mode. */
  observerReflectorReplaceEnabled?: boolean;
  /** Step-9 fact-graph ingest. */
  factGraphIngestEnabled?: boolean;
  /** Step-13 graph activation. */
  graphActivationEnabled?: boolean;
}

/**
 * BEAM adapter. The `id` is `beam-<tier>` (e.g. `beam-100k`); all four
 * tier subclasses share this implementation and differ only in the
 * dataset they load.
 */
export class Beam implements IBenchmark {
  readonly id: string;
  readonly version = '1.0.0';
  readonly family = 'external' as const;
  readonly passThreshold = 0.5;

  constructor(private readonly opts: BeamAdapterOptions) {
    this.id = `beam-${opts.tier}`;
  }

  async setup(_ctx: BenchContext): Promise<void> {
    // No-op; dataset is loaded lazily in `loadTestCases`.
  }

  async loadTestCases(ctx: BenchContext): Promise<BenchCase[]> {
    const allCases = await loadBeamDataset(ctx.dataDir, this.opts.tier);
    const perType = ctx.config.samplePerType;
    if (ctx.config.stratified && typeof perType === 'number' && perType > 0) {
      const groups = new Map<string, BenchCase[]>();
      for (const c of allCases) {
        const g = groups.get(c.type) ?? [];
        if (g.length < perType) g.push(c);
        groups.set(c.type, g);
      }
      return Array.from(groups.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([, cases]) => cases);
    }
    return allCases;
  }

  async runCase(c: BenchCase, ctx: BenchContext): Promise<CaseRun> {
    const start = Date.now();
    const mode = ctx.config.memoryMode;
    const retrievalPolicy = buildBenchRetrievalPolicy(ctx);
    let system: string;
    const runMeta: Record<string, unknown> = {
      memoryMode: mode,
      replayMode: ctx.config.replayMode,
      caseType: c.type,
      conversationId: c.metadata?.conversationId,
      goldDocumentIds: c.metadata?.goldDocumentIds,
      beamTier: this.opts.tier,
    };

    if (mode === 'none') {
      system = buildNoMemorySystemPrompt(c, { noAbstention: ctx.config.noAbstention });
    } else if (mode === 'base-memory') {
      const effectiveRecallTopK = ctx.config.readerTopK ?? this.opts.recallTopK ?? 10;
      const { prompt, replayStats, recallCount } = await runBaseMemoryCase(
        c,
        ctx,
        effectiveRecallTopK,
        retrievalPolicy,
      );
      system = prompt;
      runMeta.replayStats = replayStats;
      runMeta.recalledTraces = recallCount;
    } else {
      // full-cognitive — reuse LongMemEvalS's shared pipeline for parity.
      const effectiveRecallTopK = ctx.config.readerTopK ?? this.opts.recallTopK ?? 10;
      const out = await runFullCognitiveCase(
        c,
        ctx,
        effectiveRecallTopK,
        this.id,
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
        this.opts.observerReflectorReplaceEnabled,
        this.opts.factGraphIngestEnabled,
        this.opts.graphActivationEnabled,
      );
      system = out.prompt;
      runMeta.replayStats = out.replayStats;
      runMeta.recalledTraces = out.recallCount;
      runMeta.workingMemorySlots = out.workingMemorySlots;
      runMeta.observationsEmitted = out.observationsEmitted;
      runMeta.retrievedEvidence = out.retrievedEvidence;
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
      metadata: runMeta,
    };
  }

  async scoreCase(c: BenchCase, run: CaseRun, ctx: BenchContext): Promise<CaseResult> {
    const judgment = await ctx.cache.memoize(
      'judge',
      () =>
        ctx.judge.judge({
          benchmarkId: this.id,
          caseId: c.id,
          caseType: remapBeamCategoryToRubric(c.type),
          question: c.question,
          actual: run.actualOutput,
          expected: c.expected,
          hints: {
            abstention: c.type === 'abstention',
            acceptableAnswers: c.acceptableAnswers,
          },
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

    return {
      ...run,
      score: judgment.score,
      passed: judgment.correct,
      scoreMetadata: {
        judgeModel: judgment.judgeModel,
        rubricVersion: judgment.rubricVersion,
        reasoning: judgment.reasoning,
      },
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
      byType[type] = { n: g.n, accuracy: g.passed / g.n, avgScore: g.score / g.n };
    }

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
      avgLatencyMs:
        latencies.reduce((s, v) => s + v, 0) / Math.max(1, latencies.length),
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      totalReaderTokens:
        ctx.costTracker.byCategory.reader.totalTokensIn +
        ctx.costTracker.byCategory.reader.totalTokensOut,
      totalUsd: ctx.costTracker.totals.totalUsd,
      costPerCorrect: passed > 0 ? ctx.costTracker.totals.totalUsd / passed : 0,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      cases: results,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map BEAM's 10 categories to the LongMemEval rubric names the judge
 * prompt understands. BEAM is richer (abstention, contradiction
 * resolution, summarization, etc.) but the underlying judge primitives
 * are LongMemEval-shaped, so a mapping keeps the rubric library
 * single-sourced. Routes:
 *
 *   - `abstention` → `abstention` (LongMemEval handles this through
 *     the adversarial branch)
 *   - `contradiction_resolution` → `knowledge-update` (latest-fact-wins
 *     semantics line up)
 *   - `event_ordering` / `temporal_reasoning` → `temporal-reasoning`
 *   - `information_extraction` → `single-session-user`
 *   - `instruction_following` → `single-session-assistant`
 *   - `knowledge_update` → `knowledge-update`
 *   - `multi_session_reasoning` / `summarization` → `multi-session`
 *   - `preference_following` → `single-session-preference`
 */
export function remapBeamCategoryToRubric(beamType: string): string {
  switch (beamType) {
    case 'abstention':
      return 'abstention';
    case 'contradiction_resolution':
    case 'knowledge_update':
      return 'knowledge-update';
    case 'event_ordering':
    case 'temporal_reasoning':
      return 'temporal-reasoning';
    case 'information_extraction':
      return 'single-session-user';
    case 'instruction_following':
      return 'single-session-assistant';
    case 'multi_session_reasoning':
    case 'summarization':
      return 'multi-session';
    case 'preference_following':
      return 'single-session-preference';
    default:
      return 'multi-session';
  }
}

/**
 * Build a retrieval policy for BEAM. Mirrors LOCOMO's pattern (balanced
 * profile, adaptive recall) so the two long-context external benchmarks
 * exercise the same retrieval-engine defaults.
 */
function buildBenchRetrievalPolicy(ctx: BenchContext): MemoryRetrievalPolicy {
  return {
    profile: ctx.config.retrievalProfile ?? 'balanced',
    adaptive: ctx.config.adaptiveRetrieval ?? true,
  };
}

/**
 * Build a no-memory system prompt that dumps the haystack verbatim into
 * the reader context. Mirrors the Locomo / LongMemEval pattern.
 */
function buildNoMemorySystemPrompt(
  c: BenchCase,
  opts?: { noAbstention?: boolean },
): string {
  const haystack = buildHaystackContext(c.haystack);
  const abstentionLine = opts?.noAbstention
    ? 'Every question has an answer somewhere in the conversations above. Commit to your best-effort answer.'
    : "If the conversation history does not contain enough information to answer, reply with 'I don't know.'";
  return `You are an assistant answering questions about a long-running conversation history.

${haystack}

${abstentionLine}

Answer concisely.`;
}

/**
 * Replay haystack into a base-memory store, recall top-K, and build a
 * reader system prompt with the recalled traces interleaved.
 */
async function runBaseMemoryCase(
  c: BenchCase,
  ctx: BenchContext,
  recallTopK: number,
  retrievalPolicy: MemoryRetrievalPolicy,
): Promise<{
  prompt: string;
  replayStats: { sessionsReplayed: number; turnsReplayed: number; durationMs: number };
  recallCount: number;
}> {
  const brainPath = path.join(
    ctx.scratchDir,
    `beam-base-${c.id.replace(/[^a-zA-Z0-9-_]/g, '_')}.sqlite`,
  );
  await fs.mkdir(ctx.scratchDir, { recursive: true });
  const memory = await Memory.createSqlite({ path: brainPath, selfImprove: false });
  try {
    const replayStats = await replayViaIngest(c.haystack, memory);
    const recall = await memory.recall(c.question, {
      limit: recallTopK,
      policy: retrievalPolicy,
    });
    const prompt = `You are answering a question about a long-running conversation. Use ONLY the recalled snippets below to answer.

Recalled (${recall.length} snippets):
${recall.map((t, i) => `${i + 1}. ${t.trace.content}`).join('\n')}

Answer concisely.`;
    return {
      prompt,
      replayStats: {
        sessionsReplayed: replayStats.sessionsReplayed,
        turnsReplayed: replayStats.turnsReplayed,
        durationMs: replayStats.durationMs,
      },
      recallCount: recall.length,
    };
  } finally {
    await memory.close().catch(() => {});
    await fs.rm(brainPath, { force: true }).catch(() => {});
  }
}
