/**
 * @file ConsolidationSignalPreservation.ts
 * @description Micro-benchmark for the flashbulb-immunity invariant.
 *
 * The cognitive-mechanisms layer claims that traces with encoding
 * strength ≥ 0.9 ("flashbulb-grade") are skipped by the mechanisms that
 * would otherwise mutate them: reconsolidation, retrieval-induced
 * forgetting, temporal gist, and emotion regulation. This benchmark
 * verifies the invariant by pairing a flashbulb trace with a
 * baseline trace through each mechanism and asserting:
 *
 *   1. The flashbulb trace's target property is unchanged.
 *   2. The baseline trace's target property is mutated (so the
 *      mechanism is actually running, not silently disabled).
 *
 * Reconsolidation's flashbulb threshold is configurable via
 * `immuneAboveImportance`; this bench overrides the default (9) to the
 * documented 0.9 when testing that mechanism, mirroring the
 * configuration production deployments are expected to use.
 *
 * @module agentos-bench/micro/ConsolidationSignalPreservation
 */

import {
  applyEmotionRegulation,
  applyReconsolidation,
  applyRetrievalInducedForgetting,
  DEFAULT_MECHANISMS_CONFIG,
} from '@framers/agentos/memory/mechanisms/index';
import type { MemoryTrace } from '@framers/agentos';
import type { PADState } from '@framers/agentos';
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

const FLASHBULB_STRENGTH = 0.95;
const BASELINE_STRENGTH = 0.5;
const NEUTRAL_MOOD: PADState = { valence: 0, arousal: 0, dominance: 0 };
const HAPPY_MOOD: PADState = { valence: 0.8, arousal: 0.4, dominance: 0.3 };

type MechanismId =
  | 'reconsolidation'
  | 'retrieval-induced-forgetting'
  | 'emotion-regulation';

interface MechanismProbe {
  id: MechanismId;
  label: string;
  /** Property on the trace whose change / non-change is the assertion. */
  observe: (t: MemoryTrace) => number;
}

const PROBES: MechanismProbe[] = [
  {
    id: 'reconsolidation',
    label: 'Reconsolidation preserves flashbulb valence',
    observe: (t) => t.emotionalContext.valence,
  },
  {
    id: 'retrieval-induced-forgetting',
    label: 'RIF preserves flashbulb stability',
    observe: (t) => t.stability,
  },
  {
    id: 'emotion-regulation',
    label: 'EmotionRegulation preserves flashbulb valence',
    observe: (t) => t.emotionalContext.valence,
  },
];

/**
 * ConsolidationSignalPreservation — asserts flashbulb-grade traces
 * are protected from the consolidation / retrieval mechanisms that
 * would normally mutate them, while baseline traces are not.
 */
export class ConsolidationSignalPreservation implements IBenchmark {
  readonly id = 'consolidation-signal-preservation';
  readonly version = '1.0.0';
  readonly family = 'micro' as const;
  readonly passThreshold = 1.0;

  async setup(_ctx: BenchContext): Promise<void> {}

  async loadTestCases(_ctx: BenchContext): Promise<BenchCase[]> {
    return PROBES.map((probe) => ({
      id: `flashbulb-invariant-${probe.id}`,
      type: 'assertion',
      question: probe.label,
      haystack: [],
      expected: 'flashbulb unchanged AND baseline changed',
      metadata: { mechanism: probe.id },
    }));
  }

  async runCase(c: BenchCase, _ctx: BenchContext): Promise<CaseRun> {
    const start = Date.now();
    const mechanism = c.metadata?.mechanism as MechanismId;
    const observe = PROBES.find((p) => p.id === mechanism)!.observe;

    const flashbulb = makeTrace(FLASHBULB_STRENGTH);
    const baseline = makeTrace(BASELINE_STRENGTH);

    // EmotionRegulation requires strong negative valence + high arousal to
    // attempt reappraisal. Seed both traces with that profile *before* the
    // "before" snapshot so the observed delta is solely the mechanism's.
    if (mechanism === 'emotion-regulation') {
      for (const t of [flashbulb, baseline]) {
        t.emotionalContext.valence = -0.95;
        t.emotionalContext.arousal = 0.9;
        t.emotionalContext.intensity = 0.85;
      }
    }

    const flashbulbBefore = observe(flashbulb);
    const baselineBefore = observe(baseline);

    switch (mechanism) {
      case 'reconsolidation': {
        // Override default 9 → 0.9 so the guard actually triggers.
        const cfg = { ...DEFAULT_MECHANISMS_CONFIG.reconsolidation, immuneAboveImportance: 0.9 };
        applyReconsolidation(flashbulb, HAPPY_MOOD, cfg);
        applyReconsolidation(baseline, HAPPY_MOOD, cfg);
        break;
      }
      case 'retrieval-induced-forgetting': {
        const cfg = DEFAULT_MECHANISMS_CONFIG.retrievalInducedForgetting;
        // RIF suppresses competitors in place. Use the actual trace refs so
        // mutations propagate back to the outer variables.
        const dummyRetrieved = makeTrace(0.7);
        applyRetrievalInducedForgetting([dummyRetrieved], [flashbulb, baseline], cfg);
        break;
      }
      case 'emotion-regulation': {
        const cfg = DEFAULT_MECHANISMS_CONFIG.emotionRegulation;
        applyEmotionRegulation([flashbulb, baseline], cfg);
        break;
      }
    }

    const flashbulbAfter = observe(flashbulb);
    const baselineAfter = observe(baseline);

    const flashbulbDelta = Math.abs(flashbulbAfter - flashbulbBefore);
    const baselineDelta = Math.abs(baselineAfter - baselineBefore);

    const flashbulbProtected = flashbulbDelta < 1e-9;
    const baselineAffected = baselineDelta > 1e-6;
    const passed = flashbulbProtected && baselineAffected;

    return {
      caseId: c.id,
      actualOutput: passed
        ? 'flashbulb unchanged AND baseline changed'
        : `flashbulbDelta=${flashbulbDelta.toFixed(6)}, baselineDelta=${baselineDelta.toFixed(6)}`,
      latencyMs: Date.now() - start,
      tokensIn: 0,
      tokensOut: 0,
      usd: 0,
      metadata: {
        mechanism,
        flashbulbBefore,
        flashbulbAfter,
        flashbulbDelta,
        baselineBefore,
        baselineAfter,
        baselineDelta,
        flashbulbProtected,
        baselineAffected,
        passed,
      },
    };
  }

  async scoreCase(_c: BenchCase, run: CaseRun, _ctx: BenchContext): Promise<CaseResult> {
    const passed = Boolean(run.metadata?.passed);
    const failures: string[] = [];
    if (run.metadata?.flashbulbProtected === false) failures.push('flashbulb-mutated');
    if (run.metadata?.baselineAffected === false) failures.push('baseline-unchanged');

    return {
      ...run,
      score: passed ? 1 : 0,
      passed,
      scoreMetadata: {
        failures,
        note: passed
          ? `Flashbulb trace protected; baseline trace responded to the mechanism.`
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = Date.now();
let traceCounter = 0;

function makeTrace(encodingStrength: number): MemoryTrace {
  // Unique createdAt per trace → distinct IDs from buildSyntheticTrace. RIF's
  // "skip if in retrieved set" guard keys on ID; non-unique IDs would make
  // the dummyRetrieved trace accidentally match every competitor.
  const created = NOW - 7 * 24 * 60 * 60 * 1000 + traceCounter++;
  const t = buildSyntheticTrace({
    encodingStrength,
    stabilityMs: 30 * 24 * 60 * 60 * 1000,
    lastAccessedAt: NOW - 2 * 24 * 60 * 60 * 1000,
    createdAt: created,
  });
  // Give every trace some emotional texture so reconsolidation has something
  // to drift toward. Flashbulb and baseline share the starting emotion so
  // deltas are directly comparable.
  t.emotionalContext = {
    valence: -0.4,
    arousal: 0.5,
    dominance: 0.0,
    intensity: 0.25,
    gmiMood: 'neutral',
  };
  t.retrievalCount = 3;
  return t;
}

