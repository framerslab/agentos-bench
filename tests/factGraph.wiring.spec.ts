/**
 * @file factGraph.wiring.spec.ts
 * @description Cross-task wiring contracts for the Step 9 fact-graph
 * rollout. Each section pins one contract (evidence-provenance
 * aggregation, stage-level metrics, RunConfig propagation, etc.) that
 * later tasks fulfill. The full integration path runs through the
 * LongMemEvalS integration spec with a MockReader fixture.
 */

import { describe, it, expect } from 'vitest';
import { computeEvidenceProvenance } from '../src/core/metrics/computeEvidenceProvenance.js';
import {
  resolveRunConfig,
  computeCaseRunKeyParts,
} from '../src/core/BenchmarkRunner.js';
import { hashKey } from '../src/core/Cache.js';
import type { RunConfig } from '../src/core/IBenchmark.js';

describe('evidence-provenance aggregator contract (Task 4)', () => {
  it('counts source types across cases with non-null evidenceUsed', () => {
    const cases: Array<{ evidenceUsed?: { sourceType: string } | null }> = [
      { evidenceUsed: { sourceType: 'raw_chunk' } },
      { evidenceUsed: { sourceType: 'raw_chunk' } },
      { evidenceUsed: { sourceType: 'fact_graph' } },
      { evidenceUsed: null }, // ran provenance, no match
    ];
    const aggregate = cases.reduce<Record<string, number>>((acc, c) => {
      if (c.evidenceUsed === undefined) return acc;
      const key = c.evidenceUsed?.sourceType ?? 'none';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    expect(aggregate).toEqual({ raw_chunk: 2, fact_graph: 1, none: 1 });
  });

  it('skips cases where evidenceUsed is undefined (pass not run)', () => {
    const cases: Array<{ evidenceUsed?: { sourceType: string } | null }> = [
      { evidenceUsed: undefined },
      { evidenceUsed: { sourceType: 'raw_chunk' } },
    ];
    let participating = 0;
    for (const c of cases) if (c.evidenceUsed !== undefined) participating++;
    expect(participating).toBe(1);
  });

  it('invokes computeEvidenceProvenance with a mixed-source top-K', () => {
    const traces = [
      { id: 't1', content: 'Berlin residence', sourceType: 'raw_chunk' },
      { id: 't2', content: 'user livesIn Berlin', sourceType: 'fact_graph' },
    ];
    const result = computeEvidenceProvenance('user livesIn Berlin', traces, 3);
    expect(result!.traceId).toBe('t2');
    expect(result!.sourceType).toBe('fact_graph');
  });
});

describe('RunConfig.factGraphIngest propagation + cache-key + mutex (Task 13)', () => {
  const baseConfig: RunConfig = {
    reader: 'gpt-4o',
    memoryMode: 'full-cognitive',
    replayMode: 'ingest',
  };
  const fixture = {
    benchmarkId: 'longmemeval-s',
    benchmarkVersion: '1.0.0',
    caseId: 'c1',
    judgeModel: 'gpt-4o',
    judgeRubricVersion: '2026-04-18.1',
  };

  it('propagates factGraphIngest through resolveRunConfig', () => {
    const cfg = resolveRunConfig({ ...baseConfig, factGraphIngest: true });
    expect(cfg.factGraphIngest).toBe(true);
    const unset = resolveRunConfig(baseConfig);
    expect(unset.factGraphIngest).toBeUndefined();
  });

  it('distinct factGraphIngest produces distinct cache keys', () => {
    const on = resolveRunConfig({ ...baseConfig, factGraphIngest: true });
    const off = resolveRunConfig(baseConfig);
    const { runKeyParts: partsOn } = computeCaseRunKeyParts(on, fixture);
    const { runKeyParts: partsOff } = computeCaseRunKeyParts(off, fixture);
    expect(hashKey(...partsOn)).not.toBe(hashKey(...partsOff));
  });

  it('factGraphIngest unset preserves pre-change cache key (conditional append)', () => {
    const off = resolveRunConfig(baseConfig);
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(off, fixture);
    expect(runKeyParts.map(String).join('|')).not.toContain('fact-graph-ingest:');
    expect(resultKeyParts.map(String).join('|')).not.toContain('fact-graph-ingest:');
  });

  it('mutex: rejects factGraphIngest combined with observerReflector', () => {
    expect(() =>
      resolveRunConfig({
        ...baseConfig,
        factGraphIngest: true,
        observerReflector: true,
      }),
    ).toThrow(/mutually exclusive/i);
  });

  it('mutex: rejects factGraphIngest combined with observerReflectorReplace', () => {
    expect(() =>
      resolveRunConfig({
        ...baseConfig,
        factGraphIngest: true,
        observerReflector: true,
        observerReflectorReplace: true,
      }),
    ).toThrow(/mutually exclusive/i);
  });

  it('factGraphIngest alone (without observer flags) resolves cleanly', () => {
    const cfg = resolveRunConfig({ ...baseConfig, factGraphIngest: true });
    expect(cfg.factGraphIngest).toBe(true);
    expect(cfg.observerReflector).toBeUndefined();
  });
});
