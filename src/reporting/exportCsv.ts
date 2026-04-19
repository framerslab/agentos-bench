/**
 * @file exportCsv.ts
 * @description Export a completed {@link BenchResult} as tabular CSVs.
 *
 * Two outputs per invocation:
 *   - `<out>-cases.csv`    — one row per case: id, type, accuracy,
 *     score, latency, tokens, USD, judge reasoning, and a compact
 *     snippet of retrieved evidence (rank / score / content excerpt).
 *   - `<out>-evidence.csv` — normalised form of the retrieved-memory
 *     trail, one row per `(caseId, rank)` pair. Useful for
 *     spreadsheet-style audit of what memory returned for each
 *     question.
 *
 * Escaping: double quotes, commas, newlines and CR characters are
 * handled per RFC 4180 — every field is wrapped in double quotes with
 * embedded quotes doubled.
 *
 * @module agentos-bench/reporting/exportCsv
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BenchResult, CaseResult } from '../core/IBenchmark.js';

/**
 * Write the two CSVs and return the relative paths that were written.
 */
export async function exportRunToCsv(
  result: BenchResult,
  outPrefix: string,
): Promise<{ casesPath: string; evidencePath: string }> {
  const casesPath = `${outPrefix}-cases.csv`;
  const evidencePath = `${outPrefix}-evidence.csv`;

  await fs.mkdir(path.dirname(casesPath), { recursive: true });
  await fs.writeFile(casesPath, renderCasesCsv(result));
  await fs.writeFile(evidencePath, renderEvidenceCsv(result));

  return { casesPath, evidencePath };
}

/**
 * Render the per-case CSV as a string. Exported for testing.
 */
export function renderCasesCsv(result: BenchResult): string {
  const headers = [
    'case_id',
    'case_type',
    'passed',
    'score',
    'latency_ms',
    'reader_tokens_in',
    'reader_tokens_out',
    'reader_usd',
    'working_memory_slots',
    'recalled_traces',
    'observations_emitted',
    'actual_output',
    'judge_reasoning',
    'judge_rubric_version',
    'error',
  ];
  const rows = result.cases.map((c) => [
    c.caseId,
    (c.metadata as { caseType?: string } | undefined)?.caseType ?? '',
    c.passed ? 'true' : 'false',
    c.score.toFixed(4),
    c.latencyMs.toFixed(1),
    String(c.tokensIn),
    String(c.tokensOut),
    c.usd.toFixed(6),
    cellNum((c.metadata as Record<string, unknown> | undefined)?.workingMemorySlots),
    cellNum((c.metadata as Record<string, unknown> | undefined)?.recalledTraces),
    cellNum((c.metadata as Record<string, unknown> | undefined)?.observationsEmitted),
    c.actualOutput,
    (c.scoreMetadata as { reasoning?: string } | undefined)?.reasoning ?? '',
    (c.scoreMetadata as { rubricVersion?: string } | undefined)?.rubricVersion ?? '',
    c.error ?? '',
  ]);
  return toCsv([headers, ...rows]);
}

/**
 * Render the per-retrieval-row evidence CSV as a string. Exported for
 * testing. Produces zero rows when the benchmark didn't record any
 * `retrievedEvidence` (e.g. memoryMode=none / base-memory paths).
 */
export function renderEvidenceCsv(result: BenchResult): string {
  const headers = [
    'case_id',
    'case_type',
    'rank',
    'trace_id',
    'retrieval_score',
    'snippet',
  ];
  const rows: string[][] = [];
  for (const c of result.cases) {
    const meta = c.metadata as
      | { caseType?: string; retrievedEvidence?: Array<{ id: string; score: number; snippet: string }> }
      | undefined;
    const evidence = meta?.retrievedEvidence;
    if (!evidence || evidence.length === 0) continue;
    for (let i = 0; i < evidence.length; i++) {
      const e = evidence[i]!;
      rows.push([c.caseId, meta?.caseType ?? '', String(i + 1), e.id, e.score.toFixed(4), e.snippet]);
    }
  }
  return toCsv([headers, ...rows]);
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(escapeCell).join(',')).join('\n') + '\n';
}

function escapeCell(v: string): string {
  const needsQuoting = /[",\n\r]/.test(v);
  const escaped = v.replace(/"/g, '""');
  return needsQuoting ? `"${escaped}"` : `"${escaped}"`;
  // Double-quote everything unconditionally for RFC-4180 safety; the
  // `needsQuoting` check is kept for potential future minimal-output
  // toggling but we prefer predictable parsing over small files.
}

function cellNum(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toString() : '';
}
