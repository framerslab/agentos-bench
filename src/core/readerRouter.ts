/**
 * @file readerRouter.ts
 * @description Per-category reader-tier router. Pure-function reader-model
 * selector that picks among OpenAI reader tiers ({@link ReaderTier}) based on
 * a classifier-predicted question category + a calibrated routing table.
 *
 * Where the existing {@link ./policyRouter.ts | Tier 3 policy router} dispatches
 * BETWEEN retrieval architectures (canonical-hybrid vs OM-v11) at a fixed
 * reader, this router dispatches BETWEEN reader models at a fixed retrieval
 * architecture. Both consume the same gpt-5-mini classifier output, so adding
 * the reader router on top of the policy router costs zero extra LLM calls
 * (the per-case classifier call is amortized across both).
 *
 * The MIN_COST_BEST_CAT_2026_04_28 calibration is grounded in the LongMemEval-S
 * Phase B N=500 per-category accuracy split between gpt-4o and gpt-5-mini at
 * the Tier 3 min-cost + text-embedding-3-small retrieval stack:
 *
 * | Category                  | gpt-4o | gpt-5-mini | Pick      | Δ        |
 * |---------------------------|-------:|-----------:|-----------|---------:|
 * | temporal-reasoning (n=133)|  84.7% |      72.9% | gpt-4o    | +11.8 pp |
 * | single-session-user (n=70)|  94.3% |      90.0% | gpt-4o    |  +4.3 pp |
 * | single-session-pref (n=30)|  63.3% |      86.7% | gpt-5-mini| +23.4 pp |
 * | single-session-asst (n=56)|  98.2% |     100.0% | gpt-5-mini|  +1.8 pp |
 * | knowledge-update    (n=78)|  85.7% |      87.2% | gpt-5-mini|  +1.5 pp |
 * | multi-session      (n=133)|  76.2% |      79.7% | gpt-5-mini|  +3.5 pp |
 *
 * Source runs (committed to results/runs/):
 *   - 2026-04-27T06-27-24-170--longmemeval-s--gpt-4o--full-cognitive--ingest.json
 *   - 2026-04-28T08-07-48-754--longmemeval-s--gpt-5-mini--full-cognitive--ingest.json
 *
 * Oracle aggregate at this calibration: 435/500 = 87.0% (+3.8 pp over either
 * reader alone). Realized at the gpt-5-mini classifier's ~80% category-accuracy
 * on S: ~86%. Validated at Phase B by the run that consumes this table via the
 * `--reader-router min-cost-best-cat-2026-04-28` CLI flag.
 *
 * @module agentos-bench/core/readerRouter
 */

import type { QuestionCategory } from '../observational-memory/questionRouter.js';

/**
 * Reader tier the router can dispatch to. Restricted to OpenAI models the
 * MIN_COST_BEST_CAT_2026_04_28 calibration was measured against. Future
 * presets (e.g. claude-opus-4-7 + gpt-5-mini) would extend this union.
 */
export type ReaderTier = 'gpt-4o' | 'gpt-5-mini';

/**
 * Registered preset identifier. Each preset names the calibration source +
 * the date the calibration table was derived, mirroring the `MINIMIZE_COST_*`
 * preset naming convention in {@link ./policyRouter.ts}.
 */
export type ReaderRouterPreset = 'min-cost-best-cat-2026-04-28';

/**
 * A complete reader-router calibration: every QuestionCategory must map to a
 * ReaderTier. The runtime guard in {@link selectReader} fires if a future
 * table addition forgets a category.
 */
export interface ReaderRouterTable {
  preset: ReaderRouterPreset;
  /** Per-category reader assignment. */
  mapping: Record<QuestionCategory, ReaderTier>;
}

/**
 * Error thrown when {@link selectReader} is called with a category that is
 * not present in the active routing table. Should never fire in production
 * (TypeScript guards exhaustive QuestionCategory at compile time), but the
 * runtime check protects against structural casts and future table refactors
 * that introduce a partial mapping.
 */
export class ReaderRouterUnknownCategoryError extends Error {
  constructor(category: string, preset: string) {
    super(
      `ReaderRouter: category '${category}' not in routing table for preset '${preset}'`,
    );
    this.name = 'ReaderRouterUnknownCategoryError';
  }
}

/**
 * Error thrown when {@link selectReader} is called with a preset that is not
 * registered in {@link PRESET_TABLES}. Guards against typos in CLI flag
 * passthrough (e.g. `--reader-router min-cost-best-cat-2026-04-27` would fail
 * fast here rather than silently routing every case to a default reader).
 */
export class ReaderRouterUnknownPresetError extends Error {
  constructor(preset: string) {
    super(
      `ReaderRouter: preset '${preset}' is not registered. ` +
        `Known presets: ${Object.keys(PRESET_TABLES).join(', ')}`,
    );
    this.name = 'ReaderRouterUnknownPresetError';
  }
}

/**
 * The MIN_COST_BEST_CAT_2026_04_28 calibration. See file header for the
 * derivation table and source runs.
 */
export const MIN_COST_BEST_CAT_2026_04_28_TABLE: ReaderRouterTable = {
  preset: 'min-cost-best-cat-2026-04-28',
  mapping: {
    'temporal-reasoning': 'gpt-4o',
    'single-session-user': 'gpt-4o',
    'single-session-preference': 'gpt-5-mini',
    'single-session-assistant': 'gpt-5-mini',
    'knowledge-update': 'gpt-5-mini',
    'multi-session': 'gpt-5-mini',
  },
};

/**
 * Registry of all calibrated reader-router tables. Adding a new preset means
 * (a) extending {@link ReaderRouterPreset}, (b) defining a `*_TABLE` const
 * with the calibration, (c) adding the entry here. The contract test in
 * {@link ../../tests/resolveRunConfigContract.spec.ts} ensures the CLI flag
 * passes the preset id end-to-end.
 */
export const PRESET_TABLES: Record<ReaderRouterPreset, ReaderRouterTable> = {
  'min-cost-best-cat-2026-04-28': MIN_COST_BEST_CAT_2026_04_28_TABLE,
};

/**
 * Pick a reader tier for a given predicted category under a calibration preset.
 *
 * @throws {ReaderRouterUnknownPresetError} when `preset` is not in {@link PRESET_TABLES}.
 * @throws {ReaderRouterUnknownCategoryError} when the table for `preset` is
 *   missing an entry for `category`. (Defensive runtime guard; not reachable
 *   through the type system on a properly-constructed table.)
 */
export function selectReader(
  category: QuestionCategory,
  preset: ReaderRouterPreset,
): ReaderTier {
  const table = PRESET_TABLES[preset];
  if (!table) {
    throw new ReaderRouterUnknownPresetError(preset);
  }
  const reader = table.mapping[category];
  if (!reader) {
    throw new ReaderRouterUnknownCategoryError(category, preset);
  }
  return reader;
}
