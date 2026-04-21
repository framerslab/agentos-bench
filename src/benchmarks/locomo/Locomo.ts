/**
 * @file Locomo.ts
 * @description LOCOMO benchmark adapter (QA task).
 *
 * Drives AgentOS memory through the LOCOMO long-term conversational
 * benchmark (Maharana et al., ACL 2024). V1 covers only the QA task —
 * event summarisation and multi-modal dialogue live in future commits.
 *
 * Pipeline mirrors {@link LongMemEvalS}:
 *
 *   1. Load all QA pairs across 10 conversations from locomo10.json.
 *   2. Per case: replay the conversation into the chosen memory mode.
 *   3. Recall top-K (base-memory) or dump full haystack (none).
 *   4. Invoke reader, return answer.
 *   5. Judge via the existing LongMemEval rubric — categories map
 *      cleanly (single-hop, multi-hop, temporal, open-domain,
 *      adversarial → abstention).
 *
 * Re-using LongMemEval's judge keeps scoring comparable across both
 * benchmarks; the rubric semantics (contains correct answer / off-by-one
 * for temporal / abstention for adversarial) line up with LOCOMO's own
 * evaluation notes.
 *
 * @module agentos-bench/benchmarks/locomo/Locomo
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Memory } from '@framers/agentos';
import type { MemoryRetrievalPolicy } from '@framers/agentos';
import type { ScoredTrace } from '@framers/agentos';
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
import { loadLocomoDataset, LOCOMO_CATEGORY_NAMES } from './dataset.js';
import type { IEmbeddingManager } from '@framers/agentos/core/embeddings/IEmbeddingManager';

export interface LocomoAdapterOptions {
  reader: IReader;
  /** How many recalled memory traces to fold into the reader prompt. */
  recallTopK?: number;
  /** Maximum reader answer tokens. Defaults to 256. */
  maxAnswerTokens?: number;
  /**
   * Optional {@link IEmbeddingManager} used in the full-cognitive path.
   * Defaults to the CharHashEmbedder stub when omitted.
   */
  embedder?: IEmbeddingManager;
  /**
   * Optional session-level contextual-retrieval summarizer
   * (`@framers/agentos/memory`). Threaded through to
   * {@link runFullCognitiveCase} so every chunk from a LOCOMO session
   * is prepended with a dense session summary before embedding.
   */
  sessionSummarizer?: import('@framers/agentos/memory').SessionSummarizer;
  /**
   * Step-2 session-level retrieval store. When set, SessionRetriever
   * replaces single-stage `manager.retrieve` in runFullCognitiveCase.
   */
  sessionSummaryStore?: import('@framers/agentos/memory').SessionSummaryStore;
  /** Step-2: Stage-1 session count (default 5). */
  sessionRetrievalTopSessions?: number;
  /** Step-2: Stage-2 chunks-per-session (default 3). */
  sessionRetrievalChunksPerSession?: number;
  /**
   * Step-3: enable hybrid BM25 + dense RRF retrieval. Mutually
   * exclusive with `sessionSummaryStore`.
   */
  hybridRetrievalEnabled?: boolean;
  /**
   * Step-4: enable HyDE. Same semantics as `LongMemEvalS.hydeEnabled`.
   */
  hydeEnabled?: boolean;
  /**
   * Step-5: enable FactSupersession. Same semantics as
   * `LongMemEvalAdapterOptions.factSupersessionEnabled`.
   */
  factSupersessionEnabled?: boolean;
  /**
   * Step-6: threshold for split-on-ambiguous rerank refinement.
   * Same semantics as `LongMemEvalAdapterOptions.splitAmbiguousThreshold`.
   */
  splitAmbiguousThreshold?: number;
  /**
   * Step-7 (Tier 2): enable Observer/Reflector. Same semantics as
   * `LongMemEvalAdapterOptions.observerReflectorEnabled`.
   */
  observerReflectorEnabled?: boolean;
  /**
   * Step-8: REPLACEMENT semantics. Same semantics as
   * `LongMemEvalAdapterOptions.observerReflectorReplaceEnabled`.
   */
  observerReflectorReplaceEnabled?: boolean;
}

/**
 * LOCOMO QA benchmark adapter.
 */
export class Locomo implements IBenchmark {
  readonly id = 'locomo';
  readonly version = '1.0.0';
  readonly family = 'external' as const;
  readonly passThreshold = 0.5;

  constructor(private readonly opts: LocomoAdapterOptions) {}

  async setup(_ctx: BenchContext): Promise<void> {}

  async loadTestCases(ctx: BenchContext): Promise<BenchCase[]> {
    const allCases = await loadLocomoDataset(ctx.dataDir);
    const perType = ctx.config.samplePerType;
    // Stratified sampling: take up to `samplePerType` cases from each
    // LOCOMO category, preserving dataset order within a type. Mirrors
    // the LongMemEvalS implementation so the two benchmarks behave
    // identically under --stratified --sample-per-type N.
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
      category: c.metadata?.category,
      conversationId: c.metadata?.conversationId,
    };

    if (mode === 'none') {
      system = buildNoMemorySystemPrompt(c);
    } else if (mode === 'base-memory') {
      // Resolution priority for K:
      //   1. ctx.config.readerTopK  (from --reader-top-k CLI flag)
      //   2. this.opts.recallTopK   (from adapter construction)
      //   3. 10                     (hardcoded fallback)
      const effectiveRecallTopK =
        ctx.config.readerTopK ?? this.opts.recallTopK ?? 10;
      const { prompt, replayStats, recallCount } = await runBaseMemoryCase(
        c,
        ctx,
        effectiveRecallTopK,
        retrievalPolicy,
      );
      system = prompt;
      runMeta.replayStats = replayStats;
      runMeta.recalledTraces = recallCount;
      runMeta.retrievalPolicy = retrievalPolicy;
    } else {
      // full-cognitive — reuse LongMemEvalS's shared pipeline so both
      // adapters exercise the same CognitiveMemoryManager wiring.
      // Resolution priority mirrors the base-memory branch above
      // (CLI flag > adapter opts > hardcoded 10).
      const effectiveRecallTopK =
        ctx.config.readerTopK ?? this.opts.recallTopK ?? 10;
      const out = await runFullCognitiveCase(
        c,
        ctx,
        effectiveRecallTopK,
        'locomo',
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
      );
      system = out.prompt;
      runMeta.replayStats = out.replayStats;
      runMeta.recalledTraces = out.recallCount;
      runMeta.workingMemorySlots = out.workingMemorySlots;
      runMeta.observationsEmitted = out.observationsEmitted;
      runMeta.retrievedEvidence = out.retrievedEvidence;
      runMeta.retrievalPolicy = retrievalPolicy;
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
          // Route adversarial (category 5) cases through the abstention rubric.
          caseType: remapCategoryToRubric(c.type),
          question: c.question,
          actual: run.actualOutput,
          expected: c.expected,
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
      avgLatencyMs: latencies.reduce((s, v) => s + v, 0) / Math.max(1, latencies.length),
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      totalReaderTokens: ctx.costTracker.byCategory.reader.totalTokensIn + ctx.costTracker.byCategory.reader.totalTokensOut,
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
 * Map LOCOMO category → LongMemEval rubric name. The judge's prompt
 * composer understands the LongMemEval names; routing through this
 * mapping keeps the rubric library single-sourced.
 */
function remapCategoryToRubric(locomoType: string): string {
  switch (locomoType) {
    case 'temporal':
      return 'temporal-reasoning';
    case 'adversarial':
      return 'abstention';
    case 'single-hop':
    case 'multi-hop':
    case 'open-domain':
    default:
      return 'multi-session';
  }
}

function buildNoMemorySystemPrompt(c: BenchCase): string {
  const haystack = c.haystack.length > 0 ? buildHaystackContext(c.haystack) : '';
  return [
    'You are being evaluated on long-term conversational memory.',
    'Answer the question using only the conversation history below.',
    'Be concise. If the history does not contain the answer, say "I don\'t know".',
    '',
    '--- Conversation History ---',
    haystack,
    '--- End History ---',
  ].join('\n');
}

interface BaseMemoryOutput {
  prompt: string;
  replayStats: { sessionsReplayed: number; turnsReplayed: number; durationMs: number };
  recallCount: number;
}

async function runBaseMemoryCase(
  c: BenchCase,
  ctx: BenchContext,
  recallTopK: number,
  retrievalPolicy: MemoryRetrievalPolicy,
): Promise<BaseMemoryOutput> {
  const brainPath = path.join(
    ctx.scratchDir,
    `locomo-${c.id.replace(/[^a-zA-Z0-9-_]/g, '_')}.sqlite`,
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

function buildBaseMemoryPrompt(c: BenchCase, recalled: ScoredTrace[]): string {
  const body =
    recalled.length > 0
      ? recalled
          .map((r, i) => `#${i + 1} (score ${r.score.toFixed(3)})\n${r.trace.content}`)
          .join('\n\n')
      : '(no relevant memories surfaced)';
  return [
    'You are being evaluated on long-term conversational memory.',
    'Use the retrieved memory excerpts below to answer the question.',
    'Be concise. If the excerpts do not contain the answer, say "I don\'t know".',
    '',
    '--- Retrieved Memory ---',
    body,
    '--- End Memory ---',
  ].join('\n');
}

/** Exported for tests — lets fixtures assert category→type mapping. */
export const LOCOMO_CATEGORY_LOOKUP = LOCOMO_CATEGORY_NAMES;

function buildBenchRetrievalPolicy(ctx: BenchContext): MemoryRetrievalPolicy {
  return {
    profile: ctx.config.retrievalProfile ?? 'balanced',
    adaptive: ctx.config.adaptiveRetrieval ?? true,
  };
}
