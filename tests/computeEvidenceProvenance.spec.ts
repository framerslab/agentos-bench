/**
 * @file computeEvidenceProvenance.spec.ts
 * @description Regression tests for the shingle-based evidence-provenance
 * matcher used to attribute a reader's answer to the max-overlap
 * retrieved trace. Pins: multi-trace max picks, first-match-wins on ties,
 * null-on-zero-overlap, empty-answer handling, case-insensitivity.
 */

import { describe, it, expect } from 'vitest';
import { computeEvidenceProvenance } from '../src/core/metrics/computeEvidenceProvenance.js';

describe('computeEvidenceProvenance', () => {
  const traces = [
    { id: 't1', content: 'User moved to Berlin on March 15', sourceType: 'raw_chunk' },
    { id: 't2', content: 'User enjoys cycling and cooking', sourceType: 'raw_chunk' },
    { id: 't3', content: 'user livesIn Berlin (as of 2024-03-15)', sourceType: 'fact_graph' },
  ];

  it('picks the max-overlap trace as evidence', () => {
    const answer = 'The user moved to Berlin in March 2024.';
    const result = computeEvidenceProvenance(answer, traces, 3);
    expect(result).toBeDefined();
    expect(result!.traceId).toBe('t1');
    expect(result!.sourceType).toBe('raw_chunk');
    expect(result!.overlapScore).toBeGreaterThan(0);
  });

  it('first-match-wins when shingle counts tie', () => {
    const tied = [
      { id: 'raw', content: 'alpha beta gamma', sourceType: 'raw_chunk' },
      { id: 'fg', content: 'alpha beta gamma', sourceType: 'fact_graph' },
    ];
    const result = computeEvidenceProvenance('alpha beta gamma', tied, 3);
    expect(result!.traceId).toBe('raw');
  });

  it('returns null on zero overlap', () => {
    const result = computeEvidenceProvenance('Completely unrelated text', traces, 3);
    expect(result).toBeNull();
  });

  it('handles empty answers', () => {
    expect(computeEvidenceProvenance('', traces, 3)).toBeNull();
  });

  it('is case-insensitive on word shingles', () => {
    const answer = 'THE USER MOVED TO BERLIN';
    const result = computeEvidenceProvenance(answer, traces, 3);
    expect(result!.traceId).toBe('t1');
  });

  it('strips punctuation on tokenization', () => {
    const answer = 'user, moved to Berlin.';
    const result = computeEvidenceProvenance(answer, traces, 3);
    expect(result!.traceId).toBe('t1');
  });
});
