/**
 * @file CostTracker.ts
 * @description Per-run token and USD accounting for bench runs.
 *
 * Tracks cumulative reader / embedding / judge costs so the runner can
 * enforce {@link RunConfig.maxUsd} budgets and populate
 * {@link BenchResult.totalUsd} and `costPerCorrect`.
 *
 * Price tables are defined in {@link MODEL_PRICES}. Unknown models are
 * recorded with 0 USD — the warning is logged but the run continues.
 *
 * @module agentos-bench/core/CostTracker
 */

/**
 * USD per 1K tokens. Values reflect published list prices as of 2026-04.
 * Update here when Anthropic / OpenAI publish new pricing.
 */
export const MODEL_PRICES: Record<string, { promptPer1k: number; completionPer1k: number }> = {
  // Anthropic — https://www.anthropic.com/pricing
  'claude-opus-4-7': { promptPer1k: 0.015, completionPer1k: 0.075 },
  'claude-sonnet-4-6': { promptPer1k: 0.003, completionPer1k: 0.015 },
  'claude-haiku-4-5': { promptPer1k: 0.001, completionPer1k: 0.005 },

  // OpenAI — https://openai.com/api/pricing/
  'gpt-4o': { promptPer1k: 0.0025, completionPer1k: 0.01 },
  'gpt-4o-mini': { promptPer1k: 0.00015, completionPer1k: 0.0006 },

  // Embeddings (single price — combine into promptPer1k for simplicity).
  'text-embedding-3-small': { promptPer1k: 0.00002, completionPer1k: 0 },
  'text-embedding-3-large': { promptPer1k: 0.00013, completionPer1k: 0 },
};

/**
 * A single cost entry against a known category.
 */
export interface CostEntry {
  /** What produced the cost (`reader` | `embedding` | `judge`). */
  category: 'reader' | 'embedding' | 'judge';
  /** Model identifier used for pricing lookup. */
  model: string;
  /** Prompt / input tokens. */
  tokensIn: number;
  /** Completion / output tokens (0 for embeddings). */
  tokensOut: number;
  /** Computed USD, set by {@link CostTracker.record}. */
  usd: number;
  /** Optional caller-supplied tag (case ID, benchmark ID). */
  tag?: string;
}

/**
 * Running totals maintained by a {@link CostTracker}.
 */
export interface CostTotals {
  /** Total tokens summed across all categories. */
  totalTokensIn: number;
  totalTokensOut: number;
  /** Per-category USD. */
  readerUsd: number;
  embeddingUsd: number;
  judgeUsd: number;
  /** Sum of all three. */
  totalUsd: number;
  /** Number of individual cost events recorded. */
  eventCount: number;
}

/**
 * Accumulates cost events for a single benchmark run.
 *
 * Cost math is a plain linear lookup against {@link MODEL_PRICES}. Unknown
 * models record USD=0 with a console warning so the run still completes.
 *
 * @example
 * const tracker = new CostTracker();
 * tracker.record({ category: 'reader', model: 'claude-sonnet-4-6', tokensIn: 1000, tokensOut: 200 });
 * console.log(tracker.totals.totalUsd);  // 0.006
 */
export class CostTracker {
  private readonly entries: CostEntry[] = [];
  private _totals: CostTotals = this.emptyTotals();
  /** Runs seen so far — exposed so callers can warn once per model. */
  private readonly warnedModels = new Set<string>();

  /**
   * Record a single cost event. Returns the computed USD so callers can
   * propagate it into {@link CaseRun.usd}.
   */
  record(entry: Omit<CostEntry, 'usd'>): number {
    const price = resolvePrice(entry.model);
    let usd = 0;
    if (!price) {
      if (!this.warnedModels.has(entry.model)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[agentos-bench CostTracker] No price entry for model '${entry.model}', recording 0 USD. Add to MODEL_PRICES.`,
        );
        this.warnedModels.add(entry.model);
      }
    } else {
      usd = (entry.tokensIn / 1000) * price.promptPer1k + (entry.tokensOut / 1000) * price.completionPer1k;
    }

    const full: CostEntry = { ...entry, usd };
    this.entries.push(full);
    this.applyToTotals(full);
    return usd;
  }

  /** Immutable snapshot of current totals. */
  get totals(): Readonly<CostTotals> {
    return { ...this._totals };
  }

  /** All recorded entries (defensive copy). */
  get events(): readonly CostEntry[] {
    return this.entries.slice();
  }

  /** Per-category sub-totals (immutable snapshot). */
  get byCategory(): Readonly<Record<CostEntry['category'], CostTotals>> {
    const groups: Record<CostEntry['category'], CostTotals> = {
      reader: this.emptyTotals(),
      embedding: this.emptyTotals(),
      judge: this.emptyTotals(),
    };
    for (const e of this.entries) this.apply(groups[e.category], e);
    return groups;
  }

  /**
   * Throw if adding `estimatedUsd` would exceed the per-run cap.
   * Called before issuing expensive LLM calls.
   */
  ensureBudget(estimatedUsd: number, maxUsd: number | undefined): void {
    if (maxUsd === undefined) return;
    if (this._totals.totalUsd + estimatedUsd > maxUsd) {
      throw new Error(
        `agentos-bench: run aborted — projected USD ${(this._totals.totalUsd + estimatedUsd).toFixed(4)} exceeds --max-usd ${maxUsd.toFixed(2)}.`,
      );
    }
  }

  private applyToTotals(entry: CostEntry): void {
    this.apply(this._totals, entry);
  }

  private apply(totals: CostTotals, entry: CostEntry): void {
    totals.totalTokensIn += entry.tokensIn;
    totals.totalTokensOut += entry.tokensOut;
    totals.eventCount += 1;
    totals.totalUsd += entry.usd;
    if (entry.category === 'reader') totals.readerUsd += entry.usd;
    else if (entry.category === 'embedding') totals.embeddingUsd += entry.usd;
    else if (entry.category === 'judge') totals.judgeUsd += entry.usd;
  }

  private emptyTotals(): CostTotals {
    return {
      totalTokensIn: 0,
      totalTokensOut: 0,
      readerUsd: 0,
      embeddingUsd: 0,
      judgeUsd: 0,
      totalUsd: 0,
      eventCount: 0,
    };
  }
}

/**
 * Look up a price entry. Falls back to a base-model match when the
 * provider echoes back a versioned name (`gpt-4o-2024-11-20` →
 * `gpt-4o`, `claude-sonnet-4-6-20260315` → `claude-sonnet-4-6`).
 */
function resolvePrice(
  model: string,
): { promptPer1k: number; completionPer1k: number } | undefined {
  const direct = MODEL_PRICES[model];
  if (direct) return direct;

  // Try progressively shorter prefixes split on `-`. Covers
  // `gpt-4o-2024-11-20` → `gpt-4o` (2 parts) and
  // `claude-sonnet-4-6-20260315` → `claude-sonnet-4-6` (4 parts).
  // Stops at 2 parts because single-segment prefixes (`gpt`, `claude`)
  // are too generic and never appear as MODEL_PRICES keys.
  const parts = model.split('-');
  for (let i = parts.length - 1; i >= 2; i--) {
    const candidate = parts.slice(0, i).join('-');
    const match = MODEL_PRICES[candidate];
    if (match) return match;
  }
  return undefined;
}
