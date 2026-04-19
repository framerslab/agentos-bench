/**
 * @file estimateRunCost.ts
 * @description Coarse USD cost preflight for a benchmark run.
 *
 * Purpose: prevent the "oh no I ran LongMemEval-S × Opus 4.7 × 500
 * cases by mistake" class of accident. The estimator is deliberately
 * rough — within a factor of 2 of actual spend on the headline
 * configurations — so it can be computed offline before any real
 * LLM call is issued.
 *
 * Heuristics
 * ----------
 * - Haystack size is dominant. For memoryMode=none the reader sees
 *   the full haystack (~115k tokens for LongMemEval-S, much larger for
 *   BEAM tiers). For memory-backed modes the reader sees a small
 *   retrieved-memory context (~4k tokens).
 * - Output is always short (~100 tokens).
 * - External benchmarks add one judge call per case (~1k tokens in,
 *   8 tokens out).
 * - Micro-benchmarks never call an LLM — cost is exactly $0.
 *
 * When the estimator encounters an unknown model it emits a warning
 * and falls back to Sonnet 4.6 pricing rather than throwing — the
 * preflight should inform, not block, on edge cases.
 *
 * @module agentos-bench/core/estimateRunCost
 */

import type { BenchmarkFamily, MemoryMode, ReaderModel } from './IBenchmark.js';
import { MODEL_PRICES } from './CostTracker.js';

/**
 * Input for a cost estimate.
 */
export interface EstimateRunCostInput {
  /** Benchmark identifier — only affects the haystack-size bucket. */
  benchmarkId: string;
  family: BenchmarkFamily;
  /** Total cases in the loaded dataset. */
  caseCount: number;
  /** Optional sample cap (used by `--sample N`). */
  sampleN?: number;
  /** Reader model to be used. Unknown models fall back to Sonnet pricing. */
  reader: ReaderModel | string;
  /** Judge model. Ignored for micro-benchmarks. */
  judgeModel: ReaderModel | string;
  /** Memory mode — drives the reader's input token estimate. */
  memoryMode: MemoryMode;
}

/**
 * Output of a cost estimate.
 */
export interface CostEstimate {
  /** Sum of reader + judge costs. USD. */
  totalUsd: number;
  /** Per-case reader cost (reader input + output tokens × price). */
  readerUsdPerCase: number;
  /** Per-case judge cost. 0 for micro-benchmarks. */
  judgeUsdPerCase: number;
  /** Effective case count after applying sampleN. */
  effectiveCaseCount: number;
  /** Reader + judge token totals summed across the run. */
  totalTokensIn: number;
  totalTokensOut: number;
  /** Human-readable explanation of the estimate. */
  reasoning: string;
  /** Non-fatal caveats (unknown model, unknown benchmark, etc.). */
  warnings: string[];
}

/**
 * Approximate haystack sizes per benchmark. `none` memory mode pays
 * the full haystack; memory-backed modes pay the retrieved-context
 * budget ({@link RETRIEVED_CONTEXT_TOKENS}).
 */
const HAYSTACK_TOKENS: Record<string, number> = {
  'longmemeval-s': 115_000,
  'longmemeval-m': 500_000,
  'longmemeval-oracle': 8_000,
  locomo: 9_000 * 1, // per sample; actual is ~9k tokens avg per conversation
  'beam-500k': 500_000,
  'beam-1m': 1_000_000,
  'beam-10m': 10_000_000,
};
const DEFAULT_HAYSTACK_TOKENS = 50_000; // unknown benchmark → middle-ish fallback

/** Reader output per case — answers are short. */
const OUTPUT_TOKENS_PER_CASE = 100;
/** Retrieved-memory context budget when a memory layer is active. */
const RETRIEVED_CONTEXT_TOKENS = 4_000;
/** Judge call shape. */
const JUDGE_INPUT_TOKENS_PER_CASE = 1_000;
const JUDGE_OUTPUT_TOKENS_PER_CASE = 8;

/**
 * Produce a cost estimate for a run. Never throws — unknown models
 * yield warnings and Sonnet-priced fallback.
 */
export function estimateRunCost(input: EstimateRunCostInput): CostEstimate {
  const warnings: string[] = [];

  if (input.family === 'micro') {
    return {
      totalUsd: 0,
      readerUsdPerCase: 0,
      judgeUsdPerCase: 0,
      effectiveCaseCount: effectiveCount(input),
      totalTokensIn: 0,
      totalTokensOut: 0,
      reasoning: 'Micro-benchmarks execute synthetic assertions with no LLM calls.',
      warnings,
    };
  }

  const readerPrice = resolvePrice(input.reader, warnings, 'reader');
  const judgePrice = resolvePrice(input.judgeModel, warnings, 'judge');

  const haystackTokens = HAYSTACK_TOKENS[input.benchmarkId] ?? DEFAULT_HAYSTACK_TOKENS;
  if (!(input.benchmarkId in HAYSTACK_TOKENS)) {
    warnings.push(
      `Unknown benchmark '${input.benchmarkId}' — using ${DEFAULT_HAYSTACK_TOKENS} tokens as a haystack fallback.`,
    );
  }

  const readerInputPerCase =
    input.memoryMode === 'none' ? haystackTokens : RETRIEVED_CONTEXT_TOKENS;
  const readerOutputPerCase = OUTPUT_TOKENS_PER_CASE;

  const readerUsdPerCase =
    (readerInputPerCase / 1000) * readerPrice.promptPer1k +
    (readerOutputPerCase / 1000) * readerPrice.completionPer1k;

  const judgeUsdPerCase =
    (JUDGE_INPUT_TOKENS_PER_CASE / 1000) * judgePrice.promptPer1k +
    (JUDGE_OUTPUT_TOKENS_PER_CASE / 1000) * judgePrice.completionPer1k;

  const n = effectiveCount(input);
  const totalUsd = (readerUsdPerCase + judgeUsdPerCase) * n;
  const totalTokensIn =
    (readerInputPerCase + JUDGE_INPUT_TOKENS_PER_CASE) * n;
  const totalTokensOut =
    (readerOutputPerCase + JUDGE_OUTPUT_TOKENS_PER_CASE) * n;

  const reasoning =
    `Estimated ${readerInputPerCase.toLocaleString()} input + ${readerOutputPerCase} output ` +
    `reader tokens per case (${input.memoryMode} mode) × ${n} cases + ` +
    `${JUDGE_INPUT_TOKENS_PER_CASE} judge tokens per case. ` +
    `Unit prices: ${input.reader} = $${readerPrice.promptPer1k}/1k prompt / $${readerPrice.completionPer1k}/1k completion.`;

  return {
    totalUsd,
    readerUsdPerCase,
    judgeUsdPerCase,
    effectiveCaseCount: n,
    totalTokensIn,
    totalTokensOut,
    reasoning,
    warnings,
  };
}

function effectiveCount(input: EstimateRunCostInput): number {
  if (typeof input.sampleN === 'number' && input.sampleN >= 0) {
    return Math.min(input.sampleN, input.caseCount);
  }
  return input.caseCount;
}

function resolvePrice(
  model: string,
  warnings: string[],
  label: string,
): { promptPer1k: number; completionPer1k: number } {
  const price = MODEL_PRICES[model];
  if (price) return price;
  warnings.push(
    `No price entry for ${label} model '${model}'. Falling back to claude-sonnet-4-6 pricing for the estimate.`,
  );
  return MODEL_PRICES['claude-sonnet-4-6']!;
}
