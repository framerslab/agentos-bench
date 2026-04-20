/**
 * @file computeJudgeAdversarial.ts
 * @description Synthesize topically-adjacent wrong answers, score them
 * through the same judge used to grade real answers, and report the
 * resulting false-positive rate as a noise-floor measurement.
 *
 * ## What this does
 *
 * Motivated by the {@link https://dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg Penfield Labs LoCoMo audit}
 * (April 2026) which found the default LoCoMo judge (gpt-4o-mini)
 * accepts 62.81 percent of intentionally-wrong-but-topically-adjacent
 * answers. Without measuring our own judge's analog, we cannot tell
 * whether a 2-3pp accuracy delta between runs is real or noise.
 *
 * The probe:
 *   1. For each case (up to `maxProbes`), calls `synthesizer` with the
 *      case question + gold answer and asks for a "specifically wrong
 *      but topically adjacent" distractor.
 *   2. Runs that distractor through the same {@link IJudge} that scored
 *      the real answer, using identical rubric and inputs.
 *   3. Reports the fraction of distractors the judge accepted: the
 *      effective false-positive rate at this judge model and prompt.
 *
 * ## Caching
 *
 * Each synthesized distractor is cached to disk under
 * `<cacheDir>/<sha256>.json` keyed by `(caseId, question, goldAnswer,
 * caseType, synthVersion)`. Judge verdicts on distractors go through
 * the existing bench {@link Cache} via `BenchContext.cache` in the
 * caller, so bumping the rubric version invalidates them automatically.
 *
 * ## Cost
 *
 * Default `maxProbes=50`. Each probe fires one cheap synth call
 * (~1,500 tokens in / ~50 tokens out at gpt-5-mini ~ $0.001) plus one
 * judge call at the same model and price as the real-answer judge. Per-
 * run cost bounded at ~$0.05-$0.10. Warm cache drops this to zero.
 *
 * @module agentos-bench/core/metrics/computeJudgeAdversarial
 */

import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { IReader } from '../../readers/IReader.js';
import type { IJudge } from '../../judges/IJudge.js';
import { computeBootstrapCI } from './computeBootstrapCI.js';

/**
 * Version tag baked into the synth cache key. Bump when the synth
 * prompt changes so stale distractors do not leak across prompt
 * revisions.
 */
export const ADVERSARIAL_SYNTH_VERSION = 'v1-2026-04-20';

/**
 * System prompt used to elicit a topically-adjacent wrong answer.
 *
 * Design: the synth model must produce something that would "look
 * right" to a casual reader: correct topic, plausible phrasing, wrong
 * specifics. That's the failure mode the LoCoMo audit identified.
 */
const SYNTH_SYSTEM_PROMPT = [
  'You generate intentionally wrong answers to evaluation questions for a benchmark audit.',
  'Your job is to produce a plausible-sounding but specifically incorrect answer:',
  '  - Stay on the correct topic and domain.',
  '  - Use the same phrasing register as the gold answer.',
  '  - Change specific values (names, numbers, dates, preferences) to different but plausible ones.',
  '  - Do NOT include hedges like "I think" or "maybe".',
  '  - Do NOT reveal that you are generating a wrong answer.',
  'Emit only the adversarial answer text. No preamble, no sign-off.',
].join(' ');

/**
 * Input for {@link synthesizeAdversarialAnswer}.
 */
export interface AdversarialSynthInput {
  /** Benchmark case identifier. */
  caseId: string;
  /** The original question asked of the system under test. */
  question: string;
  /** The gold/expected answer used to steer the distractor away from correctness. */
  goldAnswer: string;
  /** Case type for per-category FPR bucketing. */
  caseType: string;
  /** LLM invoker that produces the distractor text. Shape matches {@link IReader}. */
  invoker: IReader;
  /** Disk cache directory. When omitted, synth runs every call. */
  cacheDir?: string;
}

/**
 * Output from {@link synthesizeAdversarialAnswer}.
 */
export interface AdversarialSynthOutput {
  /** The distractor text. */
  text: string;
  /** True when the text came from disk cache. */
  cached: boolean;
  /** Synth model id. Echoed so callers can record provenance. */
  model: string;
  /** Tokens consumed on a miss; zero on hit. */
  tokensIn: number;
  tokensOut: number;
}

/**
 * Compute the content-addressed cache key for a synth call.
 */
function synthCacheKey(input: AdversarialSynthInput): string {
  return createHash('sha256')
    .update(ADVERSARIAL_SYNTH_VERSION)
    .update('\n')
    .update(input.caseId)
    .update('\n')
    .update(input.question)
    .update('\n')
    .update(input.goldAnswer)
    .update('\n')
    .update(input.caseType)
    .digest('hex');
}

/**
 * Synthesize a topically-adjacent wrong answer for one case. Reads
 * from and writes to a content-addressed disk cache when `cacheDir`
 * is set.
 *
 * @example
 * ```ts
 * const distractor = await synthesizeAdversarialAnswer({
 *   caseId: '6d550036',
 *   question: 'Which city did the user mention flying into?',
 *   goldAnswer: 'Portland',
 *   caseType: 'multi-session',
 *   invoker: reader,
 *   cacheDir: `${dataDir}/.judge-adversarial-cache`,
 * });
 * ```
 */
export async function synthesizeAdversarialAnswer(
  input: AdversarialSynthInput,
): Promise<AdversarialSynthOutput> {
  const key = synthCacheKey(input);
  const cachePath = input.cacheDir
    ? path.join(input.cacheDir, `${key}.json`)
    : undefined;

  if (cachePath) {
    try {
      const raw = await fs.readFile(cachePath, 'utf8');
      const cached = JSON.parse(raw) as { text: string; model: string };
      return {
        text: cached.text,
        cached: true,
        model: cached.model,
        tokensIn: 0,
        tokensOut: 0,
      };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  const userPrompt = [
    `Question: ${input.question}`,
    `Gold answer: ${input.goldAnswer}`,
    `Case type: ${input.caseType}`,
    '',
    'Produce the adversarial answer now.',
  ].join('\n');

  const resp = await input.invoker.invoke({
    system: SYNTH_SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 128,
    temperature: 0.7,
  });
  const text = resp.text.trim();

  if (cachePath) {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(
      cachePath,
      JSON.stringify({ text, model: resp.model }),
      'utf8',
    );
  }

  return {
    text,
    cached: false,
    model: resp.model,
    tokensIn: resp.tokensIn,
    tokensOut: resp.tokensOut,
  };
}

/**
 * A benchmark case sketch, minimal shape needed for the adversarial
 * probe. Compatible with `BenchCase` but does not require the
 * full haystack.
 */
export interface AdversarialProbeCase {
  id: string;
  type: string;
  question: string;
  expected: string;
}

/**
 * Input to {@link computeJudgeAdversarialRate}.
 */
export interface AdversarialRateInput {
  /** Cases to probe (truncated to `maxProbes`). */
  cases: AdversarialProbeCase[];
  /** Benchmark id (propagated to the judge for rubric selection). */
  benchmarkId: string;
  /** The same judge used to score real answers on this run. */
  judge: IJudge;
  /** The synth invoker (cheap LLM). */
  synthesizer: IReader;
  /** Disk cache directory for synth outputs. */
  cacheDir?: string;
  /**
   * Max cases to probe. Default 50. Hard-bounds the cost to roughly
   * 2*50 = 100 LLM calls per run.
   */
  maxProbes?: number;
  /** Bootstrap resamples for the FPR CI. Default 10,000. */
  resamples?: number;
  /** Bootstrap seed for deterministic CIs. */
  seed?: number;
}

/**
 * Output of {@link computeJudgeAdversarialRate}.
 */
export interface AdversarialRateOutput {
  /** Overall false-positive rate: fraction of distractors the judge accepted. */
  rate: number;
  /** Lower bound of 95 percent bootstrap CI over the FPR. */
  ciLo: number;
  /** Upper bound of 95 percent bootstrap CI. */
  ciHi: number;
  /** Number of cases probed (capped at `maxProbes`). */
  samplesProbed: number;
  /** FPR broken down per case type (only types that had probes). */
  byCaseType: Record<
    string,
    { rate: number; ciLo: number; ciHi: number; n: number }
  >;
  /** Synth model id (for provenance in findings docs). */
  synthModel: string;
  /** Judge model id. */
  judgeModel: string;
  /** Rubric version used by the judge. */
  rubricVersion: string;
  /** Total synth tokens consumed on cache misses. */
  synthTokensIn: number;
  synthTokensOut: number;
  /** Total judge tokens consumed. Judge cache not consulted here; the caller decides. */
  judgeTokensIn: number;
  judgeTokensOut: number;
}

/**
 * Run the adversarial probe over `cases` and compute the judge's
 * false-positive rate with a bootstrap CI.
 *
 * @example
 * ```ts
 * const fpr = await computeJudgeAdversarialRate({
 *   cases: benchCases,
 *   benchmarkId: 'longmemeval-s',
 *   judge,
 *   synthesizer: createReader('gpt-5-mini'),
 *   cacheDir: `${dataDir}/.judge-adversarial-cache`,
 *   maxProbes: 50,
 *   seed: 7,
 * });
 * // => { rate: 0.28, ciLo: 0.17, ciHi: 0.41, samplesProbed: 50, ... }
 * ```
 */
export async function computeJudgeAdversarialRate(
  input: AdversarialRateInput,
): Promise<AdversarialRateOutput> {
  const maxProbes = input.maxProbes ?? 50;
  const probeCases = input.cases.slice(0, maxProbes);

  const indicators: number[] = [];
  const byType = new Map<string, number[]>();
  let synthTokensIn = 0;
  let synthTokensOut = 0;
  let judgeTokensIn = 0;
  let judgeTokensOut = 0;
  let synthModel = input.synthesizer.model;

  for (const c of probeCases) {
    const synth = await synthesizeAdversarialAnswer({
      caseId: c.id,
      question: c.question,
      goldAnswer: c.expected,
      caseType: c.type,
      invoker: input.synthesizer,
      cacheDir: input.cacheDir,
    });
    synthTokensIn += synth.tokensIn;
    synthTokensOut += synth.tokensOut;
    synthModel = synth.model;

    const verdict = await input.judge.judge({
      benchmarkId: input.benchmarkId,
      caseId: c.id,
      caseType: c.type,
      question: c.question,
      actual: synth.text,
      expected: c.expected,
    });
    judgeTokensIn += verdict.tokensIn;
    judgeTokensOut += verdict.tokensOut;

    const indicator = verdict.correct ? 1 : 0;
    indicators.push(indicator);
    const bucket = byType.get(c.type) ?? [];
    bucket.push(indicator);
    byType.set(c.type, bucket);
  }

  const mean = (s: number[]): number => s.reduce((a, b) => a + b, 0) / s.length;
  const overall = indicators.length
    ? computeBootstrapCI(indicators, mean, {
        resamples: input.resamples ?? 10_000,
        seed: input.seed,
      })
    : { value: 0, ciLo: 0, ciHi: 0, resamples: 0, ci: 0.95 };

  const byCaseType: AdversarialRateOutput['byCaseType'] = {};
  for (const [type, vals] of byType) {
    const r = computeBootstrapCI(vals, mean, {
      resamples: input.resamples ?? 10_000,
      seed: input.seed,
    });
    byCaseType[type] = { rate: r.value, ciLo: r.ciLo, ciHi: r.ciHi, n: vals.length };
  }

  return {
    rate: overall.value,
    ciLo: overall.ciLo,
    ciHi: overall.ciHi,
    samplesProbed: indicators.length,
    byCaseType,
    synthModel,
    judgeModel: input.judge.model,
    rubricVersion: input.judge.rubricVersion,
    synthTokensIn,
    synthTokensOut,
    judgeTokensIn,
    judgeTokensOut,
  };
}
