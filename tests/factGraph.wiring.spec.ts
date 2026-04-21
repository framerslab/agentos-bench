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
