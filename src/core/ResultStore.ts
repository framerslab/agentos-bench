/**
 * @file ResultStore.ts
 * @description Persistence layer for completed {@link BenchResult}s.
 *
 * Writes one JSON file per run under `results/runs/` (external benchmarks)
 * or `results/micro/` (micro-benchmarks). File names encode the run
 * configuration so a directory listing is human-readable:
 *
 *     2026-04-18T12-00-00-longmemeval-s-claude-sonnet-4-6-observe-full.json
 *
 * Also maintains a rolling `results/summary.json` with the latest result
 * per (benchmark, reader, memoryMode, replayMode) tuple, used by the
 * leaderboard generator.
 *
 * @module agentos-bench/core/ResultStore
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BenchResult, BenchmarkFamily, RunConfig } from './IBenchmark.js';

/**
 * Rolling summary snapshot. Keyed by `${benchmarkId}|${reader}|${memoryMode}|${replayMode}`.
 */
export interface ResultsSummary {
  /** ISO timestamp of the last update. */
  updatedAt: string;
  /** Latest per-tuple result (stripped of per-case detail for size). */
  latest: Record<string, SummaryEntry>;
}

/**
 * A compacted per-tuple summary entry (no per-case detail).
 */
export interface SummaryEntry {
  runFile: string;
  benchmarkId: string;
  benchmarkVersion: string;
  reader: string;
  memoryMode: string;
  replayMode: string;
  totalCases: number;
  accuracy: number;
  avgScore: number;
  avgLatencyMs: number;
  totalUsd: number;
  costPerCorrect: number;
  startedAt: string;
  // v2 metric fields — optional, populated when the underlying run
  // emitted them. Leaderboard rendering gracefully skips sections
  // when no run carries the corresponding field.
  retrievalMetrics?: {
    meanRecallAtK: number;
    meanPrecisionAtK: number;
    meanNdcgAtK: number;
    meanMrr: number;
    k: number;
    sampleSize: number;
  };
  stratifiedAccuracy?: {
    weightedOverall: number;
    unweightedOverall: number;
  };
  latencyBreakdown?: {
    encode: { p50: number; p95: number; p99: number; n: number };
    retrieve: { p50: number; p95: number; p99: number; n: number };
    vectorSearch: { p50: number; p95: number; p99: number; n: number };
    scoring: { p50: number; p95: number; p99: number; n: number };
    replay: { p50: number; p95: number; p99: number; n: number };
  };
  memoryFootprint?: {
    meanBrainBytes: number;
    p95BrainBytes: number;
    meanTraceCount: number;
    maxPeakWorkingMemorySlots: number;
    totalEncodeCalls: number;
  };
}

/**
 * Persists benchmark run results under `<resultsDir>/runs/` or `<resultsDir>/micro/`.
 */
export class ResultStore {
  constructor(private readonly resultsDir: string) {}

  /**
   * Persist a run and update the rolling summary. Returns the relative
   * path (under `resultsDir`) of the run file.
   */
  async save(result: BenchResult, family: BenchmarkFamily): Promise<string> {
    const subdir = family === 'external' ? 'runs' : 'micro';
    const fullDir = path.join(this.resultsDir, subdir);
    await fs.mkdir(fullDir, { recursive: true });

    const filename = this.filenameFor(result);
    const fullPath = path.join(fullDir, filename);
    await fs.writeFile(fullPath, JSON.stringify(result, null, 2));

    await this.updateSummary(result, path.join(subdir, filename));
    return path.join(subdir, filename);
  }

  /**
   * Read the rolling summary. Returns an empty summary if none exists yet.
   */
  async readSummary(): Promise<ResultsSummary> {
    const summaryPath = path.join(this.resultsDir, 'summary.json');
    try {
      const raw = await fs.readFile(summaryPath, 'utf8');
      return JSON.parse(raw) as ResultsSummary;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { updatedAt: new Date().toISOString(), latest: {} };
      }
      throw err;
    }
  }

  /**
   * List all previously-saved run files (both external and micro).
   */
  async listRuns(): Promise<string[]> {
    const out: string[] = [];
    for (const sub of ['runs', 'micro']) {
      const dir = path.join(this.resultsDir, sub);
      try {
        const entries = await fs.readdir(dir);
        for (const e of entries) if (e.endsWith('.json')) out.push(path.join(sub, e));
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    return out.sort();
  }

  private filenameFor(r: BenchResult): string {
    const stamp = r.startedAt.replace(/[:.]/g, '-').replace('Z', '');
    const parts = [
      stamp,
      r.benchmarkId,
      r.config.reader,
      r.config.memoryMode,
      r.config.replayMode,
    ];
    return `${parts.join('--')}.json`;
  }

  private async updateSummary(r: BenchResult, runFile: string): Promise<void> {
    const summary = await this.readSummary();
    const key = `${r.benchmarkId}|${r.config.reader}|${r.config.memoryMode}|${r.config.replayMode}`;

    // N-regression guard: never clobber a larger-N canonical entry with
    // a smaller-N smoke. The summary key intentionally collapses across
    // tier/sample size so that re-runs at the same N update the row;
    // without this guard, a Tier A N=24 smoke could overwrite a Phase B
    // N=500 canonical result and render the wrong number to every
    // downstream consumer (leaderboard, blog, scripts).
    const existing = summary.latest[key];
    if (existing && existing.totalCases > r.totalCases) {
      console.warn(
        `[ResultStore] N-regression guard: skipping summary update ` +
          `for "${key}" — new run has ${r.totalCases} cases, existing ` +
          `row has ${existing.totalCases}. Summary row not overwritten. ` +
          `Run file written to ${runFile}.`,
      );
      return;
    }

    summary.latest[key] = {
      runFile,
      benchmarkId: r.benchmarkId,
      benchmarkVersion: r.benchmarkVersion,
      reader: r.config.reader,
      memoryMode: r.config.memoryMode,
      replayMode: r.config.replayMode,
      totalCases: r.totalCases,
      accuracy: r.accuracy,
      avgScore: r.avgScore,
      avgLatencyMs: r.avgLatencyMs,
      totalUsd: r.totalUsd,
      costPerCorrect: r.costPerCorrect,
      startedAt: r.startedAt,
      // v2 metric fields — optional, only set when the run emitted them.
      retrievalMetrics: r.retrievalMetrics,
      stratifiedAccuracy: r.stratifiedAccuracy
        ? {
            weightedOverall: r.stratifiedAccuracy.weightedOverall,
            unweightedOverall: r.stratifiedAccuracy.unweightedOverall,
          }
        : undefined,
      latencyBreakdown: r.latencyBreakdown,
      memoryFootprint: r.memoryFootprint,
    };
    summary.updatedAt = new Date().toISOString();
    const summaryPath = path.join(this.resultsDir, 'summary.json');
    await fs.mkdir(this.resultsDir, { recursive: true });
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  }
}

/** Utility re-export so callers don't have to import separately. */
export type { RunConfig };
