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

import type {
  BenchCase,
  BenchContext,
  BenchResult,
  CaseResult,
  CaseRun,
  IBenchmark,
} from '../../core/IBenchmark.js';
import { buildHaystackContext } from '../../core/ConversationReplay.js';
import { percentile, stdDev } from '../../core/statsUtil.js';
import type { IReader } from '../../readers/IReader.js';
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

    if (mode !== 'none') {
      // Memory-backed modes are scheduled for the v2 implementation step.
      // Surfacing the limitation as a case-level error preserves the rest
      // of the run rather than aborting the benchmark.
      throw new Error(
        `LongMemEvalS: memoryMode '${mode}' not yet implemented — run with memoryMode='none' ` +
          `for the haystack-in-context baseline. v2 will wire Memory / CognitiveMemoryManager.`,
      );
    }

    const system = buildNoMemorySystemPrompt(c);
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
      metadata: {
        memoryMode: mode,
        replayMode: ctx.config.replayMode,
        caseType: c.type,
      },
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
