/**
 * @file competitor-numbers.ts
 * @description Published SOTA numbers for competing memory systems.
 *
 * These values are lifted verbatim from upstream blog posts, papers,
 * and README screenshots. Each entry cites its source so the
 * leaderboard table footnotes stay honest.
 *
 * Update policy: only when the upstream publishes a new number. Prune
 * when a system stops being relevant. Do not extrapolate — if a number
 * is not published, it is `null`.
 *
 * @module agentos-bench/reporting/competitor-numbers
 */

/** A single published competitor score. */
export interface CompetitorScore {
  /** Name shown in the leaderboard. */
  system: string;
  /** Reader LLM the published number was measured with. */
  reader: string;
  /** Accuracy as a 0–1 fraction. */
  accuracy: number;
  /** ISO date the number was last verified. */
  verifiedOn: string;
  /** Primary source URL. */
  source: string;
}

/**
 * Mapping: benchmarkId (matching {@link IBenchmark.id}) → competitor scores.
 * The bench runner's own row is merged in at leaderboard render time
 * from `results/summary.json`.
 */
export const COMPETITOR_NUMBERS: Record<string, CompetitorScore[]> = {
  'longmemeval-s': [
    {
      system: 'agentmemory (JordanMcCann)',
      reader: 'GPT-4o',
      accuracy: 0.962,
      verifiedOn: '2026-04-18',
      source: 'https://github.com/JordanMcCann/agentmemory',
    },
    {
      system: 'Mastra Observational Memory',
      reader: 'GPT-5-mini',
      accuracy: 0.9487,
      verifiedOn: '2026-04-18',
      source: 'https://mastra.ai/research/observational-memory',
    },
    {
      system: 'Mastra Observational Memory',
      reader: 'GPT-4o',
      accuracy: 0.8423,
      verifiedOn: '2026-04-18',
      source: 'https://mastra.ai/research/observational-memory',
    },
    {
      system: 'Supermemory',
      reader: 'GPT-4o',
      accuracy: 0.816,
      verifiedOn: '2026-04-21',
      source: 'https://supermemory.ai/research/',
    },
    {
      system: 'Supermemory',
      reader: 'GPT-5',
      accuracy: 0.846,
      verifiedOn: '2026-04-21',
      source: 'https://supermemory.ai/research/',
    },
    {
      system: 'Supermemory',
      reader: 'gemini-3-pro',
      accuracy: 0.852,
      verifiedOn: '2026-04-21',
      source: 'https://supermemory.ai/research/',
    },
    {
      system: 'EmergenceMem Internal',
      reader: 'GPT-4o',
      accuracy: 0.86,
      verifiedOn: '2026-04-21',
      source: 'https://www.emergence.ai/blog/sota-on-longmemeval-with-rag',
    },
  ],
  'longmemeval-m': [
    // Upstream M-variant is less-reported than S. Populate as sources surface.
  ],
  'longmemeval-oracle': [],
  locomo: [],
  'beam-500k': [
    {
      system: 'Hindsight',
      reader: 'Unspecified (see source)',
      accuracy: 0.72,
      verifiedOn: '2026-04-18',
      source: 'https://hindsight.vectorize.io/blog/2026/04/02/beam-sota',
    },
  ],
  'beam-1m': [
    {
      system: 'Hindsight',
      reader: 'Unspecified (see source)',
      accuracy: 0.739,
      verifiedOn: '2026-04-18',
      source: 'https://hindsight.vectorize.io/blog/2026/04/02/beam-sota',
    },
  ],
  'beam-10m': [
    {
      system: 'Hindsight',
      reader: 'Unspecified (see source)',
      accuracy: 0.641,
      verifiedOn: '2026-04-18',
      source: 'https://hindsight.vectorize.io/blog/2026/04/02/beam-sota',
    },
    {
      system: 'Next-best published (per Hindsight)',
      reader: 'Unspecified (see source)',
      accuracy: 0.406,
      verifiedOn: '2026-04-18',
      source: 'https://hindsight.vectorize.io/blog/2026/04/02/beam-sota',
    },
  ],
};

/**
 * Best-published score per benchmark — used for the "target" column in
 * the leaderboard header.
 */
export function bestPublished(benchmarkId: string): CompetitorScore | undefined {
  const entries = COMPETITOR_NUMBERS[benchmarkId] ?? [];
  if (entries.length === 0) return undefined;
  return entries.reduce((best, s) => (s.accuracy > best.accuracy ? s : best), entries[0]);
}
