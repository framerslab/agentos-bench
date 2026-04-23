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

  it('whenWrong collapses to empty-bucket sentinel when all cases passed', () => {
    // Per coderabbit M5: lock the documented empty-bucket contract for
    // the per-correctness split. When ALL cases in a category are
    // passed=true, the whenWrong bucket has no data; the aggregator
    // returns an empty-bucket sentinel (n=0, e2e=0) rather than
    // undefined or NaN, so consumers can index `.whenWrong.e2eRetention`
    // without null checks.
    const cases = [
      makeCase({
        caseId: 'pass-only-1',
        type: 'knowledge-update',
        expected: 'Berlin Acme 2024 engineer',
        actualOutput: 'Berlin Acme 2024 engineer',
        retrievedEvidence: [{ id: 'p1', content: 'Berlin Acme 2024 engineer' }],
      }),
      makeCase({
        caseId: 'pass-only-2',
        type: 'knowledge-update',
        expected: 'Paris Bistro 2025 chef',
        actualOutput: 'Paris Bistro 2025 chef',
        retrievedEvidence: [{ id: 'p2', content: 'Paris Bistro 2025 chef' }],
      }),
    ];
    const result = computeTokenRetention({ cases, bootstrapResamples: 100, seed: 42 });
    expect(result.perCorrectness).toBeDefined();
    const ku = result.perCorrectness!.perCategory['knowledge-update'];
    expect(ku.whenCorrect.e2eRetention.n).toBe(2);
    expect(ku.whenCorrect.e2eRetention.retention.value).toBe(1);
    // Empty-bucket sentinel contract: n=0, retention.value=0, no per-stage rates.
    expect(ku.whenWrong.e2eRetention.n).toBe(0);
    expect(ku.whenWrong.e2eRetention.retention.value).toBe(0);
    expect(ku.whenWrong.rawToObserver).toBeUndefined();
    expect(ku.whenWrong.rawToRetrieved).toBeUndefined();
    expect(ku.whenWrong.observerToReader).toBeUndefined();
    expect(ku.whenWrong.retrievedToReader).toBeUndefined();
    // Overall whenWrong should also be the empty-bucket sentinel.
    expect(result.perCorrectness!.overall.whenWrong.e2eRetention.n).toBe(0);
    expect(result.perCorrectness!.overall.whenCorrect.e2eRetention.n).toBe(2);
  });

  it('whenCorrect collapses to empty-bucket sentinel when all cases failed', () => {
    // Mirror image of the all-passed test: when ALL cases are failures,
    // whenCorrect bucket gets the sentinel and whenWrong has the data.
    const cases = [
      {
        ...makeCase({
          caseId: 'fail-only-1',
          type: 'multi-session',
          expected: 'Berlin Acme 2024 engineer',
          actualOutput: 'completely unrelated answer',
          retrievedEvidence: [{ id: 'p1', content: 'Berlin Acme 2024 engineer' }],
        }),
        passed: false,
      },
      {
        ...makeCase({
          caseId: 'fail-only-2',
          type: 'multi-session',
          expected: 'Paris Bistro 2025 chef',
          actualOutput: 'another wrong answer',
          retrievedEvidence: [{ id: 'p2', content: 'Paris Bistro 2025 chef' }],
        }),
        passed: false,
      },
    ];
    const result = computeTokenRetention({ cases, bootstrapResamples: 100, seed: 42 });
    expect(result.perCorrectness).toBeDefined();
    const ms = result.perCorrectness!.perCategory['multi-session'];
    expect(ms.whenWrong.e2eRetention.n).toBe(2);
    // Wrong-case retention is 0 — the answer doesn't contain any gold tokens.
    expect(ms.whenWrong.e2eRetention.retention.value).toBe(0);
    // Empty-bucket sentinel for the absent whenCorrect bucket.
    expect(ms.whenCorrect.e2eRetention.n).toBe(0);
    expect(ms.whenCorrect.e2eRetention.retention.value).toBe(0);
    expect(ms.whenCorrect.rawToRetrieved).toBeUndefined();
    expect(result.perCorrectness!.overall.whenCorrect.e2eRetention.n).toBe(0);
    expect(result.perCorrectness!.overall.whenWrong.e2eRetention.n).toBe(2);
  });

  it('per-category empty-bucket sentinel applies independently across categories', () => {
    // One category has only correct cases; another has only wrong cases.
    // Each category's per-correctness structure should reflect its own
    // bucket population (not blended).
    const cases = [
      makeCase({
        caseId: 'ku-pass',
        type: 'knowledge-update',
        expected: 'Berlin Acme 2024 engineer',
        actualOutput: 'Berlin Acme 2024 engineer',
        retrievedEvidence: [{ id: 'p1', content: 'Berlin Acme 2024 engineer' }],
      }),
      {
        ...makeCase({
          caseId: 'ms-fail',
          type: 'multi-session',
          expected: 'Paris Bistro 2025 chef',
          actualOutput: 'wrong answer with no gold tokens',
          retrievedEvidence: [{ id: 'p2', content: 'Paris Bistro 2025 chef' }],
        }),
        passed: false,
      },
    ];
    const result = computeTokenRetention({ cases, bootstrapResamples: 100, seed: 42 });
    const ku = result.perCorrectness!.perCategory['knowledge-update'];
    const ms = result.perCorrectness!.perCategory['multi-session'];
    // KU has only correct: whenWrong is empty sentinel.
    expect(ku.whenCorrect.e2eRetention.n).toBe(1);
    expect(ku.whenWrong.e2eRetention.n).toBe(0);
    // MS has only wrong: whenCorrect is empty sentinel.
    expect(ms.whenWrong.e2eRetention.n).toBe(1);
    expect(ms.whenCorrect.e2eRetention.n).toBe(0);
    // Overall: 1 correct (from KU), 1 wrong (from MS).
    expect(result.perCorrectness!.overall.whenCorrect.e2eRetention.n).toBe(1);
    expect(result.perCorrectness!.overall.whenWrong.e2eRetention.n).toBe(1);
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
