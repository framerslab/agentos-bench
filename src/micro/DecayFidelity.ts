/**
 * @file DecayFidelity.ts
 * @description Micro-benchmark asserting AgentOS's Ebbinghaus decay
 * implementation matches the theoretical formula.
 *
 * Foundation: the Ebbinghaus forgetting curve models memory strength
 * decay as
 *
 *   S(t) = S₀ · e^(-Δt / stability)
 *
 * The cognitive memory system applies this in
 * `computeCurrentStrength(trace, now)`. This bench seeds a synthetic
 * trace with known `S₀` and `stability`, then checks that the returned
 * strength at t = {1d, 5d, 10d, 30d, 60d} matches the formula within a
 * tolerance of ±2%.
 *
 * A regression in this benchmark means a bug in the decay math, which
 * invalidates every retrieval scoring signal downstream (the 6-signal
 * composite uses current strength as its first factor).
 *
 * @module agentos-bench/micro/DecayFidelity
 */

import { computeCurrentStrength } from '@framers/agentos';
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

const DAY_MS = 24 * 60 * 60 * 1000;
/** Elapsed times (days) at which we probe the decay curve. */
const PROBE_DAYS = [1, 5, 10, 30, 60] as const;
/** Per-probe stability (days). Chosen to produce meaningful decay across the range. */
const STABILITY_DAYS = 10;
/** Acceptable relative error between measured and theoretical strength. */
const TOLERANCE = 0.02;

/**
 * DecayFidelity — asserts computeCurrentStrength matches S₀ · e^(-Δt / stability)
 * within {@link TOLERANCE} at every probe point.
 */
export class DecayFidelity implements IBenchmark {
  readonly id = 'decay-fidelity';
  readonly version = '1.0.0';
  readonly family = 'micro' as const;
  readonly passThreshold = 1.0;

  async setup(_ctx: BenchContext): Promise<void> {
    // Fully synthetic — no dataset to download.
  }

  async loadTestCases(_ctx: BenchContext): Promise<BenchCase[]> {
    return PROBE_DAYS.map((days) => ({
      id: `decay-fidelity-${days}d`,
      type: 'assertion',
      question: `After ${days} days, measured strength should match S₀·e^(-${days}/${STABILITY_DAYS}).`,
      haystack: [],
      expected: (Math.exp(-days / STABILITY_DAYS)).toFixed(6),
      metadata: { probeDays: days, stabilityDays: STABILITY_DAYS },
    }));
  }

  async runCase(c: BenchCase, _ctx: BenchContext): Promise<CaseRun> {
    const start = Date.now();
    const probeDays = c.metadata?.probeDays as number;
    const stabilityDays = c.metadata?.stabilityDays as number;

    const now = Date.now();
    const trace = buildSyntheticTrace({
      encodingStrength: 1.0,
      stabilityMs: stabilityDays * DAY_MS,
      lastAccessedAt: now - probeDays * DAY_MS,
      createdAt: now - probeDays * DAY_MS,
    });

    const measured = computeCurrentStrength(trace, now);
    const theoretical = Math.exp(-probeDays / stabilityDays);
    const relativeError = Math.abs(measured - theoretical) / theoretical;

    return {
      caseId: c.id,
      actualOutput: measured.toFixed(6),
      latencyMs: Date.now() - start,
      tokensIn: 0,
      tokensOut: 0,
      usd: 0,
      metadata: {
        probeDays,
        measured,
        theoretical,
        relativeError,
        tolerance: TOLERANCE,
      },
    };
  }

  async scoreCase(c: BenchCase, run: CaseRun, _ctx: BenchContext): Promise<CaseResult> {
    const relErr = (run.metadata?.relativeError ?? Number.POSITIVE_INFINITY) as number;
    const passed = relErr <= TOLERANCE;
    return {
      ...run,
      score: passed ? 1 : 0,
      passed,
      scoreMetadata: {
        relativeError: relErr,
        tolerance: TOLERANCE,
        note: passed
          ? 'Within tolerance.'
          : `Relative error ${relErr.toFixed(4)} exceeds tolerance ${TOLERANCE}.`,
      },
    };
  }

  aggregate(results: CaseResult[], ctx: BenchContext): BenchResult {
    const scores = results.map((r) => r.score);
    const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const passed = results.filter((r) => r.passed).length;
    const avgScore = scores.reduce((s, v) => s + v, 0) / Math.max(1, scores.length);

    const byType: Record<string, { n: number; accuracy: number; avgScore: number }> = {
      assertion: {
        n: results.length,
        accuracy: passed / Math.max(1, results.length),
        avgScore,
      },
    };

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
// Helpers
// ---------------------------------------------------------------------------

interface SyntheticTraceInit {
  encodingStrength: number;
  stabilityMs: number;
  lastAccessedAt: number;
  createdAt: number;
}

/**
 * Build a minimal-but-valid {@link MemoryTrace} suitable for decay
 * experiments. Only the fields consumed by `computeCurrentStrength`
 * carry meaning; the rest are filled with defensible defaults.
 */
export function buildSyntheticTrace(init: SyntheticTraceInit): MemoryTrace {
  return {
    id: `synthetic-${init.createdAt}`,
    type: 'episodic',
    scope: 'user',
    scopeId: 'bench',
    content: 'decay-fidelity synthetic trace',
    entities: [],
    tags: [],
    provenance: {
      sourceType: 'observation',
      sourceTimestamp: init.createdAt,
      confidence: 1,
      verificationCount: 0,
    },
    emotionalContext: {
      valence: 0,
      arousal: 0,
      dominance: 0,
      intensity: 0,
      gmiMood: 'neutral',
    },
    encodingStrength: init.encodingStrength,
    stability: init.stabilityMs,
    retrievalCount: 0,
    lastAccessedAt: init.lastAccessedAt,
    accessCount: 0,
    reinforcementInterval: 0,
    associatedTraceIds: [],
    createdAt: init.createdAt,
    updatedAt: init.createdAt,
    isActive: true,
  };
}
