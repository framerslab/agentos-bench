/**
 * @file HexacoEncodingBias.ts
 * @description Micro-benchmark verifying HEXACO personality modulation
 * of encoding strength fires in the predicted direction.
 *
 * AgentOS's cognitive memory claims personality-modulated encoding: an
 * agent high in Openness encodes novel content more strongly than an
 * agent low in Openness. The same prediction holds for each HEXACO
 * dimension's paired content feature:
 *
 *   | HEXACO trait            | Paired content feature | Expected direction |
 *   |-------------------------|------------------------|--------------------|
 *   | openness                | hasNovelty             | high > low         |
 *   | conscientiousness       | hasProcedure           | high > low         |
 *   | emotionality            | hasEmotion             | high > low         |
 *   | extraversion            | hasSocialContent       | high > low         |
 *   | agreeableness           | hasCooperation         | high > low         |
 *   | honesty                 | hasEthicalContent      | high > low         |
 *
 * For each trait, the benchmark runs `computeEncodingStrength` with a
 * "high" agent (trait = 1.0, other traits = 0.5) and a "low" agent
 * (trait = 0.0, other traits = 0.5) against identical content that
 * activates only the paired feature. The test passes when the high
 * agent's encoding strength exceeds the low agent's by at least
 * {@link MIN_BIAS_MARGIN}.
 *
 * @module agentos-bench/micro/HexacoEncodingBias
 */

import {
  computeEncodingStrength,
} from '@framers/agentos';
import type {
  ContentFeatures,
  HexacoTraits,
  PADState,
} from '@framers/agentos';
import type {
  BenchCase,
  BenchContext,
  BenchResult,
  CaseResult,
  CaseRun,
  IBenchmark,
} from '../core/IBenchmark.js';
import { percentile, stdDev } from '../core/statsUtil.js';

/** Minimum required margin between high and low encoding strength. */
const MIN_BIAS_MARGIN = 0.02;

type HexacoDimension = keyof HexacoTraits;

interface TraitProbe {
  trait: HexacoDimension;
  feature: keyof ContentFeatures;
}

const PROBES: TraitProbe[] = [
  { trait: 'openness', feature: 'hasNovelty' },
  { trait: 'conscientiousness', feature: 'hasProcedure' },
  { trait: 'emotionality', feature: 'hasEmotion' },
  { trait: 'extraversion', feature: 'hasSocialContent' },
  { trait: 'agreeableness', feature: 'hasCooperation' },
  { trait: 'honesty', feature: 'hasEthicalContent' },
];

const NEUTRAL_MOOD: PADState = { valence: 0, arousal: 0, dominance: 0 };

/**
 * HexacoEncodingBias — asserts each HEXACO trait modulates encoding
 * strength in the predicted direction for its paired content feature.
 */
export class HexacoEncodingBias implements IBenchmark {
  readonly id = 'hexaco-encoding-bias';
  readonly version = '1.0.0';
  readonly family = 'micro' as const;
  readonly passThreshold = 1.0;

  async setup(_ctx: BenchContext): Promise<void> {
    // No dataset.
  }

  async loadTestCases(_ctx: BenchContext): Promise<BenchCase[]> {
    return PROBES.map((probe) => ({
      id: `hexaco-bias-${probe.trait}`,
      type: 'assertion',
      question: `High-${probe.trait} agent should encode ${probe.feature} content more strongly than a low-${probe.trait} agent.`,
      haystack: [],
      expected: 'high > low',
      metadata: { trait: probe.trait, feature: probe.feature },
    }));
  }

  async runCase(c: BenchCase, _ctx: BenchContext): Promise<CaseRun> {
    const start = Date.now();
    const trait = c.metadata?.trait as HexacoDimension;
    const feature = c.metadata?.feature as keyof ContentFeatures;

    const highAgentTraits = traitsWith({ [trait]: 1.0 });
    const lowAgentTraits = traitsWith({ [trait]: 0.0 });
    const content = featureSet(feature);

    const highResult = computeEncodingStrength(NEUTRAL_MOOD, highAgentTraits, content, 0);
    const lowResult = computeEncodingStrength(NEUTRAL_MOOD, lowAgentTraits, content, 0);
    const margin = highResult.initialStrength - lowResult.initialStrength;

    return {
      caseId: c.id,
      actualOutput: margin > 0 ? 'high > low' : 'high <= low',
      latencyMs: Date.now() - start,
      tokensIn: 0,
      tokensOut: 0,
      usd: 0,
      metadata: {
        trait,
        feature,
        highStrength: highResult.initialStrength,
        lowStrength: lowResult.initialStrength,
        margin,
        requiredMargin: MIN_BIAS_MARGIN,
      },
    };
  }

  async scoreCase(c: BenchCase, run: CaseRun, _ctx: BenchContext): Promise<CaseResult> {
    const margin = (run.metadata?.margin as number) ?? 0;
    const passed = margin >= MIN_BIAS_MARGIN;
    return {
      ...run,
      score: passed ? 1 : 0,
      passed,
      scoreMetadata: {
        margin,
        requiredMargin: MIN_BIAS_MARGIN,
        note: passed
          ? `Trait ${(c.metadata?.trait as string) ?? 'unknown'} biases encoding by ${margin.toFixed(4)} as predicted.`
          : `Bias margin ${margin.toFixed(4)} is below required ${MIN_BIAS_MARGIN} for trait ${(c.metadata?.trait as string) ?? 'unknown'}.`,
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

/** Base traits (all 0.5) merged with explicit overrides. */
function traitsWith(overrides: Partial<HexacoTraits>): HexacoTraits {
  return {
    honesty: 0.5,
    emotionality: 0.5,
    extraversion: 0.5,
    agreeableness: 0.5,
    conscientiousness: 0.5,
    openness: 0.5,
    ...overrides,
  } as HexacoTraits;
}

/** Content features with exactly one boolean feature active. */
function featureSet(active: keyof ContentFeatures): ContentFeatures {
  return {
    hasNovelty: active === 'hasNovelty',
    hasProcedure: active === 'hasProcedure',
    hasEmotion: active === 'hasEmotion',
    hasSocialContent: active === 'hasSocialContent',
    hasCooperation: active === 'hasCooperation',
    hasEthicalContent: active === 'hasEthicalContent',
    hasContradiction: false,
    topicRelevance: active === 'topicRelevance' ? 1 : 0,
  };
}
