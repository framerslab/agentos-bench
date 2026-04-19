/**
 * @file ScalingProfile.ts
 * @description Micro-benchmark measuring retrieval scoring latency at
 * increasing memory sizes.
 *
 * The cognitive memory system claims to scale gracefully up to 1M traces,
 * with six-signal composite scoring running in linear time per candidate.
 * This benchmark populates a synthetic candidate pool at sizes 1k / 10k /
 * 100k (gated to 1M via `AGENTOS_BENCH_SCALING_FULL=true`), runs the
 * public `scoreAndRankTraces` function `SAMPLES` times per size, and
 * reports P50 / P95 latencies plus observed per-trace cost.
 *
 * Pass criterion is generous on purpose: each size must complete in under
 * its hard-cap budget (see {@link SIZE_BUDGETS_MS}). We are looking for
 * complexity blowups, not absolute wall-clock parity across hardware. A
 * regression from O(n) to O(n log n) still fits within the budget; a
 * regression to O(n²) will not.
 *
 * @module agentos-bench/micro/ScalingProfile
 */

import { scoreAndRankTraces } from '@framers/agentos';
import type { MemoryTrace } from '@framers/agentos';
import type {
  BenchCase,
  BenchContext,
  BenchResult,
  CaseResult,
  CaseRun,
  IBenchmark,
} from '../core/IBenchmark.js';
import { percentile, stdDev } from '../core/statsUtil.js';
import { buildSyntheticTrace } from './DecayFidelity.js';

/** Number of scoring iterations per size — averaged to smooth noise. */
const SAMPLES = 5;

interface SizeProbe {
  label: string;
  size: number;
  /** Hard wall-clock ceiling for one scoring pass. */
  budgetMs: number;
}

/**
 * Default size ladder. 100k is skipped unless the full env flag is set.
 *
 * Budgets are generous (10x expected median on a modern laptop): the goal
 * is to catch complexity-class regressions, not absolute wall-clock parity.
 * Concurrent test runs or busy CI hardware can slow a single pass by 2-3x
 * without indicating a real problem.
 */
const STANDARD_SIZES: SizeProbe[] = [
  { label: '1k', size: 1_000, budgetMs: 200 },
  { label: '10k', size: 10_000, budgetMs: 1_500 },
];

const FULL_SIZES: SizeProbe[] = [
  ...STANDARD_SIZES,
  { label: '100k', size: 100_000, budgetMs: 15_000 },
];

function chooseSizes(): SizeProbe[] {
  return process.env.AGENTOS_BENCH_SCALING_FULL === 'true' ? FULL_SIZES : STANDARD_SIZES;
}

/**
 * ScalingProfile — asserts retrieval scoring stays within the per-size
 * latency budget, surfaces P50/P95, and computes per-trace cost.
 */
export class ScalingProfile implements IBenchmark {
  readonly id = 'scaling-profile';
  readonly version = '1.0.0';
  readonly family = 'micro' as const;
  readonly passThreshold = 1.0;

  async setup(_ctx: BenchContext): Promise<void> {}

  async loadTestCases(_ctx: BenchContext): Promise<BenchCase[]> {
    return chooseSizes().map((probe) => ({
      id: `scaling-profile-${probe.label}`,
      type: 'scaling',
      question: `Score ${probe.size} candidates within ${probe.budgetMs}ms.`,
      haystack: [],
      expected: `complete within ${probe.budgetMs}ms`,
      metadata: { size: probe.size, budgetMs: probe.budgetMs, label: probe.label },
    }));
  }

  async runCase(c: BenchCase, _ctx: BenchContext): Promise<CaseRun> {
    const start = Date.now();
    const size = c.metadata?.size as number;
    const budgetMs = c.metadata?.budgetMs as number;

    const candidates = buildCandidates(size);
    const now = Date.now();
    const samples: number[] = [];

    for (let i = 0; i < SAMPLES; i++) {
      const s = performance.now();
      scoreAndRankTraces(candidates, {
        currentMood: { valence: 0, arousal: 0, dominance: 0 },
        now,
        neutralMood: true,
      });
      samples.push(performance.now() - s);
    }
    samples.sort((a, b) => a - b);

    const p50 = percentile(samples, 50);
    const p95 = percentile(samples, 95);
    const perTraceUs = (p50 * 1_000) / size; // microseconds per trace at median

    return {
      caseId: c.id,
      actualOutput: `p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms`,
      latencyMs: Date.now() - start,
      tokensIn: 0,
      tokensOut: 0,
      usd: 0,
      metadata: {
        size,
        budgetMs,
        samples,
        p50Ms: p50,
        p95Ms: p95,
        perTraceUs,
      },
    };
  }

  async scoreCase(_c: BenchCase, run: CaseRun, _ctx: BenchContext): Promise<CaseResult> {
    const budgetMs = run.metadata?.budgetMs as number;
    const p95 = run.metadata?.p95Ms as number;
    const passed = p95 <= budgetMs;
    return {
      ...run,
      score: passed ? 1 : 0,
      passed,
      scoreMetadata: {
        p95Ms: p95,
        budgetMs,
        note: passed
          ? `P95 ${p95.toFixed(2)}ms under ${budgetMs}ms budget.`
          : `P95 ${p95.toFixed(2)}ms exceeds ${budgetMs}ms budget — potential complexity regression.`,
      },
    };
  }

  aggregate(results: CaseResult[], ctx: BenchContext): BenchResult {
    const scores = results.map((r) => r.score);
    const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const passed = results.filter((r) => r.passed).length;
    const avgScore = scores.reduce((s, v) => s + v, 0) / Math.max(1, scores.length);

    return {
      benchmarkId: this.id,
      benchmarkVersion: this.version,
      config: ctx.config,
      totalCases: results.length,
      passedCases: passed,
      accuracy: passed / Math.max(1, results.length),
      avgScore,
      scoreStdDev: stdDev(scores),
      byType: {
        scaling: {
          n: results.length,
          accuracy: passed / Math.max(1, results.length),
          avgScore,
        },
      },
      avgLatencyMs: latencies.reduce((s, v) => s + v, 0) / Math.max(1, latencies.length),
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      totalReaderTokens: 0,
      totalUsd: 0,
      costPerCorrect: 0,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      cases: results,
    };
  }
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

function buildCandidates(size: number): Array<{ trace: MemoryTrace; vectorSimilarity: number }> {
  const now = Date.now();
  const stabilityMs = 30 * 24 * 60 * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;
  return Array.from({ length: size }, (_, i) => ({
    trace: buildSyntheticTrace({
      encodingStrength: 0.2 + ((i * 37) % 80) / 100, // deterministic in [0.2, 1.0)
      stabilityMs,
      // Spread access times across the last 30 days to exercise recency scoring.
      lastAccessedAt: now - ((i * 13) % 30) * dayMs,
      createdAt: now - 60 * dayMs + i,
    }),
    vectorSimilarity: ((i * 101) % 100) / 100,
  }));
}
