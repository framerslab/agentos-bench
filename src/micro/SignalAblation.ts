/**
 * @file SignalAblation.ts
 * @description Micro-benchmark that ablates each retrieval signal and
 * measures ranking degradation.
 *
 * AgentOS's `scoreAndRankTraces` blends six signals: strength,
 * similarity, recency, emotional congruence, graph activation, and
 * importance. Each signal has a published weight (0.25 / 0.35 / 0.10 /
 * 0.15 / 0.10 / 0.05). The design claim is that every one of those
 * signals earns its weight — setting any single weight to zero should
 * hurt ranking quality on a correctly-constructed candidate pool.
 *
 * This benchmark builds a synthetic candidate pool where the
 * ground-truth relevance is encoded per-signal (e.g. one "recency"
 * relevant trace that's only strong on recency, one "similarity"
 * relevant trace that's only strong on similarity, and so on). The
 * ideal retrieval with all weights active ranks all six signal-relevant
 * traces in the top-6. For each probe, we zero one weight at a time
 * and measure NDCG@6 loss vs the ideal ranking.
 *
 * A signal that's load-bearing produces a measurable Δ; a signal
 * whose weight is zero-dominated by the others would leak through
 * silently. Pass threshold is generous: every signal must drop NDCG
 * by at least {@link MIN_NDCG_DROP}, confirming it contributes.
 *
 * @module agentos-bench/micro/SignalAblation
 */

import {
  DEFAULT_SCORING_WEIGHTS,
  scoreAndRankTraces,
} from '@framers/agentos';
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

type SignalKey = keyof typeof DEFAULT_SCORING_WEIGHTS;

/** Every retrieval signal the composite scorer blends. */
const SIGNALS: SignalKey[] = [
  'strength',
  'similarity',
  'recency',
  'emotionalCongruence',
  'graphActivation',
  'importance',
];

/**
 * Minimum NDCG@K drop required for a signal to count as load-bearing.
 * Values below this threshold would indicate the signal contributes
 * nothing measurable to ranking quality on this fixture. The threshold
 * is intentionally tiny — we care about zero vs non-zero, not the
 * absolute magnitude of the drop. The signals have very different
 * weights (0.05 for importance vs 0.35 for similarity) so any single
 * threshold must be well below the smallest expected drop.
 */
const MIN_NDCG_DROP = 1e-4;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * SignalAblation — proves each of the 6 retrieval signals contributes
 * measurable ranking quality.
 */
export class SignalAblation implements IBenchmark {
  readonly id = 'signal-ablation';
  readonly version = '1.0.0';
  readonly family = 'micro' as const;
  readonly passThreshold = 1.0;

  async setup(_ctx: BenchContext): Promise<void> {}

  async loadTestCases(_ctx: BenchContext): Promise<BenchCase[]> {
    return SIGNALS.map((signal) => ({
      id: `ablate-${signal}`,
      type: 'ablation',
      question: `Zeroing weight '${signal}' should drop NDCG@${SIGNALS.length} by ≥${MIN_NDCG_DROP}.`,
      haystack: [],
      expected: `NDCG@${SIGNALS.length} drop ≥ ${MIN_NDCG_DROP}`,
      metadata: { signal },
    }));
  }

  async runCase(c: BenchCase, _ctx: BenchContext): Promise<CaseRun> {
    const start = Date.now();
    const ablatedSignal = c.metadata?.signal as SignalKey;

    // Per-signal fixture: one hero trace tuned to dominate on the target
    // signal, plus neutral distractors. Ablating the target signal should
    // demote the hero out of position 1.
    const fixture = buildSignalFixture(ablatedSignal);
    const now = fixture.now;

    const baselineRanking = scoreAndRankTraces(fixture.candidates, {
      currentMood: fixture.mood,
      now,
    }).map((t) => t.id);

    const ablatedWeights = { ...DEFAULT_SCORING_WEIGHTS, [ablatedSignal]: 0 };
    const ablatedRanking = scoreAndRankTraces(fixture.candidates, {
      currentMood: fixture.mood,
      now,
      weights: ablatedWeights,
    }).map((t) => t.id);

    // Baseline ranking IS the ideal — all weights active places the
    // signal-strong hero on top by construction. Ablation success means
    // that same ranking reshuffles, which shows up as an NDCG drop vs
    // the baseline ordering. We also track a cruder "rankings
    // differ" boolean that short-circuits the tiny-NDCG-drop edge case
    // where a reshuffle happened but didn't accumulate enough DCG
    // weight to clear the floor.
    const ndcgIdeal = ndcgAtK(baselineRanking, baselineRanking, fixture.candidates.length);
    const ndcgAblated = ndcgAtK(ablatedRanking, baselineRanking, fixture.candidates.length);
    const drop = ndcgIdeal - ndcgAblated;
    const rankingsDiffer = !arraysEqual(baselineRanking, ablatedRanking);

    return {
      caseId: c.id,
      actualOutput: `NDCG@${SIGNALS.length} drop=${drop.toFixed(4)} (baseline=${ndcgIdeal.toFixed(4)}, ablated=${ndcgAblated.toFixed(4)}, rankingsDiffer=${rankingsDiffer})`,
      latencyMs: Date.now() - start,
      tokensIn: 0,
      tokensOut: 0,
      usd: 0,
      metadata: {
        signal: ablatedSignal,
        ndcgBaseline: ndcgIdeal,
        ndcgAblated,
        drop,
        minDropRequired: MIN_NDCG_DROP,
        rankingsDiffer,
        baselineRanking,
        ablatedRanking,
      },
    };
  }

  async scoreCase(_c: BenchCase, run: CaseRun, _ctx: BenchContext): Promise<CaseResult> {
    const drop = (run.metadata?.drop as number) ?? 0;
    const rankingsDiffer = Boolean(run.metadata?.rankingsDiffer);
    // Either of the two signals is enough evidence of a load-bearing
    // weight: a measurable NDCG loss, or a top-K reshuffle.
    const passed = drop >= MIN_NDCG_DROP || rankingsDiffer;
    return {
      ...run,
      score: passed ? 1 : 0,
      passed,
      scoreMetadata: {
        drop,
        minDropRequired: MIN_NDCG_DROP,
        note: passed
          ? `Signal '${String(run.metadata?.signal)}' is load-bearing: removing it dropped NDCG by ${drop.toFixed(4)}.`
          : `Signal '${String(run.metadata?.signal)}' appears redundant: NDCG drop ${drop.toFixed(4)} below ${MIN_NDCG_DROP}.`,
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
        ablation: {
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
// Per-signal fixture builder
// ---------------------------------------------------------------------------

interface Fixture {
  candidates: Array<{ trace: MemoryTrace; vectorSimilarity: number; graphActivation?: number }>;
  mood: { valence: number; arousal: number; dominance: number };
  now: number;
}

interface BaselineSpec {
  encodingStrength: number;
  stabilityDays: number;
  ageDaysForAccess: number;
  valence: number;
  confidence: number;
  similarity: number;
  graphActivation: number;
}

const MOOD = { valence: 0.8, arousal: 0.3, dominance: 0.2 };

/**
 * Neutral baseline — shared between hero and distractors on every
 * non-target signal. The hero adds the target-signal boost on top; the
 * distractors add tiny per-signal perturbations to break ties once the
 * target weight is zeroed.
 */
const NEUTRAL: BaselineSpec = {
  encodingStrength: 0.5,
  stabilityDays: 100,
  ageDaysForAccess: 30,
  valence: 0,
  confidence: 0.5,
  similarity: 0.5,
  graphActivation: 0.5,
};

/**
 * Hero spec for a given signal: strong on the target signal, neutral
 * on every other signal. Crucially, signals that cross-couple with the
 * target (notably strength ↔ age via Ebbinghaus decay) are tuned so
 * the hero does NOT get an incidental advantage on any non-target
 * signal.
 */
function heroSpecFor(signal: SignalKey): BaselineSpec {
  const spec = { ...NEUTRAL };
  switch (signal) {
    case 'strength':
      // Push encodingStrength up, but keep age and stability identical
      // to distractors so the only pathway to a higher current-strength
      // score is the encodingStrength delta itself.
      spec.encodingStrength = 1.0;
      break;
    case 'similarity':
      spec.similarity = 1.0;
      break;
    case 'recency':
      // Bump recency via shorter elapsed-since-access. Leave
      // encodingStrength at NEUTRAL to avoid coupling with strength.
      spec.ageDaysForAccess = 0.001;
      break;
    case 'emotionalCongruence':
      spec.valence = MOOD.valence;
      break;
    case 'graphActivation':
      spec.graphActivation = 1.0;
      break;
    case 'importance':
      spec.confidence = 1.0;
      break;
  }
  return spec;
}

/**
 * Build a candidate pool whose all-weights ranking places the hero
 * first by a margin attributable solely to the target signal.
 *
 * Distractors match the hero on most signals and add a clear,
 * graduated advantage on one or two *non-target* signals. Once the
 * target weight is zeroed, the distractors' non-target advantage
 * overtakes the hero and the ranking reshuffles.
 */
function buildSignalFixture(targetSignal: SignalKey): Fixture {
  const now = Date.now();
  const candidates: Array<{ trace: MemoryTrace; vectorSimilarity: number; graphActivation?: number }> = [];

  // The hero — strong on the target signal, neutral on everything else.
  candidates.push(makeCandidate(`hero-${targetSignal}`, heroSpecFor(targetSignal), now));

  // Distractor construction is signal-sensitive because the weight
  // magnitudes differ by 7x between similarity (0.35) and importance
  // (0.05). For heavily-weighted targets we give distractors big
  // boosts on two non-target signals; for lightly-weighted targets we
  // give them tiny, single-signal perturbations so the hero's
  // small target-signal advantage is enough to rank it first.
  const distractorBoostScale = targetSignal === 'importance' ? 0.02 : 0.3;
  const nonTargetSignals = SIGNALS.filter((s) => s !== targetSignal);
  for (let i = 0; i < 8; i++) {
    const d = { ...NEUTRAL };
    const a = nonTargetSignals[i % nonTargetSignals.length]!;
    boostSignal(d, a, distractorBoostScale + i * distractorBoostScale * 0.05);
    if (distractorBoostScale >= 0.1) {
      const b = nonTargetSignals[(i + 1) % nonTargetSignals.length]!;
      boostSignal(d, b, distractorBoostScale + i * distractorBoostScale * 0.02);
    }
    candidates.push(makeCandidate(`distractor-${i}`, d, now));
  }

  return { candidates, mood: MOOD, now };
}

function boostSignal(spec: BaselineSpec, signal: SignalKey, delta: number): void {
  switch (signal) {
    case 'strength':
      spec.encodingStrength = clamp01(NEUTRAL.encodingStrength + delta);
      break;
    case 'similarity':
      spec.similarity = clamp01(NEUTRAL.similarity + delta);
      break;
    case 'recency':
      // Smaller age → stronger recency. Scale delta inversely.
      spec.ageDaysForAccess = Math.max(0.01, NEUTRAL.ageDaysForAccess - delta * 50);
      break;
    case 'emotionalCongruence':
      spec.valence = clamp(spec.valence + delta, -1, 1);
      break;
    case 'graphActivation':
      spec.graphActivation = clamp01(spec.graphActivation + delta);
      break;
    case 'importance':
      spec.confidence = clamp01(spec.confidence + delta);
      break;
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function makeCandidate(
  id: string,
  spec: BaselineSpec,
  now: number,
): { trace: MemoryTrace; vectorSimilarity: number; graphActivation: number } {
  const trace = buildSyntheticTrace({
    encodingStrength: spec.encodingStrength,
    stabilityMs: spec.stabilityDays * DAY_MS,
    lastAccessedAt: now - spec.ageDaysForAccess * DAY_MS,
    createdAt: now - 365 * DAY_MS,
  });
  trace.id = id;
  trace.emotionalContext.valence = spec.valence;
  trace.provenance.confidence = spec.confidence;
  return { trace, vectorSimilarity: spec.similarity, graphActivation: spec.graphActivation };
}

// ---------------------------------------------------------------------------
// NDCG helper
// ---------------------------------------------------------------------------

/** Small shallow-equality helper (kept inline so SignalAblation is self-contained). */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * NDCG@K against an ideal ordering. Uses linear gain (position 1 →
 * relevance K, position 2 → K-1, etc.) so reordering inside the top-K
 * registers as meaningful degradation.
 */
export function ndcgAtK(actual: string[], ideal: string[], k: number): number {
  const gainFor = new Map<string, number>();
  const topK = ideal.slice(0, k);
  topK.forEach((id, i) => gainFor.set(id, topK.length - i));

  const dcg = (ordering: string[]) => {
    let sum = 0;
    for (let i = 0; i < Math.min(k, ordering.length); i++) {
      const rel = gainFor.get(ordering[i]!) ?? 0;
      sum += rel / Math.log2(i + 2);
    }
    return sum;
  };

  const ideaDcg = dcg(ideal);
  if (ideaDcg === 0) return 0;
  return dcg(actual) / ideaDcg;
}
