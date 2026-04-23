/**
 * @file computeTokenRetention.ts
 * @description Per-stage retention aggregator. Decomposes Tier 1
 * canonical (raw -> retrieved -> reader), Tier 2 v10 (per-route), and
 * Tier 3 v5 OM-only (raw -> observer -> reader) into measurable per-
 * stage retention rates so we can see WHERE high-IDF tokens are lost
 * in each architecture.
 *
 * Pure function over `CaseResult[]`. Reads two metadata keys when
 * present:
 *   - `metadata.omFinalLog?: string` (NEW; OM modes only)
 *   - `metadata.retrievedEvidence?: Array<{ content?: string }>`
 *     (existing; canonical / OM-with-retrieval / 16 / 17)
 * Reader output is `CaseResult.actualOutput`.
 *
 * @module agentos-bench/core/metrics/computeTokenRetention
 */

import type { CaseResult } from '../IBenchmark.js';
import type { BootstrapResult } from './computeBootstrapCI.js';
import { computeBootstrapCI } from './computeBootstrapCI.js';
import { extractHighIdfTokens } from './extractHighIdfTokens.js';
import { scoreStageRetention } from './scoreStageRetention.js';

/**
 * Minimum high-IDF tokens a case must have after filtering before it
 * contributes to per-category aggregates. Set to 1 so short-answer
 * cases (numeric answers like "$400,000" or "3") still contribute
 * their single-token retention rate. Cases with zero tokens after
 * filtering (e.g., legacy cached cases missing `metadata.expected`)
 * are still surfaced in the excluded list for auditability.
 */
const MIN_TOKENS_PER_CASE = 1;

export interface TokenRetentionStageRates {
  /** Cases where this stage applies (e.g., observer rates only count OM cases). */
  n: number;
  /** Bootstrap-summarized mean retention. */
  retention: BootstrapResult;
}

export interface TokenRetentionPerCategory {
  rawToObserver?: TokenRetentionStageRates;
  rawToRetrieved?: TokenRetentionStageRates;
  observerToReader?: TokenRetentionStageRates;
  retrievedToReader?: TokenRetentionStageRates;
  e2eRetention: TokenRetentionStageRates;
}

export interface TokenRetentionExclusion {
  caseId: string;
  category: string;
  tokenCount: number;
}

export interface TokenRetentionPerCorrectness {
  /** Aggregate rates over cases the reader answered correctly. */
  whenCorrect: TokenRetentionPerCategory;
  /** Aggregate rates over cases the reader answered wrong. */
  whenWrong: TokenRetentionPerCategory;
}

export interface TokenRetentionResult {
  perCategory: Record<string, TokenRetentionPerCategory>;
  overall: TokenRetentionPerCategory;
  /**
   * Per-correctness retention split (Phase 4 v2). Shows whether high
   * retention correlates with correct answers per category. When the
   * gap between whenCorrect and whenWrong is large and stable, the
   * stage's retention rate predicts accuracy and is a valid tune
   * target. When the gap is small, the stage's retention is not
   * accuracy-predictive and tuning it will not move the headline.
   * Absent when no cases qualify for both buckets in any category.
   */
  perCorrectness?: {
    perCategory: Record<string, TokenRetentionPerCorrectness>;
    overall: TokenRetentionPerCorrectness;
  };
  /** Cases excluded from per-category aggregate (zero high-IDF tokens after stopword + length filtering). */
  excluded: TokenRetentionExclusion[];
}

interface PerCaseStageRates {
  caseId: string;
  category: string;
  passed: boolean;
  rawToObserver?: number;
  rawToRetrieved?: number;
  observerToReader?: number;
  retrievedToReader?: number;
  e2e: number;
}

/**
 * Helper: extract the gold answer + category for a case from its
 * metadata. The bench surfaces `expected` and `type` via metadata
 * when running LongMemEval-S.
 */
function extractCaseInputs(caseResult: CaseResult): {
  expected: string;
  category: string;
} {
  const md = (caseResult.metadata ?? {}) as Record<string, unknown>;
  const expected = typeof md.expected === 'string' ? md.expected : '';
  // LongMemEvalS uses `caseType` historically; `type` is the canonical
  // alias added in Step 18. Read either, prefer `type` when both present.
  const categoryRaw =
    typeof md.type === 'string'
      ? md.type
      : typeof md.caseType === 'string'
        ? md.caseType
        : 'unknown';
  return { expected, category: categoryRaw };
}

/**
 * Helper: extract per-stage text strings from a case's metadata.
 */
function extractStageTexts(caseResult: CaseResult): {
  observerLog?: string;
  retrievedJoined?: string;
} {
  const md = (caseResult.metadata ?? {}) as Record<string, unknown>;

  const observerLog =
    typeof md.omFinalLog === 'string' ? md.omFinalLog : undefined;

  let retrievedJoined: string | undefined;
  if (Array.isArray(md.retrievedEvidence)) {
    const parts = (md.retrievedEvidence as Array<{ content?: unknown }>)
      .map((ev) => (typeof ev.content === 'string' ? ev.content : ''))
      .filter(Boolean);
    if (parts.length > 0) retrievedJoined = parts.join('\n');
  }

  return { observerLog, retrievedJoined };
}

/**
 * Compute per-case stage retention rates. Returns either rates or an
 * exclusion record when the case has fewer than MIN_TOKENS_PER_CASE
 * high-IDF tokens after filtering.
 */
function computePerCase(
  caseResult: CaseResult,
):
  | { rates: PerCaseStageRates; tokenCount: number }
  | { excluded: TokenRetentionExclusion } {
  const { expected, category } = extractCaseInputs(caseResult);
  const tokens = extractHighIdfTokens(expected);
  if (tokens.length < MIN_TOKENS_PER_CASE) {
    return {
      excluded: {
        caseId: caseResult.caseId,
        category,
        tokenCount: tokens.length,
      },
    };
  }

  const { observerLog, retrievedJoined } = extractStageTexts(caseResult);
  const reader = caseResult.actualOutput;

  const rates: PerCaseStageRates = {
    caseId: caseResult.caseId,
    category,
    passed: caseResult.passed === true,
    e2e: scoreStageRetention(tokens, reader),
  };

  // SEMANTICS NOTE: `observerToReader` and `retrievedToReader` are
  // ABSOLUTE reader-side retention rates (the reader's actualOutput
  // scored against the gold high-IDF tokens), reported per-stage-source
  // when that upstream stage was present. They are NOT conditional rates
  // (i.e., they do NOT divide reader retention by the upstream stage's
  // retention). When BOTH observerLog AND retrievedJoined are present
  // (e.g., the Step 16 OM + retrieval combined path), `e2e`,
  // `observerToReader`, and `retrievedToReader` will all equal each
  // other — they're the same reader-side measurement, surfaced under
  // three names so per-stage attribution analyses can pivot freely
  // without a separate join. For TRUE conditional rates (reader
  // retention given that the gold token survived to a stage), compute
  // post-hoc via `scoreStageRetention(tokens, reader) / max(epsilon,
  // scoreStageRetention(tokens, observerLog))` at the consumer site.
  if (observerLog !== undefined) {
    rates.rawToObserver = scoreStageRetention(tokens, observerLog);
    rates.observerToReader = scoreStageRetention(tokens, reader);
  }

  if (retrievedJoined !== undefined) {
    rates.rawToRetrieved = scoreStageRetention(tokens, retrievedJoined);
    rates.retrievedToReader = scoreStageRetention(tokens, reader);
  }

  return { rates, tokenCount: tokens.length };
}

function aggregateStage(
  rates: PerCaseStageRates[],
  pick: (r: PerCaseStageRates) => number | undefined,
  bootstrapResamples: number,
  seed: number,
): TokenRetentionStageRates | undefined {
  const values = rates.map(pick).filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return undefined;
  const ci = computeBootstrapCI(
    values,
    (s) => s.reduce((a, b) => a + b, 0) / s.length,
    { resamples: bootstrapResamples, seed, ci: 0.95 },
  );
  return { n: values.length, retention: ci };
}

function aggregateBucket(
  rates: PerCaseStageRates[],
  bootstrapResamples: number,
  seed: number,
): TokenRetentionPerCategory {
  const e2eValues = rates.map((r) => r.e2e);
  const e2eCI = computeBootstrapCI(
    e2eValues,
    (s) => s.reduce((a, b) => a + b, 0) / s.length,
    { resamples: bootstrapResamples, seed, ci: 0.95 },
  );

  return {
    rawToObserver: aggregateStage(rates, (r) => r.rawToObserver, bootstrapResamples, seed),
    rawToRetrieved: aggregateStage(rates, (r) => r.rawToRetrieved, bootstrapResamples, seed),
    observerToReader: aggregateStage(rates, (r) => r.observerToReader, bootstrapResamples, seed),
    retrievedToReader: aggregateStage(rates, (r) => r.retrievedToReader, bootstrapResamples, seed),
    e2eRetention: { n: e2eValues.length, retention: e2eCI },
  };
}

/**
 * Compute per-stage token retention across a run's case results.
 *
 * @param args.cases - the run's per-case results
 * @param args.bootstrapResamples - resamples for CI (default 10000)
 * @param args.seed - PRNG seed (default 42)
 * @returns per-category + overall retention rates plus excluded cases
 */
export function computeTokenRetention(args: {
  cases: CaseResult[];
  bootstrapResamples?: number;
  seed?: number;
}): TokenRetentionResult {
  const bootstrapResamples = args.bootstrapResamples ?? 10_000;
  const seed = args.seed ?? 42;

  const perCategoryRates: Record<string, PerCaseStageRates[]> = {};
  const excluded: TokenRetentionExclusion[] = [];

  for (const c of args.cases) {
    const out = computePerCase(c);
    if ('excluded' in out) {
      excluded.push(out.excluded);
      continue;
    }
    const cat = out.rates.category;
    if (!perCategoryRates[cat]) perCategoryRates[cat] = [];
    perCategoryRates[cat].push(out.rates);
  }

  const perCategory: Record<string, TokenRetentionPerCategory> = {};
  const allRates: PerCaseStageRates[] = [];
  for (const [cat, rates] of Object.entries(perCategoryRates)) {
    perCategory[cat] = aggregateBucket(rates, bootstrapResamples, seed);
    allRates.push(...rates);
  }

  const emptyBucket: TokenRetentionPerCategory = {
    e2eRetention: {
      n: 0,
      retention: { value: 0, ciLo: 0, ciHi: 0, resamples: 0, ci: 0.95 },
    },
  };

  const overall: TokenRetentionPerCategory =
    allRates.length > 0
      ? aggregateBucket(allRates, bootstrapResamples, seed)
      : emptyBucket;

  // Phase 4 v2: per-correctness split. For each category, partition
  // included rates into whenCorrect (passed=true) / whenWrong
  // (passed=false) and aggregate each bucket independently. Buckets
  // with zero cases collapse to the empty-bucket sentinel so consumers
  // can still index into the structure without null checks.
  const perCorrectnessByCategory: Record<string, TokenRetentionPerCorrectness> = {};
  let anyCorrectnessBucketsHaveCases = false;
  for (const [cat, rates] of Object.entries(perCategoryRates)) {
    const correct = rates.filter((r) => r.passed);
    const wrong = rates.filter((r) => !r.passed);
    if (correct.length > 0) anyCorrectnessBucketsHaveCases = true;
    if (wrong.length > 0) anyCorrectnessBucketsHaveCases = true;
    perCorrectnessByCategory[cat] = {
      whenCorrect:
        correct.length > 0
          ? aggregateBucket(correct, bootstrapResamples, seed)
          : emptyBucket,
      whenWrong:
        wrong.length > 0
          ? aggregateBucket(wrong, bootstrapResamples, seed)
          : emptyBucket,
    };
  }
  const overallCorrect = allRates.filter((r) => r.passed);
  const overallWrong = allRates.filter((r) => !r.passed);
  const perCorrectness = anyCorrectnessBucketsHaveCases
    ? {
        perCategory: perCorrectnessByCategory,
        overall: {
          whenCorrect:
            overallCorrect.length > 0
              ? aggregateBucket(overallCorrect, bootstrapResamples, seed)
              : emptyBucket,
          whenWrong:
            overallWrong.length > 0
              ? aggregateBucket(overallWrong, bootstrapResamples, seed)
              : emptyBucket,
        },
      }
    : undefined;

  return { perCategory, overall, perCorrectness, excluded };
}
