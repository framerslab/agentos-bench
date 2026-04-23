/**
 * @file computeTokenRetention.integration.spec.ts
 * @description Smoke test: load an existing pre-Step-18 run JSON and
 * confirm the aggregator gracefully handles legacy cases that lack the
 * new `metadata.expected` and `metadata.omFinalLog` keys. The pre-
 * Step-18 v10 Phase B run (2026-04-23T04-14-40-609) was written before
 * the runner started populating these keys, so most legacy cases will
 * appear in the `excluded` list (zero high-IDF tokens after filtering
 * a missing `expected`). The smoke validates the fallback path before
 * Phase 2 fires real LLM-cost runs against the new instrumentation.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeTokenRetention } from '../src/core/metrics/computeTokenRetention.js';
import type { CaseResult } from '../src/core/IBenchmark.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const LEGACY_V10_PHASE_B_RUN = join(
  __dirname,
  '..',
  'results',
  'runs',
  '2026-04-23T04-14-40-609--longmemeval-s--gpt-4o--full-cognitive--ingest.json',
);

describe('computeTokenRetention integration smoke against legacy run JSON', () => {
  it('aggregates without throwing on a pre-Step-18 v10 Phase B run', () => {
    const run = JSON.parse(readFileSync(LEGACY_V10_PHASE_B_RUN, 'utf8')) as {
      cases: CaseResult[];
    };
    expect(Array.isArray(run.cases)).toBe(true);
    expect(run.cases.length).toBeGreaterThan(0);

    const result = computeTokenRetention({
      cases: run.cases,
      bootstrapResamples: 100,
      seed: 42,
    });

    // The aggregator must always return a result object with the
    // documented shape, even when every case lacks the new metadata.
    expect(result).toBeDefined();
    expect(result.perCategory).toBeDefined();
    expect(result.overall).toBeDefined();
    expect(result.overall.e2eRetention).toBeDefined();
    expect(typeof result.overall.e2eRetention.n).toBe('number');
    expect(typeof result.overall.e2eRetention.retention.value).toBe('number');
    expect(Array.isArray(result.excluded)).toBe(true);
  });

  it('excludes legacy cases where metadata.expected is missing (no high-IDF tokens to score)', () => {
    const run = JSON.parse(readFileSync(LEGACY_V10_PHASE_B_RUN, 'utf8')) as {
      cases: CaseResult[];
    };
    const result = computeTokenRetention({
      cases: run.cases,
      bootstrapResamples: 100,
      seed: 42,
    });

    const totalCases = run.cases.length;
    const includedCases = Object.values(result.perCategory).reduce(
      (sum, cat) => sum + (cat.e2eRetention.n ?? 0),
      0,
    );
    const excludedCases = result.excluded.length;

    // Every case is accounted for: either included in a per-category
    // bucket or listed in `excluded`.
    expect(includedCases + excludedCases).toBe(totalCases);

    // Pre-Step-18 cases lack metadata.expected, so the aggregator
    // produces excluded entries with tokenCount=0 for each. Confirm
    // the exclusion shape so future regressions surface.
    if (excludedCases > 0) {
      expect(result.excluded[0]).toMatchObject({
        caseId: expect.any(String),
        category: expect.any(String),
        tokenCount: expect.any(Number),
      });
    }
  });
});
