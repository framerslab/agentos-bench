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

export interface LocomoAdapterOptions {
  reader: IReader;
  /** How many recalled memory traces to fold into the reader prompt. */
  recallTopK?: number;
  /** Maximum reader answer tokens. Defaults to 256. */
  maxAnswerTokens?: number;
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
    return loadLocomoDataset(ctx.dataDir);
  }

  async runCase(c: BenchCase, ctx: BenchContext): Promise<CaseRun> {
    const start = Date.now();
    const mode = ctx.config.memoryMode;
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
      const { prompt, replayStats, recallCount } = await runBaseMemoryCase(
        c,
        ctx,
        this.opts.recallTopK ?? 10,
      );
      system = prompt;
      runMeta.replayStats = replayStats;
      runMeta.recalledTraces = recallCount;
    } else {
      // full-cognitive — reuse LongMemEvalS's shared pipeline so both
      // adapters exercise the same CognitiveMemoryManager wiring.
      const out = await runFullCognitiveCase(
        c,
        ctx,
        this.opts.recallTopK ?? 10,
        'locomo',
      );
      system = out.prompt;
      runMeta.replayStats = out.replayStats;
      runMeta.recalledTraces = out.recallCount;
      runMeta.workingMemorySlots = out.workingMemorySlots;
      runMeta.observationsEmitted = out.observationsEmitted;
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
): Promise<BaseMemoryOutput> {
  const brainPath = path.join(
    ctx.scratchDir,
    `locomo-${c.id.replace(/[^a-zA-Z0-9-_]/g, '_')}.sqlite`,
  );
  const mem = await Memory.create({ path: brainPath, selfImprove: false });
  try {
    const replayStats = await replayViaIngest(c.haystack, mem);
    const recalled = await mem.recall(c.question, { limit: recallTopK });
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
