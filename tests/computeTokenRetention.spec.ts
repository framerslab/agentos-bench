import { describe, it, expect } from 'vitest';
import { computeTokenRetention } from '../src/core/metrics/computeTokenRetention.js';
import type { CaseResult } from '../src/core/IBenchmark.js';

function makeCase(opts: {
  caseId: string;
  type: string;
  expected: string;
  actualOutput: string;
  omFinalLog?: string;
  retrievedEvidence?: { id?: string; content?: string }[];
}): CaseResult {
  return {
    caseId: opts.caseId,
    actualOutput: opts.actualOutput,
    latencyMs: 0,
    tokensIn: 0,
    tokensOut: 0,
    usd: 0,
    score: 1,
    passed: true,
    metadata: {
      ...(opts.omFinalLog !== undefined ? { omFinalLog: opts.omFinalLog } : {}),
      ...(opts.retrievedEvidence !== undefined
        ? { retrievedEvidence: opts.retrievedEvidence }
        : {}),
      expected: opts.expected,
      type: opts.type,
    },
  };
}

describe('computeTokenRetention', () => {
  it('computes per-case retention when only retrievedEvidence is present (canonical)', () => {
    const cases = [
      makeCase({
        caseId: 'c1',
        type: 'multi-session',
        expected: 'Berlin Acme 2024 engineer',
        actualOutput: 'Berlin Acme 2024 engineer',
        retrievedEvidence: [
          { id: 'p1', content: 'User moved to Berlin to work at Acme in 2024 as an engineer.' },
        ],
      }),
    ];
    const result = computeTokenRetention({ cases, bootstrapResamples: 100, seed: 42 });
    expect(result.perCategory['multi-session'].rawToRetrieved).toBeDefined();
    expect(result.perCategory['multi-session'].rawToRetrieved!.retention.value).toBe(1);
    expect(result.perCategory['multi-session'].observerToReader).toBeUndefined();
  });

  it('computes observer-route retention when omFinalLog is present', () => {
    const cases = [
      makeCase({
        caseId: 'c2',
        type: 'knowledge-update',
        expected: 'Berlin Acme 2024 engineer',
        actualOutput: 'Berlin Acme 2024 engineer',
        omFinalLog: 'Date: 2024. User moved to Berlin to work at Acme as engineer.',
      }),
    ];
    const result = computeTokenRetention({ cases, bootstrapResamples: 100, seed: 42 });
    expect(result.perCategory['knowledge-update'].rawToObserver).toBeDefined();
    expect(result.perCategory['knowledge-update'].rawToObserver!.retention.value).toBe(1);
    expect(result.perCategory['knowledge-update'].observerToReader!.retention.value).toBe(1);
  });

  it('flags cases with zero high-IDF tokens as excluded', () => {
    // 'yes' is a stopword, 'a' is filtered by min-length=2 since "a"
    // is only 1 char. After filtering, gold answer has 0 tokens.
    // MIN_TOKENS_PER_CASE = 1 excludes it; the excluded list carries
    // the diagnostic info for audit.
    const cases = [
      makeCase({
        caseId: 'c3',
        type: 'temporal-reasoning',
        expected: 'yes a',
        actualOutput: 'yes',
        retrievedEvidence: [{ id: 'p1', content: 'yes' }],
      }),
    ];
    const result = computeTokenRetention({ cases, bootstrapResamples: 100, seed: 42 });
    expect(result.excluded).toEqual([
      { caseId: 'c3', category: 'temporal-reasoning', tokenCount: 0 },
    ]);
  });

  it('computes overall retention across categories', () => {
    const cases = [
      makeCase({
        caseId: 'c1',
        type: 'multi-session',
        expected: 'Berlin Acme 2024 engineer',
        actualOutput: 'Berlin Acme 2024 engineer',
        retrievedEvidence: [{ id: 'p1', content: 'Berlin Acme 2024 engineer' }],
      }),
      makeCase({
        caseId: 'c2',
        type: 'knowledge-update',
        expected: 'Paris Bistro 2025 chef',
        actualOutput: 'Paris Bistro 2025 chef',
        retrievedEvidence: [{ id: 'p2', content: 'Paris Bistro 2025 chef' }],
      }),
    ];
    const result = computeTokenRetention({ cases, bootstrapResamples: 100, seed: 42 });
    expect(result.overall.e2eRetention.retention.value).toBe(1);
    expect(result.overall.e2eRetention.n).toBe(2);
  });

  it('handles cases with neither omFinalLog nor retrievedEvidence (e2e only)', () => {
    const cases = [
      makeCase({
        caseId: 'c4',
        type: 'single-session-user',
        expected: 'Berlin Acme 2024 engineer',
        actualOutput: 'Berlin Acme 2024 engineer',
      }),
    ];
    const result = computeTokenRetention({ cases, bootstrapResamples: 100, seed: 42 });
    expect(result.perCategory['single-session-user'].e2eRetention.retention.value).toBe(1);
    expect(result.perCategory['single-session-user'].rawToObserver).toBeUndefined();
    expect(result.perCategory['single-session-user'].rawToRetrieved).toBeUndefined();
  });

  it('emits perCorrectness split when cases include both passed and failed', () => {
    const cases = [
      makeCase({
        caseId: 'pass-1',
        type: 'knowledge-update',
        expected: 'Berlin Acme 2024 engineer',
        actualOutput: 'Berlin Acme 2024 engineer',
        retrievedEvidence: [{ id: 'p1', content: 'Berlin Acme 2024 engineer' }],
      }),
      // Mark the failing case explicitly so per-correctness has both buckets.
      {
        ...makeCase({
          caseId: 'fail-1',
          type: 'knowledge-update',
          expected: 'Paris Bistro 2025 chef',
          actualOutput: 'something completely unrelated',
          retrievedEvidence: [{ id: 'p2', content: 'Paris Bistro 2025 chef' }],
        }),
        passed: false,
      },
    ];
    const result = computeTokenRetention({
      cases,
      bootstrapResamples: 100,
      seed: 42,
    });
    expect(result.perCorrectness).toBeDefined();
    const ku = result.perCorrectness!.perCategory['knowledge-update'];
    expect(ku.whenCorrect.e2eRetention.n).toBe(1);
    expect(ku.whenWrong.e2eRetention.n).toBe(1);
    // Correct case has the gold tokens in the answer; wrong case doesn't.
    expect(ku.whenCorrect.e2eRetention.retention.value).toBeGreaterThan(
      ku.whenWrong.e2eRetention.retention.value,
    );
  });

  it('omits perCorrectness when no cases qualify for any bucket', () => {
    // Only excluded cases (zero high-IDF tokens) - no per-category data.
    const cases = [
      makeCase({
        caseId: 'excl-1',
        type: 'temporal-reasoning',
        expected: 'a',
        actualOutput: 'a',
        retrievedEvidence: [{ id: 'p1', content: 'a' }],
      }),
    ];
    const result = computeTokenRetention({
      cases,
      bootstrapResamples: 100,
      seed: 42,
    });
    expect(result.perCorrectness).toBeUndefined();
  });

  it('reads metadata.caseType when metadata.type is absent (legacy alias)', () => {
    // Earlier runs from the bench wrote `caseType` instead of `type` into
    // runMetadata. The aggregator must accept either so retention can be
    // computed against pre-Step-18 cached run JSONs without re-running.
    const legacyCase: CaseResult = {
      caseId: 'legacy-1',
      actualOutput: 'Berlin Acme 2024 engineer',
      latencyMs: 0,
      tokensIn: 0,
      tokensOut: 0,
      usd: 0,
      score: 1,
      passed: true,
      metadata: {
        caseType: 'multi-session',
        expected: 'Berlin Acme 2024 engineer',
        retrievedEvidence: [
          { id: 'p1', content: 'Berlin Acme 2024 engineer' },
        ],
      },
    };
    const result = computeTokenRetention({
      cases: [legacyCase],
      bootstrapResamples: 100,
      seed: 42,
    });
    expect(result.perCategory['multi-session']).toBeDefined();
    expect(result.perCategory['multi-session'].e2eRetention.retention.value).toBe(1);
  });
});
