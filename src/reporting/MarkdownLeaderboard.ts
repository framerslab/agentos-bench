/**
 * @file MarkdownLeaderboard.ts
 * @description Render `results/LEADERBOARD.md` from the rolling
 * {@link ResultsSummary} plus the static {@link COMPETITOR_NUMBERS}.
 *
 * The leaderboard is the public face of the benchmark suite — it is
 * what gets screenshot, quoted on the blog, and linked from the README.
 * Keep the shape stable and the footnotes honest.
 *
 * Structure:
 *   - One section per external benchmark (LongMemEval, LOCOMO, BEAM).
 *   - Each section: our best runs in the top rows, then competitor
 *     published numbers sorted descending by accuracy.
 *   - Columns: system | reader | memory mode | accuracy | avg latency |
 *     $/correct | source.
 *   - Micro-benchmarks get their own section at the end with pass/fail
 *     summary per probe.
 *
 * @module agentos-bench/reporting/MarkdownLeaderboard
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ResultStore, type ResultsSummary, type SummaryEntry } from '../core/ResultStore.js';
import { bestPublished, COMPETITOR_NUMBERS, type CompetitorScore } from './competitor-numbers.js';

/**
 * Options for rendering the leaderboard.
 */
export interface LeaderboardOptions {
  /** Results directory containing `summary.json` and `runs/`. */
  resultsDir: string;
  /** Filename to write. Defaults to `LEADERBOARD.md`. */
  filename?: string;
  /** Header text appended under the top-level title. */
  headerNote?: string;
}

interface RenderedRow {
  system: string;
  reader: string;
  memoryMode: string;
  replayMode: string;
  accuracy: number;
  avgLatencyMs?: number;
  costPerCorrect?: number;
  source?: string;
}

const EXTERNAL_BENCHMARK_ORDER = [
  'longmemeval-s',
  'longmemeval-m',
  'longmemeval-oracle',
  'locomo',
  'beam-500k',
  'beam-1m',
  'beam-10m',
] as const;

/**
 * Load results + competitor numbers, render a markdown leaderboard,
 * and write it to `<resultsDir>/<filename>`. Returns the written path.
 */
export async function renderLeaderboard(opts: LeaderboardOptions): Promise<string> {
  const store = new ResultStore(opts.resultsDir);
  const summary = await store.readSummary();

  const sections: string[] = [];
  sections.push(buildHeader(summary, opts.headerNote));

  for (const benchId of EXTERNAL_BENCHMARK_ORDER) {
    const section = buildExternalSection(benchId, summary);
    if (section) sections.push(section);
    const retrievalSection = buildRetrievalSection(benchId, summary);
    if (retrievalSection) sections.push(retrievalSection);
  }

  const micro = buildMicroSection(summary);
  if (micro) sections.push(micro);

  const latencyAppendix = buildLatencyAppendix(summary);
  if (latencyAppendix) sections.push(latencyAppendix);

  sections.push(buildFooter());

  const output = sections.join('\n\n') + '\n';
  const filename = opts.filename ?? 'LEADERBOARD.md';
  const outPath = path.join(opts.resultsDir, filename);
  await fs.mkdir(opts.resultsDir, { recursive: true });
  await fs.writeFile(outPath, output);
  return outPath;
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildHeader(summary: ResultsSummary, headerNote?: string): string {
  const lines = [
    '# AgentOS Memory Benchmark Leaderboard',
    '',
    `Last updated: ${summary.updatedAt}`,
  ];
  if (headerNote) lines.push('', headerNote);
  lines.push(
    '',
    'Our rows are produced by `@framers/agentos-bench` against the linked source datasets.',
    'Competitor rows are lifted verbatim from their published sources (see per-row citations).',
    'Methodologies may differ; every row footnotes its reader LLM so comparisons stay honest.',
  );
  return lines.join('\n');
}

function buildExternalSection(benchId: string, summary: ResultsSummary): string | null {
  const ours = Object.values(summary.latest).filter((e) => e.benchmarkId === benchId);
  const competitors = COMPETITOR_NUMBERS[benchId] ?? [];
  if (ours.length === 0 && competitors.length === 0) return null;

  const rows: RenderedRow[] = [];
  for (const o of ours.sort((a, b) => b.accuracy - a.accuracy)) {
    rows.push({
      system: 'AgentOS (`@framers/agentos`)',
      reader: o.reader,
      memoryMode: o.memoryMode,
      replayMode: o.replayMode,
      accuracy: o.accuracy,
      avgLatencyMs: o.avgLatencyMs,
      costPerCorrect: o.costPerCorrect,
    });
  }
  for (const c of competitors.sort((a, b) => b.accuracy - a.accuracy)) {
    rows.push({
      system: c.system,
      reader: c.reader,
      memoryMode: '—',
      replayMode: '—',
      accuracy: c.accuracy,
      source: c.source,
    });
  }

  const title = sectionTitle(benchId);
  const target = bestPublished(benchId);
  const targetLine = target ? `Target to beat: **${(target.accuracy * 100).toFixed(1)}%** (${target.system}).` : '';
  const header = [
    `## ${title}`,
    '',
    targetLine,
    '',
    '| System | Reader | Memory | Replay | Accuracy | Avg latency | $/correct | Source |',
    '|---|---|---|---|---:|---:|---:|---|',
  ].filter(Boolean);

  const body = rows.map((r) =>
    [
      `| ${r.system}`,
      r.reader,
      r.memoryMode,
      r.replayMode,
      `${(r.accuracy * 100).toFixed(1)}%`,
      r.avgLatencyMs !== undefined ? `${r.avgLatencyMs.toFixed(0)} ms` : '—',
      r.costPerCorrect !== undefined
        ? Number.isFinite(r.costPerCorrect)
          ? `$${r.costPerCorrect.toFixed(4)}`
          : '—'
        : '—',
      r.source ? `[link](${r.source})` : '—',
    ].join(' | ') + ' |',
  );

  return [...header, ...body].join('\n');
}

function buildRetrievalSection(benchId: string, summary: ResultsSummary): string | null {
  const withMetrics = Object.values(summary.latest).filter(
    (e) => e.benchmarkId === benchId && e.retrievalMetrics && e.retrievalMetrics.sampleSize > 0,
  );
  if (withMetrics.length === 0) return null;

  const k = withMetrics[0]!.retrievalMetrics!.k;
  const header = [
    `### ${sectionTitle(benchId)} — Retrieval Quality (AgentOS only, K=${k})`,
    '',
    '| Config | Memory | Replay | Recall@K | Precision@K | NDCG@K | MRR | N |',
    '|---|---|---|---:|---:|---:|---:|---:|',
  ];
  const body = withMetrics
    .sort((a, b) => (b.retrievalMetrics!.meanNdcgAtK) - (a.retrievalMetrics!.meanNdcgAtK))
    .map((r) => {
      const m = r.retrievalMetrics!;
      return `| ${r.reader}/${r.memoryMode}/${r.replayMode} | ${r.memoryMode} | ${r.replayMode} | ${m.meanRecallAtK.toFixed(3)} | ${m.meanPrecisionAtK.toFixed(3)} | ${m.meanNdcgAtK.toFixed(3)} | ${m.meanMrr.toFixed(3)} | ${m.sampleSize} |`;
    });
  return [...header, ...body].join('\n');
}

function buildLatencyAppendix(summary: ResultsSummary): string | null {
  const withBreakdown = Object.values(summary.latest).filter((e) => e.latencyBreakdown);
  if (withBreakdown.length === 0) return null;
  const latest = withBreakdown.sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1)!;
  const lb = latest.latencyBreakdown!;
  const fp = latest.memoryFootprint;

  const lines: string[] = [
    '## Latency & Footprint (latest AgentOS run)',
    '',
    `Benchmark: \`${latest.benchmarkId}\` — ${latest.reader} / ${latest.memoryMode} / ${latest.replayMode}`,
    '',
    `- Encode   p50/p95/p99: ${lb.encode.p50.toFixed(1)}/${lb.encode.p95.toFixed(1)}/${lb.encode.p99.toFixed(1)} ms (n=${lb.encode.n})`,
    `- Retrieve p50/p95/p99: ${lb.retrieve.p50.toFixed(1)}/${lb.retrieve.p95.toFixed(1)}/${lb.retrieve.p99.toFixed(1)} ms (n=${lb.retrieve.n})`,
    `- Vector search p50/p95: ${lb.vectorSearch.p50.toFixed(1)}/${lb.vectorSearch.p95.toFixed(1)} ms`,
    `- Scoring p50/p95:       ${lb.scoring.p50.toFixed(1)}/${lb.scoring.p95.toFixed(1)} ms`,
    `- Replay p50/p95:        ${lb.replay.p50.toFixed(0)}/${lb.replay.p95.toFixed(0)} ms`,
  ];
  if (fp) {
    lines.push(
      `- Brain size mean/p95:   ${(fp.meanBrainBytes / 1024).toFixed(0)} KB / ${(fp.p95BrainBytes / 1024).toFixed(0)} KB`,
      `- Mean trace count:      ${fp.meanTraceCount.toFixed(0)}`,
      `- Peak WM slots (max):   ${fp.maxPeakWorkingMemorySlots}`,
      `- Total encode calls:    ${fp.totalEncodeCalls}`,
    );
  }
  return lines.join('\n');
}

function buildMicroSection(summary: ResultsSummary): string | null {
  const rows = Object.values(summary.latest).filter((e) => isMicroId(e.benchmarkId));
  if (rows.length === 0) return null;

  const header = [
    '## Micro-benchmarks (cognitive-mechanism assertions)',
    '',
    'Each probe is a deterministic assertion on an AgentOS cognitive mechanism.',
    'Regressions here indicate a bug in the mechanism, not a scoring-model issue.',
    '',
    '| Benchmark | Cases | Accuracy | Avg latency |',
    '|---|---:|---:|---:|',
  ];
  const body = rows
    .sort((a, b) => a.benchmarkId.localeCompare(b.benchmarkId))
    .map((r) =>
      `| ${r.benchmarkId} | ${r.totalCases} | ${(r.accuracy * 100).toFixed(1)}% | ${r.avgLatencyMs.toFixed(1)} ms |`,
    );
  return [...header, ...body].join('\n');
}

function buildFooter(): string {
  return [
    '## Methodology notes',
    '',
    '- Our `memory` column shows the AgentOS memory mode under test: `full-cognitive` uses `CognitiveMemoryManager` with all eight cognitive mechanisms active (reconsolidation, RIF, involuntary recall, metacognitive FOK, temporal gist, schema encoding, source confidence decay, emotion regulation); `base-memory` uses the standalone `Memory` facade; `none` is the haystack-in-context baseline.',
    '- Our `replay` column shows how the haystack was fed to memory: `observe` drives per-turn `CognitiveMemoryManager.encode()` calls (matching live-conversation cadence); `ingest` collapses each session into one `encode()` call. The observer / reflector pipeline only activates when an LLM invoker is configured; benchmark runs typically ship without one to keep costs bounded, so both modes exercise the encoding + decay + scoring stack directly.',
    '- Per-case scoring uses the upstream rubric (see `RUBRIC_SOURCE` in `src/judges/rubrics/`).',
    '- Judge model is GPT-4o unless otherwise noted, to avoid same-family self-preference bias when the reader is also Claude.',
    '- Cost-per-correct divides total USD (reader + embedding + judge) by passed cases; it is the primary efficiency metric once accuracy is competitive.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sectionTitle(benchId: string): string {
  switch (benchId) {
    case 'longmemeval-s':
      return 'LongMemEval-S (500 cases, ~115k-token haystacks)';
    case 'longmemeval-m':
      return 'LongMemEval-M (500 sessions per haystack)';
    case 'longmemeval-oracle':
      return 'LongMemEval-Oracle (retrieval-removed, reader quality only)';
    case 'locomo':
      return 'LOCOMO (long-term conversational memory, 300 turns × 35 sessions)';
    case 'beam-500k':
      return 'BEAM (500k-token tier)';
    case 'beam-1m':
      return 'BEAM (1M-token tier)';
    case 'beam-10m':
      return 'BEAM (10M-token tier — the frontier)';
    default:
      return benchId;
  }
}

function isMicroId(id: string): boolean {
  return [
    'decay-fidelity',
    'hexaco-encoding-bias',
    'working-memory-capacity',
    'spreading-activation-precision',
    'consolidation-signal-preservation',
    'scaling-profile',
    'signal-ablation',
  ].includes(id);
}

/** Exposed for tests — builds a single section from raw inputs. */
export function renderExternalSectionForTest(
  benchId: string,
  ours: SummaryEntry[],
  competitors: CompetitorScore[],
): string {
  const summary: ResultsSummary = {
    updatedAt: new Date().toISOString(),
    latest: Object.fromEntries(
      ours.map((o) => [
        `${o.benchmarkId}|${o.reader}|${o.memoryMode}|${o.replayMode}`,
        o,
      ]),
    ),
  };
  const registryBackup = COMPETITOR_NUMBERS[benchId];
  COMPETITOR_NUMBERS[benchId] = competitors;
  try {
    return buildExternalSection(benchId, summary) ?? '';
  } finally {
    if (registryBackup) COMPETITOR_NUMBERS[benchId] = registryBackup;
    else delete COMPETITOR_NUMBERS[benchId];
  }
}
