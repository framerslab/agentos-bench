/**
 * @file sweepReport.spec.ts
 * @description Unit tests for the sweep-report renderer.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { renderSweepReport } from '../src/reporting/sweepReport.js';
import type { SummaryEntry } from '../src/core/ResultStore.js';

function mkEntry(overrides: Partial<SummaryEntry> = {}): SummaryEntry {
  return {
    runFile: `runs/${Math.random().toString(36).slice(2, 8)}.json`,
    benchmarkId: 'longmemeval-s',
    benchmarkVersion: '1.0.0',
    reader: 'gpt-5-mini',
    memoryMode: 'full-cognitive',
    replayMode: 'ingest',
    totalCases: 20,
    accuracy: 0.95,
    avgScore: 0.95,
    avgLatencyMs: 60000,
    totalUsd: 0.03,
    costPerCorrect: 0.0017,
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('renderSweepReport', () => {
  let tmpRoot: string;
  let resultsDir: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-report-'));
    resultsDir = path.join(tmpRoot, 'results');
    await fs.mkdir(resultsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('emits a champion headline when at least one longmemeval-s run exists', async () => {
    const entry = mkEntry({
      retrievalMetrics: {
        meanRecallAtK: 0.82,
        meanPrecisionAtK: 0.31,
        meanNdcgAtK: 0.76,
        meanMrr: 0.71,
        k: 10,
        sampleSize: 20,
      },
      stratifiedAccuracy: { weightedOverall: 0.93, unweightedOverall: 0.95 },
    });
    await fs.writeFile(
      path.join(resultsDir, 'summary.json'),
      JSON.stringify({ updatedAt: new Date().toISOString(), latest: { k: entry } }),
    );
    const outPath = await renderSweepReport({ resultsDir });
    const content = await fs.readFile(outPath, 'utf8');
    expect(content).toContain('## Headline');
    expect(content).toContain('Champion cell');
    expect(content).toContain('**95.0%** unweighted');
    expect(content).toContain('**93.0%** stratified-weighted');
    expect(content).toContain('R@10=0.820');
  });

  it('falls back to a "no run yet" note when no longmemeval-s runs exist', async () => {
    await fs.writeFile(
      path.join(resultsDir, 'summary.json'),
      JSON.stringify({ updatedAt: new Date().toISOString(), latest: {} }),
    );
    const outPath = await renderSweepReport({ resultsDir });
    const content = await fs.readFile(outPath, 'utf8');
    expect(content).toContain('No longmemeval-s run yet');
  });

  it('includes optional sweep label in the header', async () => {
    await fs.writeFile(
      path.join(resultsDir, 'summary.json'),
      JSON.stringify({ updatedAt: new Date().toISOString(), latest: {} }),
    );
    const outPath = await renderSweepReport({
      resultsDir,
      label: 'Phase 0.1 smoke',
    });
    const content = await fs.readFile(outPath, 'utf8');
    expect(content).toContain('Sweep: **Phase 0.1 smoke**');
  });

  it('lists every external cell in the "All cells" table', async () => {
    const a = mkEntry({
      benchmarkId: 'longmemeval-s',
      reader: 'gpt-4o',
      accuracy: 0.9,
    });
    const b = mkEntry({
      benchmarkId: 'longmemeval-s',
      reader: 'gpt-5-mini',
      accuracy: 0.95,
    });
    await fs.writeFile(
      path.join(resultsDir, 'summary.json'),
      JSON.stringify({ updatedAt: new Date().toISOString(), latest: { a, b } }),
    );
    const outPath = await renderSweepReport({ resultsDir });
    const content = await fs.readFile(outPath, 'utf8');
    expect(content).toContain('## All cells');
    expect(content).toContain('gpt-4o');
    expect(content).toContain('gpt-5-mini');
  });

  it('lists ablation runs when filename contains "-ablate-"', async () => {
    const champion = mkEntry({ accuracy: 0.95 });
    const ablation = mkEntry({
      runFile: 'runs/2026-04-19-ablate-similarity-gpt-5-mini.json',
      accuracy: 0.78,
    });
    await fs.writeFile(
      path.join(resultsDir, 'summary.json'),
      JSON.stringify({
        updatedAt: new Date().toISOString(),
        latest: { champion, ablation },
      }),
    );
    const outPath = await renderSweepReport({ resultsDir });
    const content = await fs.readFile(outPath, 'utf8');
    expect(content).toContain('## Ablation summary');
    expect(content).toContain('-17.00');
  });

  it('renders footprint block when any entry has memoryFootprint', async () => {
    const entry = mkEntry({
      memoryFootprint: {
        meanBrainBytes: 51200,
        p95BrainBytes: 76800,
        meanTraceCount: 30,
        maxPeakWorkingMemorySlots: 9,
        totalEncodeCalls: 600,
      },
    });
    await fs.writeFile(
      path.join(resultsDir, 'summary.json'),
      JSON.stringify({ updatedAt: new Date().toISOString(), latest: { e: entry } }),
    );
    const outPath = await renderSweepReport({ resultsDir });
    const content = await fs.readFile(outPath, 'utf8');
    expect(content).toContain('## Footprint');
    expect(content).toContain('Peak working-memory slots: 9');
  });
});
