/**
 * @file compareRuns.spec.ts
 * @description Specification for the compareRuns helper — diffs two
 * completed {@link BenchResult}s and surfaces regressions, improvements,
 * and unchanged cases. Drives the CLI `compare` subcommand.
 *
 * What we want the helper to return (per the bench design spec
 * section 2 `EvalComparison`):
 *   - overall accuracy delta + percent change
 *   - per-type accuracy delta
 *   - per-case regressions (baseline passed, challenger failed)
 *   - per-case improvements (baseline failed, challenger passed)
 *   - unchanged count
 *   - a winner decision with clear tie-breaking
 */

import { describe, it, expect } from 'vitest';

import { compareRuns } from '../src/core/compareRuns.js';
import type { BenchResult, CaseResult, RunConfig } from '../src/index.js';

function makeCase(id: string, passed: boolean, type = 'single', score?: number): CaseResult {
  return {
    caseId: id,
    actualOutput: passed ? 'correct' : 'wrong',
    latencyMs: 100,
    tokensIn: 10,
    tokensOut: 5,
    usd: 0.01,
    metadata: { caseType: type },
    score: score ?? (passed ? 1 : 0),
    passed,
  };
}

function makeResult(opts: {
  name: string;
  cases: CaseResult[];
  totalUsd?: number;
}): BenchResult {
  const passed = opts.cases.filter((c) => c.passed).length;
  const scores = opts.cases.map((c) => c.score);
  const byType: BenchResult['byType'] = {};
  for (const c of opts.cases) {
    const t = (c.metadata as { caseType?: string } | undefined)?.caseType ?? 'unknown';
    const g = byType[t] ?? { n: 0, accuracy: 0, avgScore: 0 };
    const group = byType[t] ?? { n: 0, accuracy: 0, avgScore: 0 };
    group.n += 1;
    group.accuracy = (group.accuracy * (group.n - 1) + (c.passed ? 1 : 0)) / group.n;
    group.avgScore = (group.avgScore * (group.n - 1) + c.score) / group.n;
    byType[t] = group;
    void g;
  }

  const config: RunConfig = {
    reader: 'claude-sonnet-4-6',
    memoryMode: 'none',
    replayMode: 'ingest',
  };

  return {
    benchmarkId: 'longmemeval-s',
    benchmarkVersion: '1.0.0',
    config,
    totalCases: opts.cases.length,
    passedCases: passed,
    accuracy: passed / Math.max(1, opts.cases.length),
    avgScore: scores.reduce((s, v) => s + v, 0) / Math.max(1, opts.cases.length),
    scoreStdDev: 0,
    byType,
    avgLatencyMs: 100,
    p50LatencyMs: 100,
    p95LatencyMs: 100,
    totalReaderTokens: 15 * opts.cases.length,
    totalUsd: opts.totalUsd ?? 0.01 * opts.cases.length,
    costPerCorrect: passed > 0 ? (opts.totalUsd ?? 0.01 * opts.cases.length) / passed : 0,
    startedAt: '2026-04-18T00:00:00Z',
    completedAt: '2026-04-18T00:00:01Z',
    cases: opts.cases,
  };
}

describe('compareRuns', () => {
  it('labels the challenger as winner when accuracy strictly improves', () => {
    const baseline = makeResult({
      name: 'baseline',
      cases: [
        makeCase('a', true),
        makeCase('b', false),
        makeCase('c', true),
      ],
    });
    const challenger = makeResult({
      name: 'challenger',
      cases: [
        makeCase('a', true),
        makeCase('b', true), // improved
        makeCase('c', true),
      ],
    });

    const diff = compareRuns(baseline, challenger);
    expect(diff.winner).toBe('challenger');
    expect(diff.deltaAccuracy).toBeGreaterThan(0);
    expect(diff.deltaAvgScore).toBeGreaterThanOrEqual(diff.deltaAccuracy);
    expect(diff.improvements.map((c) => c.caseId)).toEqual(['b']);
    expect(diff.regressions).toEqual([]);
    expect(diff.unchanged).toBe(2);
  });

  it('labels the baseline as winner when accuracy strictly regresses', () => {
    const baseline = makeResult({
      name: 'baseline',
      cases: [makeCase('a', true), makeCase('b', true)],
    });
    const challenger = makeResult({
      name: 'challenger',
      cases: [makeCase('a', true), makeCase('b', false)],
    });
    const diff = compareRuns(baseline, challenger);
    expect(diff.winner).toBe('baseline');
    expect(diff.regressions.map((c) => c.caseId)).toEqual(['b']);
    expect(diff.improvements).toEqual([]);
  });

  it('labels tie when accuracy is identical, even if different cases flip', () => {
    const baseline = makeResult({
      name: 'baseline',
      cases: [makeCase('a', true), makeCase('b', false)],
    });
    const challenger = makeResult({
      name: 'challenger',
      cases: [makeCase('a', false), makeCase('b', true)],
    });
    const diff = compareRuns(baseline, challenger);
    expect(diff.winner).toBe('tie');
    expect(diff.regressions.map((c) => c.caseId)).toEqual(['a']);
    expect(diff.improvements.map((c) => c.caseId)).toEqual(['b']);
  });

  it('reports per-type accuracy deltas', () => {
    const baseline = makeResult({
      name: 'baseline',
      cases: [
        makeCase('t1', true, 'temporal'),
        makeCase('t2', false, 'temporal'),
        makeCase('m1', true, 'multi-session'),
      ],
    });
    const challenger = makeResult({
      name: 'challenger',
      cases: [
        makeCase('t1', true, 'temporal'),
        makeCase('t2', true, 'temporal'), // temporal improves 50% -> 100%
        makeCase('m1', false, 'multi-session'), // multi-session 100% -> 0%
      ],
    });
    const diff = compareRuns(baseline, challenger);
    expect(diff.byType.temporal?.deltaAccuracy).toBeCloseTo(0.5);
    expect(diff.byType['multi-session']?.deltaAccuracy).toBeCloseTo(-1);
  });

  it('reports cost-per-correct delta as a signed number when defined on both sides', () => {
    const baseline = makeResult({
      name: 'baseline',
      cases: [makeCase('a', true)],
      totalUsd: 0.05,
    });
    const challenger = makeResult({
      name: 'challenger',
      cases: [makeCase('a', true)],
      totalUsd: 0.03,
    });
    const diff = compareRuns(baseline, challenger);
    expect(diff.deltaCostPerCorrect).toBeCloseTo(0.03 - 0.05);
  });

  it('surfaces missing-case-id rows without throwing', () => {
    const baseline = makeResult({
      name: 'baseline',
      cases: [makeCase('a', true), makeCase('b', false)],
    });
    const challenger = makeResult({
      name: 'challenger',
      cases: [makeCase('a', true)], // 'b' was sampled out
    });
    const diff = compareRuns(baseline, challenger);
    expect(diff.unmatched.onlyInBaseline).toEqual(['b']);
    expect(diff.unmatched.onlyInChallenger).toEqual([]);
  });

  it('carries a paired McNemar result when both runs have cases', () => {
    const baseline = makeResult({
      name: 'baseline',
      cases: [makeCase('a', true), makeCase('b', false)],
    });
    const challenger = makeResult({
      name: 'challenger',
      cases: [makeCase('a', false), makeCase('b', true)],
    });
    const diff = compareRuns(baseline, challenger);
    expect(diff.paired).toBeDefined();
    expect(diff.paired!.totalPaired).toBe(2);
    expect(diff.paired!.bCount).toBe(1); // baseline-correct, challenger-wrong on 'a'
    expect(diff.paired!.cCount).toBe(1); // baseline-wrong, challenger-correct on 'b'
  });

  it('omits paired McNemar when either run has zero cases', () => {
    const empty = makeResult({ name: 'empty', cases: [] });
    const filled = makeResult({ name: 'filled', cases: [makeCase('a', true)] });
    const diff = compareRuns(empty, filled);
    expect(diff.paired).toBeUndefined();
  });
});
