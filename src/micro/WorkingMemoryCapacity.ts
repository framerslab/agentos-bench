/**
 * @file WorkingMemoryCapacity.ts
 * @description Micro-benchmark for Baddeley's slot-based working memory.
 *
 * Baddeley & Hitch (1974) model working memory as a small set of slots
 * with capacity 7 ± 2 (Miller's magic number). AgentOS implements this
 * in {@link CognitiveWorkingMemory}, with personality modulation:
 * high Openness (>0.6) adds +1 slot, high Conscientiousness (>0.6)
 * removes 1, and the result is clamped to [5, 9].
 *
 * This benchmark verifies:
 *   1. A neutral-trait (all 0.5) agent has exactly 7 slots.
 *   2. High-Openness (1.0) agent has 8 slots.
 *   3. High-Conscientiousness (1.0) agent has 6 slots.
 *   4. High-both (1.0/1.0) agent sits at 7 (offsets cancel).
 *   5. Capacity is strictly enforced — `focus`ing on a 10th distinct
 *      trace never produces more than `capacity` slots.
 *   6. Eviction is LRU-by-activation (lowest activation evicted first).
 *
 * @module agentos-bench/micro/WorkingMemoryCapacity
 */

import { CognitiveWorkingMemory } from '@framers/agentos';
import type { HexacoTraits } from '@framers/agentos';
import type {
  BenchCase,
  BenchContext,
  BenchResult,
  CaseResult,
  CaseRun,
  IBenchmark,
} from '../core/IBenchmark.js';
import { percentile, stdDev } from '../core/statsUtil.js';
import { MinimalWorkingMemoryBacking } from './support/MinimalWorkingMemoryBacking.js';

interface CapacityProbe {
  label: string;
  traits: Partial<HexacoTraits>;
  expectedCapacity: number;
  /** Number of focus() calls to issue. */
  attemptedFocus: number;
  /** Whether the test should exercise eviction order. */
  checkEvictionOrder?: boolean;
}

const NEUTRAL: HexacoTraits = {
  honesty: 0.5,
  emotionality: 0.5,
  extraversion: 0.5,
  agreeableness: 0.5,
  conscientiousness: 0.5,
  openness: 0.5,
} as HexacoTraits;

const PROBES: CapacityProbe[] = [
  { label: 'neutral-7-slots', traits: {}, expectedCapacity: 7, attemptedFocus: 10 },
  {
    label: 'high-openness-8-slots',
    traits: { openness: 1.0 },
    expectedCapacity: 8,
    attemptedFocus: 12,
  },
  {
    label: 'high-conscientiousness-6-slots',
    traits: { conscientiousness: 1.0 },
    expectedCapacity: 6,
    attemptedFocus: 10,
  },
  {
    label: 'balanced-high-both-7-slots',
    traits: { openness: 1.0, conscientiousness: 1.0 },
    expectedCapacity: 7,
    attemptedFocus: 10,
  },
  {
    label: 'eviction-order-lru-activation',
    traits: {},
    expectedCapacity: 7,
    attemptedFocus: 8,
    checkEvictionOrder: true,
  },
];

/**
 * WorkingMemoryCapacity — asserts Baddeley capacity enforcement and
 * LRU-by-activation eviction order.
 */
export class WorkingMemoryCapacity implements IBenchmark {
  readonly id = 'working-memory-capacity';
  readonly version = '1.0.0';
  readonly family = 'micro' as const;
  readonly passThreshold = 1.0;

  async setup(_ctx: BenchContext): Promise<void> {
    // No dataset.
  }

  async loadTestCases(_ctx: BenchContext): Promise<BenchCase[]> {
    return PROBES.map((probe) => ({
      id: `wm-capacity-${probe.label}`,
      type: 'assertion',
      question: `Working memory should enforce capacity=${probe.expectedCapacity} with trait overrides ${JSON.stringify(probe.traits)}.`,
      haystack: [],
      expected: String(probe.expectedCapacity),
      metadata: {
        traits: probe.traits,
        expectedCapacity: probe.expectedCapacity,
        attemptedFocus: probe.attemptedFocus,
        checkEvictionOrder: probe.checkEvictionOrder ?? false,
      },
    }));
  }

  async runCase(c: BenchCase, _ctx: BenchContext): Promise<CaseRun> {
    const start = Date.now();
    const overrides = c.metadata?.traits as Partial<HexacoTraits>;
    const expectedCapacity = c.metadata?.expectedCapacity as number;
    const attemptedFocus = c.metadata?.attemptedFocus as number;
    const checkEvictionOrder = Boolean(c.metadata?.checkEvictionOrder);

    const traits: HexacoTraits = { ...NEUTRAL, ...overrides };
    const backing = new MinimalWorkingMemoryBacking();
    await backing.initialize('bench-wm');
    const wm = new CognitiveWorkingMemory(backing, {
      baseCapacity: 7,
      traits,
      activationDecayRate: 0.1,
      minActivation: 0.15,
    });

    const observedCapacity = wm.getCapacity();

    const focusedIds: string[] = [];
    const focusActivations: Array<{ id: string; activation: number }> = [];
    for (let i = 0; i < attemptedFocus; i++) {
      const id = `trace-${i}`;
      // Stagger activations so eviction has a deterministic ordering.
      const activation = 0.5 + (i / attemptedFocus) * 0.5;
      await wm.focus(id, activation);
      focusedIds.push(id);
      focusActivations.push({ id, activation });
    }

    const finalSlotCount = wm.getSlotCount();
    const retainedTraceIds = wm.getSlots().map((s: { traceId: string }) => s.traceId).sort();

    // Capacity enforcement: slots never exceed capacity.
    const capacityCorrect = observedCapacity === expectedCapacity;
    const slotCountCorrect = finalSlotCount <= observedCapacity;

    // LRU-by-activation: the N highest-activation traces (most recent
    // `focus()` calls in our probe) should be retained.
    let evictionCorrect = true;
    if (checkEvictionOrder) {
      const expectedRetained = focusActivations
        .slice(-observedCapacity)
        .map((f) => f.id)
        .sort();
      evictionCorrect =
        retainedTraceIds.length === expectedRetained.length &&
        retainedTraceIds.every((id: string, i: number) => id === expectedRetained[i]);
    }

    const passed = capacityCorrect && slotCountCorrect && evictionCorrect;

    return {
      caseId: c.id,
      actualOutput: `capacity=${observedCapacity}, slots=${finalSlotCount}`,
      latencyMs: Date.now() - start,
      tokensIn: 0,
      tokensOut: 0,
      usd: 0,
      metadata: {
        expectedCapacity,
        observedCapacity,
        finalSlotCount,
        attemptedFocus,
        retainedTraceIds,
        capacityCorrect,
        slotCountCorrect,
        evictionCorrect,
        passed,
      },
    };
  }

  async scoreCase(c: BenchCase, run: CaseRun, _ctx: BenchContext): Promise<CaseResult> {
    const passed = Boolean(run.metadata?.passed);
    const failures: string[] = [];
    if (run.metadata?.capacityCorrect === false) failures.push('capacity');
    if (run.metadata?.slotCountCorrect === false) failures.push('slot-count');
    if (run.metadata?.evictionCorrect === false) failures.push('eviction-order');

    return {
      ...run,
      score: passed ? 1 : 0,
      passed,
      scoreMetadata: {
        failures,
        note: passed
          ? `Working memory honors ${String(c.metadata?.expectedCapacity)} slots with predicted eviction order.`
          : `Failures: ${failures.join(', ')}`,
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
        assertion: {
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
