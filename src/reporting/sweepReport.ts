/**
 * @file sweepReport.ts
 * @description Render a narrative-ready `SWEEP_REPORT.md` from the
 * rolling summary.json. Unlike LEADERBOARD.md (which shows the
 * current best per-cell), the sweep report:
 *
 *   - Groups all runs for each benchmark by memory mode × replay mode
 *   - Shows the headline cell (best accuracy) and highlights ablation deltas
 *   - Pulls out retrieval-quality, latency, and footprint side-by-side
 *   - Provides a "paste-into-blog" headline block
 *
 * Used by Phase 0.5 gate to present consolidated numbers for review.
 *
 * @module agentos-bench/reporting/sweepReport
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ResultStore, type ResultsSummary, type SummaryEntry } from '../core/ResultStore.js';
import { attachBootstrapCIs } from '../core/BenchmarkRunner.js';
import type { BenchResult } from '../core/IBenchmark.js';

export interface SweepReportOptions {
  /** Results directory containing `summary.json` and `runs/`. */
  resultsDir: string;
  /** Filename to write. Defaults to `SWEEP_REPORT.md`. */
  filename?: string;
  /** Optional sweep label ("Phase 0.1 smoke", "Phase A champion run"). */
  label?: string;
}

/**
 * Render the sweep report and write it. Returns the output path.
 */
export async function renderSweepReport(opts: SweepReportOptions): Promise<string> {
  const store = new ResultStore(opts.resultsDir);
  const summary = await store.readSummary();

  const sections: string[] = [];
  sections.push(renderHeader(summary, opts.label));
  sections.push(renderHeadline(summary));
  sections.push(renderAllCells(summary));
  sections.push(renderAblationSummary(summary));
  sections.push(renderFootprintSummary(summary));

  const output = sections.join('\n\n') + '\n';
  const filename = opts.filename ?? 'SWEEP_REPORT.md';
  const outPath = path.join(opts.resultsDir, filename);
  await fs.mkdir(opts.resultsDir, { recursive: true });
  await fs.writeFile(outPath, output);
  return outPath;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function renderHeader(summary: ResultsSummary, label?: string): string {
  const lines = [
    '# AgentOS Bench — Sweep Report',
    '',
    `Last updated: ${summary.updatedAt}`,
  ];
  if (label) lines.push('', `Sweep: **${label}**`);
  lines.push(
    '',
    'Consolidated view across every tracked cell. Paste the "Headline" block into the blog draft.',
  );
  return lines.join('\n');
}

/**
 * The "paste-into-blog" block. Picks the best AgentOS cell on
 * longmemeval-s (by accuracy, tie-break on cost/correct) and
 * surfaces its headline numbers.
 */
export function renderHeadline(summary: ResultsSummary): string {
  const champion = pickChampion(summary, 'longmemeval-s');
  if (!champion) {
    return '## Headline\n\n_No longmemeval-s run yet — run Phase 0.1 smoke first._';
  }
  const weighted =
    champion.stratifiedAccuracy?.weightedOverall !== undefined
      ? `${(champion.stratifiedAccuracy.weightedOverall * 100).toFixed(1)}%`
      : 'n/a';
  const unweighted = `${(champion.accuracy * 100).toFixed(1)}%`;
  const cpc =
    Number.isFinite(champion.costPerCorrect)
      ? `$${champion.costPerCorrect.toFixed(4)}`
      : 'n/a';
  const latency = `${champion.avgLatencyMs.toFixed(0)} ms`;
  const r = champion.retrievalMetrics;
  const retrievalLine = r
    ? `- Retrieval: **R@${r.k}=${r.meanRecallAtK.toFixed(3)}**, NDCG@${r.k}=${r.meanNdcgAtK.toFixed(3)}, MRR=${r.meanMrr.toFixed(3)} (N=${r.sampleSize})`
    : '- Retrieval: _no retrievalMetrics emitted — rerun with v2 metrics framework_';
  return [
    '## Headline',
    '',
    `**Champion cell (${champion.benchmarkId}):** ${champion.reader} / ${champion.memoryMode} / ${champion.replayMode}`,
    '',
    `- Accuracy: **${unweighted}** unweighted, **${weighted}** stratified-weighted (N=${champion.totalCases})`,
    `- Cost per correct: **${cpc}** | avg latency: ${latency}`,
    retrievalLine,
  ].join('\n');
}

function renderAllCells(summary: ResultsSummary): string {
  const externalCells = Object.values(summary.latest).filter((e) => !isMicroId(e.benchmarkId));
  if (externalCells.length === 0) {
    return '## All cells\n\n_No external-benchmark runs in summary._';
  }
  const header = [
    '## All cells',
    '',
    '| Benchmark | Reader | Memory | Replay | Accuracy | Weighted | $/Correct | Avg Latency | N |',
    '|---|---|---|---|---:|---:|---:|---:|---:|',
  ];
  const rows = externalCells
    .sort((a, b) =>
      a.benchmarkId.localeCompare(b.benchmarkId) || b.accuracy - a.accuracy,
    )
    .map((c) => {
      const weighted =
        c.stratifiedAccuracy?.weightedOverall !== undefined
          ? `${(c.stratifiedAccuracy.weightedOverall * 100).toFixed(1)}%`
          : '—';
      const cpc = Number.isFinite(c.costPerCorrect)
        ? `$${c.costPerCorrect.toFixed(4)}`
        : '—';
      return `| ${c.benchmarkId} | ${c.reader} | ${c.memoryMode} | ${c.replayMode} | ${(c.accuracy * 100).toFixed(1)}% | ${weighted} | ${cpc} | ${c.avgLatencyMs.toFixed(0)} ms | ${c.totalCases} |`;
    });
  return [...header, ...rows].join('\n');
}

function renderAblationSummary(summary: ResultsSummary): string {
  // Placeholder — ablation cells need a tag on RunConfig to be
  // identifiable. For now, list any runs whose runFile suggests
  // ablation (via convention on filename, if used), else emit a note.
  const ablations = Object.values(summary.latest).filter((e) =>
    e.runFile.includes('-ablate-'),
  );
  if (ablations.length === 0) {
    return '## Ablation summary\n\n_No ablation runs tracked in summary.json yet._';
  }
  const header = [
    '## Ablation summary',
    '',
    '| Run | Accuracy | Δ vs champion (pp) |',
    '|---|---:|---:|',
  ];
  // Champion baseline accuracy
  const championCell = pickChampion(summary, 'longmemeval-s');
  const baseline = championCell?.accuracy ?? 0;
  const rows = ablations.map((a) => {
    const delta = (a.accuracy - baseline) * 100;
    return `| ${path.basename(a.runFile)} | ${(a.accuracy * 100).toFixed(1)}% | ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} |`;
  });
  return [...header, ...rows].join('\n');
}

function renderFootprintSummary(summary: ResultsSummary): string {
  const withFootprint = Object.values(summary.latest).filter((e) => e.memoryFootprint);
  if (withFootprint.length === 0) {
    return '## Footprint summary\n\n_No run emitted memoryFootprint data yet._';
  }
  const latest = withFootprint.sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1)!;
  const fp = latest.memoryFootprint!;
  const kb = (bytes: number): string => `${(bytes / 1024).toFixed(0)} KB`;
  return [
    '## Footprint (latest run)',
    '',
    `Benchmark: \`${latest.benchmarkId}\` — ${latest.reader} / ${latest.memoryMode} / ${latest.replayMode}`,
    '',
    `- Brain mean/p95: ${kb(fp.meanBrainBytes)} / ${kb(fp.p95BrainBytes)}`,
    `- Mean trace count: ${fp.meanTraceCount.toFixed(0)}`,
    `- Peak working-memory slots: ${fp.maxPeakWorkingMemorySlots}`,
    `- Total encode calls: ${fp.totalEncodeCalls}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickChampion(summary: ResultsSummary, benchmarkId: string): SummaryEntry | undefined {
  const cells = Object.values(summary.latest).filter(
    (e) => e.benchmarkId === benchmarkId,
  );
  if (cells.length === 0) return undefined;
  return [...cells].sort((a, b) => {
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    return a.costPerCorrect - b.costPerCorrect;
  })[0];
}

const MICRO_IDS = new Set([
  'decay-fidelity',
  'hexaco-encoding-bias',
  'working-memory-capacity',
  'spreading-activation-precision',
  'consolidation-signal-preservation',
  'scaling-profile',
  'signal-ablation',
]);

function isMicroId(id: string): boolean {
  return MICRO_IDS.has(id);
}

/**
 * Options for {@link recomputeCIsForResultsDir}.
 */
export interface RecomputeCIsOptions {
  /** Seed for deterministic bootstrap. Default 42. */
  seed?: number;
  /** Bootstrap resamples. Default 10,000. */
  resamples?: number;
}

/**
 * Walk `resultsDir/runs/*.json`, apply {@link attachBootstrapCIs} to
 * each loaded {@link BenchResult}, and overwrite the file. Lets us
 * quantify the CI band on a historical Phase A run without re-burning
 * reader + judge API dollars.
 *
 * Idempotent: running twice with the same seed produces identical
 * output, and an already-CI'd run gets its CIs re-computed (which is
 * how you'd intentionally tighten CIs by bumping resamples).
 *
 * @returns the number of run files touched.
 *
 * @example
 * ```ts
 * await recomputeCIsForResultsDir('packages/agentos-bench/results', {
 *   seed: 42,
 *   resamples: 10_000,
 * });
 * ```
 */
export async function recomputeCIsForResultsDir(
  resultsDir: string,
  options: RecomputeCIsOptions = {},
): Promise<number> {
  const runsDir = path.join(resultsDir, 'runs');
  let entries: string[];
  try {
    entries = await fs.readdir(runsDir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
  let touched = 0;
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const full = path.join(runsDir, name);
    const raw = await fs.readFile(full, 'utf8');
    const parsed = JSON.parse(raw) as BenchResult;
    const withCIs = attachBootstrapCIs(parsed, {
      seed: options.seed ?? 42,
      resamples: options.resamples ?? 10_000,
    });
    await fs.writeFile(full, JSON.stringify(withCIs, null, 2), 'utf8');
    touched += 1;
  }
  return touched;
}
