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
import { percentile, stdDev } from '../../core/statsUtil.js';
import type { IReader } from '../../readers/IReader.js';
import { createCognitiveManager } from '../../cognitive/createCognitiveManager.js';
import { loadLongMemEvalDataset, type LongMemEvalVariant } from './dataset.js';

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
    return loadLongMemEvalDataset(ctx.dataDir, this.opts.variant);
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
      byType[type] = {
        n: g.n,
        accuracy: g.passed / g.n,
        avgScore: g.score / g.n,
      };
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
  }>;
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
  const handle = await createCognitiveManager({ brainPath, embedder });
  try {
    const replayStats = await replayForCognitive(c, handle, ctx.config.replayMode);

    const retrieval = await handle.manager.retrieve(
      c.question,
      { valence: 0, arousal: 0, dominance: 0 },
      {
        topK: recallTopK,
        neutralMood: true,
        policy: retrievalPolicy,
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
    }));

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
): Promise<{ sessionsReplayed: number; turnsReplayed: number; durationMs: number; observationsEmitted: number }> {
  const start = Date.now();
  const neutralMood = { valence: 0, arousal: 0, dominance: 0 };
  let turns = 0;
  let encodeCalls = 0;

  if (mode === 'observe') {
    for (const session of c.haystack) {
      for (const turn of session.turns) {
        turns += 1;
        if (!turn.content.trim()) continue;
        await handle.manager.encode(
          `${turn.role}: ${turn.content}`,
          neutralMood,
          '',
          { type: 'episodic', scope: 'user', scopeId: 'bench' },
        );
        encodeCalls += 1;
      }
    }
  } else {
    for (const session of c.haystack) {
      const chunks = chunkSessionTurns(session.turns);
      turns += session.turns.length;
      for (const chunk of chunks) {
        if (!chunk.trim()) continue;
        // Prefix each chunk with its session date so temporal-reasoning
        // questions ("how many days between X and Y") have the answer in
        // the chunk text itself, not just the dropped-out metadata.
        const dated = session.date
          ? `[${session.date}] ${chunk}`
          : chunk;
        await handle.manager.encode(dated, neutralMood, '', {
          type: 'episodic',
          scope: 'user',
          scopeId: 'bench',
        });
        encodeCalls += 1;
      }
    }
  }

  return {
    sessionsReplayed: c.haystack.length,
    turnsReplayed: turns,
    durationMs: Date.now() - start,
    observationsEmitted: encodeCalls,
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
  // Reader prompt tuning:
  // - The retrieved excerpts may be noisy (lexical matches, tangential
  //   topics). Previously the prompt said "If the excerpts do not
  //   contain the answer, say I don't know" which encouraged abstention
  //   even when a partial answer was present, dragging accuracy.
  // - The new framing tells the model to extract the best possible
  //   answer from the evidence, and only abstain when the evidence is
  //   genuinely silent on the question.
  // - Date-prefixed excerpts ([YYYY-MM-DD] ...) let temporal-reasoning
  //   questions compute time gaps directly from the chunk text.
  const header = [
    'You answer questions about a user based on a retrieved memory excerpts from their past conversations.',
    'The excerpts are sorted by retrieval relevance and may include unrelated content — focus on the ones that actually pertain to the question.',
    'When excerpts mention dates in [YYYY-MM-DD] prefixes, use them to reason about time gaps, ordering, and recency.',
    'Extract the single best answer supported by the excerpts. Be specific (exact names, numbers, dates when available) and concise.',
    'Only say "I don\'t know" when no excerpt is relevant to the question at all.',
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
