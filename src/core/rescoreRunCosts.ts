/**
 * @file rescoreRunCosts.ts
 * @description Recompute per-case USD from existing token counts.
 *
 * Use cases:
 *   - A MODEL_PRICES entry was added / corrected after the run.
 *   - A provider echoed a versioned model name (`gpt-4o-2024-11-20`)
 *     that the old tracker couldn't resolve, leaving USD at 0.
 *   - Re-pricing retrospectively for a cost-centre reclassification.
 *
 * The function is purely local — it reads token counts the runner
 * already recorded and does not call any LLM. Returns a new
 * {@link BenchResult} with the usd fields updated and the aggregate
 * `totalUsd` / `costPerCorrect` recomputed.
 *
 * Assumption: the case's `metadata.readerModel` or the run config's
 * `reader` is the model charged for the reader tokens; judge pricing
 * uses the run config's judge model. For runs that predate
 * {@link CostTracker} capturing the per-call model name, we fall back
 * to the run config's reader.
 *
 * @module agentos-bench/core/rescoreRunCosts
 */

import type { BenchResult } from './IBenchmark.js';
import { CostTracker } from './CostTracker.js';

/**
 * Options for {@link rescoreRunCosts}.
 */
export interface RescoreOptions {
  /** Reader model override. Defaults to the run's config.reader. */
  readerModel?: string;
  /** Judge model override. Defaults to 'gpt-4o' (bench default). */
  judgeModel?: string;
  /** Rough judge tokens per case. Defaults to 1008 (≈1k prompt + 8 completion). */
  judgeTokensPerCase?: { tokensIn: number; tokensOut: number };
}

/**
 * Return a new {@link BenchResult} with re-priced USD fields.
 */
export function rescoreRunCosts(
  result: BenchResult,
  opts: RescoreOptions = {},
): BenchResult {
  const readerModel = opts.readerModel ?? result.config.reader;
  const judgeModel = opts.judgeModel ?? 'gpt-4o';
  const judgeTokens = opts.judgeTokensPerCase ?? { tokensIn: 1000, tokensOut: 8 };

  const tracker = new CostTracker();
  const rescoredCases = result.cases.map((c) => {
    const readerUsd = tracker.record({
      category: 'reader',
      model: readerModel,
      tokensIn: c.tokensIn,
      tokensOut: c.tokensOut,
      tag: c.caseId,
    });
    // Judge is estimated (the per-case JSON does not record judge
    // token counts separately). Only reprice judge when the run
    // actually invoked one — micro-benchmarks skip it.
    if (result.benchmarkId !== 'decay-fidelity' && c.passed !== undefined) {
      tracker.record({
        category: 'judge',
        model: judgeModel,
        tokensIn: judgeTokens.tokensIn,
        tokensOut: judgeTokens.tokensOut,
        tag: c.caseId,
      });
    }
    return { ...c, usd: readerUsd };
  });

  const totalUsd = tracker.totals.totalUsd;
  const costPerCorrect = result.passedCases > 0 ? totalUsd / result.passedCases : 0;

  return {
    ...result,
    cases: rescoredCases,
    totalUsd,
    costPerCorrect,
  };
}
