/**
 * @file exportCsv.spec.ts
 * @description Unit tests for the CSV exporter.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  exportRunToCsv,
  renderCasesCsv,
  renderEvidenceCsv,
} from '../src/reporting/exportCsv.js';
import type { BenchResult, CaseResult } from '../src/index.js';

function makeResult(cases: CaseResult[]): BenchResult {
  return {
    benchmarkId: 'longmemeval-s',
    benchmarkVersion: '1.0.0',
    config: {
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'observe',
    },
    totalCases: cases.length,
    passedCases: cases.filter((c) => c.passed).length,
    accuracy: cases.filter((c) => c.passed).length / Math.max(1, cases.length),
    avgScore: cases.reduce((s, c) => s + c.score, 0) / Math.max(1, cases.length),
    scoreStdDev: 0,
    byType: {},
    avgLatencyMs: 0,
    p50LatencyMs: 0,
    p95LatencyMs: 0,
    totalReaderTokens: 0,
    totalUsd: 0,
    costPerCorrect: 0,
    startedAt: '2026-04-19T00:00:00Z',
    completedAt: '2026-04-19T00:00:01Z',
    cases,
  };
}

describe('exportCsv', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-csv-'));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('renders one case row per result with the expected headers', () => {
    const csv = renderCasesCsv(
      makeResult([
        {
          caseId: 'c1',
          actualOutput: 'Paris',
          latencyMs: 123,
          tokensIn: 100,
          tokensOut: 20,
          usd: 0.01,
          metadata: { caseType: 'single-session-user', recalledTraces: 5 },
          score: 1,
          passed: true,
          scoreMetadata: { reasoning: 'yes', rubricVersion: '2026-04-18.1' },
        },
      ]),
    );
    const lines = csv.split('\n').filter(Boolean);
    expect(lines[0]).toContain('case_id');
    expect(lines[0]).toContain('judge_reasoning');
    expect(lines[0]).toContain('recalled_traces');
    expect(lines[1]).toContain('"c1"');
    expect(lines[1]).toContain('"true"');
    expect(lines[1]).toContain('"single-session-user"');
    expect(lines[1]).toContain('"2026-04-18.1"');
  });

  it('escapes double quotes, commas, and newlines per RFC 4180', () => {
    const csv = renderCasesCsv(
      makeResult([
        {
          caseId: 'c1',
          actualOutput: 'He said, "hello" then newline\nafter',
          latencyMs: 1,
          tokensIn: 0,
          tokensOut: 0,
          usd: 0,
          score: 1,
          passed: true,
        },
      ]),
    );
    expect(csv).toContain('"He said, ""hello"" then newline\nafter"');
  });

  it('emits an evidence row per retrieved trace', () => {
    const csv = renderEvidenceCsv(
      makeResult([
        {
          caseId: 'c1',
          actualOutput: 'ok',
          latencyMs: 0,
          tokensIn: 0,
          tokensOut: 0,
          usd: 0,
          metadata: {
            caseType: 'multi-session',
            retrievedEvidence: [
              { id: 't-1', score: 0.92, snippet: 'Coffee order is oat flat white' },
              { id: 't-2', score: 0.80, snippet: 'Second most relevant snippet' },
            ],
          },
          score: 1,
          passed: true,
        },
      ]),
    );
    const lines = csv.split('\n').filter(Boolean);
    // header + 2 rows
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"c1"');
    expect(lines[1]).toContain('"1"');
    expect(lines[1]).toContain('"t-1"');
    expect(lines[2]).toContain('"2"');
    expect(lines[2]).toContain('"t-2"');
  });

  it('emits only the header when no cases record retrievedEvidence', () => {
    const csv = renderEvidenceCsv(
      makeResult([
        { caseId: 'c1', actualOutput: '', latencyMs: 0, tokensIn: 0, tokensOut: 0, usd: 0, score: 0, passed: false },
      ]),
    );
    const lines = csv.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it('exportRunToCsv writes both files and returns their paths', async () => {
    const prefix = path.join(tmpRoot, 'out');
    const result = makeResult([
      {
        caseId: 'c1',
        actualOutput: 'answer',
        latencyMs: 10,
        tokensIn: 10,
        tokensOut: 5,
        usd: 0.001,
        metadata: {
          caseType: 'single-session-user',
          retrievedEvidence: [{ id: 't', score: 0.5, snippet: 'excerpt' }],
        },
        score: 1,
        passed: true,
      },
    ]);
    const { casesPath, evidencePath } = await exportRunToCsv(result, prefix);
    expect(casesPath).toBe(`${prefix}-cases.csv`);
    expect(evidencePath).toBe(`${prefix}-evidence.csv`);

    const cases = await fs.readFile(casesPath, 'utf8');
    const evidence = await fs.readFile(evidencePath, 'utf8');
    expect(cases).toContain('case_id');
    expect(cases).toContain('c1');
    expect(evidence).toContain('trace_id');
    expect(evidence).toContain('excerpt');
  });
});
