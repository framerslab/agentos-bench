/**
 * @file MarkdownLeaderboard.spec.ts
 * @description Unit tests for the leaderboard renderer. Exercises the
 * full `renderLeaderboard` pipeline against a fixture `summary.json`,
 * plus the exposed `renderExternalSectionForTest` helper for tight
 * per-section assertions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  renderLeaderboard,
  renderExternalSectionForTest,
  bestPublished,
} from '../src/reporting/index.js';
import type { SummaryEntry } from '../src/core/ResultStore.js';

describe('MarkdownLeaderboard', () => {
  let tmpRoot: string;
  let resultsDir: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-lb-'));
    resultsDir = path.join(tmpRoot, 'results');
    await fs.mkdir(resultsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('writes a leaderboard with our rows, competitor rows, and a micro section', async () => {
    const ourLongMemEvalS: SummaryEntry = {
      runFile: 'runs/our-run.json',
      benchmarkId: 'longmemeval-s',
      benchmarkVersion: '1.0.0',
      reader: 'claude-sonnet-4-6',
      memoryMode: 'full-cognitive',
      replayMode: 'observe',
      totalCases: 500,
      accuracy: 0.94,
      avgScore: 0.94,
      avgLatencyMs: 820,
      totalUsd: 12.5,
      costPerCorrect: 0.0266,
      startedAt: '2026-04-18T12:00:00Z',
    };
    const decayMicro: SummaryEntry = {
      runFile: 'micro/decay.json',
      benchmarkId: 'decay-fidelity',
      benchmarkVersion: '1.0.0',
      reader: 'claude-sonnet-4-6',
      memoryMode: 'none',
      replayMode: 'ingest',
      totalCases: 5,
      accuracy: 1,
      avgScore: 1,
      avgLatencyMs: 0.2,
      totalUsd: 0,
      costPerCorrect: 0,
      startedAt: '2026-04-18T12:00:00Z',
    };
    await fs.writeFile(
      path.join(resultsDir, 'summary.json'),
      JSON.stringify({
        updatedAt: '2026-04-18T12:34:56Z',
        latest: {
          'longmemeval-s|claude-sonnet-4-6|full-cognitive|observe': ourLongMemEvalS,
          'decay-fidelity|claude-sonnet-4-6|none|ingest': decayMicro,
        },
      }),
    );

    const outPath = await renderLeaderboard({ resultsDir, headerNote: 'Weekly snapshot.' });
    const content = await fs.readFile(outPath, 'utf8');

    expect(content).toContain('# AgentOS Memory Benchmark Leaderboard');
    expect(content).toContain('Weekly snapshot.');
    expect(content).toContain('Last updated: 2026-04-18T12:34:56Z');

    // LongMemEval-S section includes our row + competitor rows.
    expect(content).toContain('LongMemEval-S (500 cases');
    expect(content).toContain('AgentOS (`@framers/agentos`)');
    expect(content).toContain('94.0%');
    expect(content).toContain('agentmemory (JordanMcCann)');
    expect(content).toContain('96.2%');

    // Target line quotes the best published.
    expect(content).toMatch(/Target to beat: \*\*96\.[0-9]%\*\*/);

    // Micro section present with a row for decay-fidelity.
    expect(content).toContain('## Micro-benchmarks');
    expect(content).toContain('decay-fidelity');
    expect(content).toContain('100.0%');

    // Methodology footer.
    expect(content).toContain('## Methodology notes');
  });

  it('includes per-section competitor ordering and our-vs-target gap', () => {
    const ours: SummaryEntry[] = [
      {
        runFile: 'runs/a.json',
        benchmarkId: 'longmemeval-s',
        benchmarkVersion: '1.0.0',
        reader: 'claude-opus-4-7',
        memoryMode: 'full-cognitive',
        replayMode: 'observe',
        totalCases: 500,
        accuracy: 0.955,
        avgScore: 0.955,
        avgLatencyMs: 600,
        totalUsd: 50,
        costPerCorrect: 0.11,
        startedAt: '2026-04-18T00:00:00Z',
      },
    ];
    const section = renderExternalSectionForTest('longmemeval-s', ours, [
      {
        system: 'Acme Memory',
        reader: 'GPT-4o',
        accuracy: 0.9,
        verifiedOn: '2026-04-18',
        source: 'https://example.com/acme',
      },
    ]);

    expect(section).toContain('AgentOS (`@framers/agentos`)');
    expect(section).toContain('95.5%');
    expect(section).toContain('Acme Memory');
    expect(section).toContain('90.0%');
    // Our table row (|…|) should appear before the competitor's table row.
    // `Acme Memory` also appears in the "Target to beat" line above, so
    // compare against the in-table occurrence specifically.
    const bodyRows = section.split('\n').filter((line) => line.startsWith('| '));
    const ourRowIdx = bodyRows.findIndex((r) => r.includes('AgentOS (`@framers/agentos`)'));
    const acmeRowIdx = bodyRows.findIndex((r) => r.includes('Acme Memory'));
    expect(ourRowIdx).toBeGreaterThanOrEqual(0);
    expect(acmeRowIdx).toBeGreaterThanOrEqual(0);
    expect(ourRowIdx).toBeLessThan(acmeRowIdx);
  });

  it('bestPublished returns the highest-scoring entry per benchmark', () => {
    const best = bestPublished('longmemeval-s');
    expect(best).toBeTruthy();
    // agentmemory has the highest published number at 96.2%.
    expect(best!.accuracy).toBeGreaterThanOrEqual(0.96);
    expect(bestPublished('totally-fake-benchmark')).toBeUndefined();
  });
});
