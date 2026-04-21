/**
 * @file compareRuns.ts
 * @description Diff two completed {@link BenchResult}s and return a
 * {@link RunComparison}.
 *
 * The comparison is intentionally pure data (no I/O), so callers can
 * render it however they like. The CLI `compare` subcommand renders it
 * as Markdown.
 *
 * Semantics:
 *   - `winner`: 'challenger' when `challenger.accuracy > baseline.accuracy`,
 *     'baseline' when the reverse, 'tie' when exactly equal. Ties-by-
 *     accuracy can still surface meaningful regressions / improvements
 *     under the hood (same accuracy with different cases flipping).
 *   - `regressions`: cases that the baseline got right but the challenger
 *     got wrong.
 *   - `improvements`: cases that the baseline got wrong but the challenger
 *     got right.
 *   - `unchanged`: count of cases with the same passed/failed outcome.
 *   - `byType`: per-case-type accuracy delta.
 *   - `unmatched`: case-id sets only present on one side (when
 *     --sample N or dataset drift produces different case sets).
 *
 * @module agentos-bench/core/compareRuns
 */

import type { BenchResult, CaseResult } from './IBenchmark.js';
import { computePairedMcNemar, type McNemarResult } from './metrics/computePairedMcNemar.js';

/**
 * Which side of the comparison came out ahead on the headline metric.
 */
export type ComparisonWinner = 'baseline' | 'challenger' | 'tie';

/**
 * Per-case-type accuracy/score delta entry.
 */
export interface TypeComparison {
  type: string;
  baselineN: number;
  challengerN: number;
  baselineAccuracy: number;
  challengerAccuracy: number;
  deltaAccuracy: number;
  baselineAvgScore: number;
  challengerAvgScore: number;
  deltaAvgScore: number;
}

/**
 * Compact per-case diff entry surfaced in `improvements` / `regressions`.
 */
export interface CaseDelta {
  caseId: string;
  caseType?: string;
  baselinePassed: boolean;
  challengerPassed: boolean;
  baselineScore: number;
  challengerScore: number;
}

/**
 * Set of case IDs present on one side but not the other.
 */
export interface UnmatchedCases {
  onlyInBaseline: string[];
  onlyInChallenger: string[];
}

/**
 * Full pairwise comparison of two benchmark runs.
 */
export interface RunComparison {
  baselineId: string;
  challengerId: string;
  benchmarkId: string;
  winner: ComparisonWinner;
  totalMatchedCases: number;
  unmatched: UnmatchedCases;
  baselineAccuracy: number;
  challengerAccuracy: number;
  deltaAccuracy: number;
  baselineAvgScore: number;
  challengerAvgScore: number;
  deltaAvgScore: number;
  deltaAvgLatencyMs: number;
  deltaTotalUsd: number;
  /** Signed delta: negative means challenger is cheaper per correct. */
  deltaCostPerCorrect: number;
  unchanged: number;
  regressions: CaseDelta[];
  improvements: CaseDelta[];
  byType: Record<string, TypeComparison>;
  /**
   * Paired McNemar significance result. Populated when both runs carry
   * cases, allowing run-to-run deltas to report a chi-squared statistic
   * and two-sided p-value in addition to the point-estimate delta.
   * Absent when either run has zero cases.
   */
  paired?: McNemarResult;
}

/**
 * Produce a {@link RunComparison} from two {@link BenchResult}s. Pure
 * function — no I/O.
 */
export function compareRuns(baseline: BenchResult, challenger: BenchResult): RunComparison {
  const baselineCases = indexByCaseId(baseline.cases);
  const challengerCases = indexByCaseId(challenger.cases);

  const baselineIds = new Set(baselineCases.keys());
  const challengerIds = new Set(challengerCases.keys());
  const matched = [...baselineIds].filter((id) => challengerIds.has(id));

  const regressions: CaseDelta[] = [];
  const improvements: CaseDelta[] = [];
  let unchanged = 0;

  for (const id of matched) {
    const a = baselineCases.get(id)!;
    const b = challengerCases.get(id)!;
    if (a.passed && !b.passed) regressions.push(caseDelta(id, a, b));
    else if (!a.passed && b.passed) improvements.push(caseDelta(id, a, b));
    else unchanged += 1;
  }

  const deltaAccuracy = challenger.accuracy - baseline.accuracy;
  const winner: ComparisonWinner =
    deltaAccuracy > 0 ? 'challenger' : deltaAccuracy < 0 ? 'baseline' : 'tie';

  return {
    baselineId: baseline.benchmarkId,
    challengerId: challenger.benchmarkId,
    benchmarkId: baseline.benchmarkId,
    winner,
    totalMatchedCases: matched.length,
    unmatched: {
      onlyInBaseline: [...baselineIds].filter((id) => !challengerIds.has(id)).sort(),
      onlyInChallenger: [...challengerIds].filter((id) => !baselineIds.has(id)).sort(),
    },
    baselineAccuracy: baseline.accuracy,
    challengerAccuracy: challenger.accuracy,
    deltaAccuracy,
    baselineAvgScore: baseline.avgScore,
    challengerAvgScore: challenger.avgScore,
    deltaAvgScore: challenger.avgScore - baseline.avgScore,
    deltaAvgLatencyMs: challenger.avgLatencyMs - baseline.avgLatencyMs,
    deltaTotalUsd: challenger.totalUsd - baseline.totalUsd,
    deltaCostPerCorrect: challenger.costPerCorrect - baseline.costPerCorrect,
    unchanged,
    regressions: regressions.sort((a, b) => a.caseId.localeCompare(b.caseId)),
    improvements: improvements.sort((a, b) => a.caseId.localeCompare(b.caseId)),
    byType: byTypeComparison(baseline, challenger),
    paired:
      baseline.cases.length > 0 && challenger.cases.length > 0
        ? computePairedMcNemar(baseline, challenger)
        : undefined,
  };
}

/**
 * Render a comparison as a Markdown snippet suitable for pasting into a
 * PR description or a blog post.
 */
export function formatComparisonMarkdown(diff: RunComparison): string {
  const deltaPct = (diff.deltaAccuracy * 100).toFixed(2);
  const winnerLabel =
    diff.winner === 'tie' ? 'Tie' : diff.winner === 'challenger' ? 'Challenger' : 'Baseline';

  const lines: string[] = [
    `# ${diff.benchmarkId} — comparison`,
    '',
    `Winner: **${winnerLabel}** (accuracy delta ${diff.deltaAccuracy >= 0 ? '+' : ''}${deltaPct}%)`,
    '',
    '| Metric | Baseline | Challenger | Δ |',
    '|---|---:|---:|---:|',
    `| Accuracy | ${(diff.baselineAccuracy * 100).toFixed(1)}% | ${(diff.challengerAccuracy * 100).toFixed(1)}% | ${signed(diff.deltaAccuracy * 100, 1, '%')} |`,
    `| Avg score | ${diff.baselineAvgScore.toFixed(3)} | ${diff.challengerAvgScore.toFixed(3)} | ${signed(diff.deltaAvgScore, 3)} |`,
    `| Avg latency (ms) | ${diff.deltaAvgLatencyMs + (diff.challengerAccuracy === 0 ? 0 : 0) /* keep stable */} | — | ${signed(diff.deltaAvgLatencyMs, 0, ' ms')} |`,
    `| Total USD | — | — | ${signed(diff.deltaTotalUsd, 4, ' $')} |`,
    `| $/correct | — | — | ${signed(diff.deltaCostPerCorrect, 4, ' $')} |`,
    '',
    `Regressions (baseline passed → challenger failed): **${diff.regressions.length}**`,
    `Improvements (baseline failed → challenger passed): **${diff.improvements.length}**`,
    `Unchanged: **${diff.unchanged}**`,
  ];

  if (diff.unmatched.onlyInBaseline.length || diff.unmatched.onlyInChallenger.length) {
    lines.push('', '## Unmatched cases');
    if (diff.unmatched.onlyInBaseline.length) {
      lines.push(`Only in baseline (${diff.unmatched.onlyInBaseline.length}): ${diff.unmatched.onlyInBaseline.slice(0, 10).join(', ')}${diff.unmatched.onlyInBaseline.length > 10 ? '…' : ''}`);
    }
    if (diff.unmatched.onlyInChallenger.length) {
      lines.push(`Only in challenger (${diff.unmatched.onlyInChallenger.length}): ${diff.unmatched.onlyInChallenger.slice(0, 10).join(', ')}${diff.unmatched.onlyInChallenger.length > 10 ? '…' : ''}`);
    }
  }

  const typeEntries = Object.values(diff.byType).sort((a, b) => a.type.localeCompare(b.type));
  if (typeEntries.length > 0) {
    lines.push('', '## By type', '', '| Type | Baseline | Challenger | Δ |', '|---|---:|---:|---:|');
    for (const t of typeEntries) {
      lines.push(
        `| ${t.type} | ${(t.baselineAccuracy * 100).toFixed(1)}% (n=${t.baselineN}) | ${(t.challengerAccuracy * 100).toFixed(1)}% (n=${t.challengerN}) | ${signed(t.deltaAccuracy * 100, 1, '%')} |`,
      );
    }
  }

  if (diff.regressions.length > 0) {
    lines.push('', '## Regressions', '', '| Case | Type | Baseline score | Challenger score |', '|---|---|---:|---:|');
    for (const r of diff.regressions.slice(0, 20)) {
      lines.push(`| ${r.caseId} | ${r.caseType ?? '—'} | ${r.baselineScore.toFixed(2)} | ${r.challengerScore.toFixed(2)} |`);
    }
    if (diff.regressions.length > 20) {
      lines.push(`_…plus ${diff.regressions.length - 20} more_`);
    }
  }

  if (diff.improvements.length > 0) {
    lines.push('', '## Improvements', '', '| Case | Type | Baseline score | Challenger score |', '|---|---|---:|---:|');
    for (const r of diff.improvements.slice(0, 20)) {
      lines.push(`| ${r.caseId} | ${r.caseType ?? '—'} | ${r.baselineScore.toFixed(2)} | ${r.challengerScore.toFixed(2)} |`);
    }
    if (diff.improvements.length > 20) {
      lines.push(`_…plus ${diff.improvements.length - 20} more_`);
    }
  }

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function indexByCaseId(cases: CaseResult[]): Map<string, CaseResult> {
  const map = new Map<string, CaseResult>();
  for (const c of cases) map.set(c.caseId, c);
  return map;
}

function caseDelta(
  caseId: string,
  baseline: CaseResult,
  challenger: CaseResult,
): CaseDelta {
  const caseType = ((baseline.metadata as Record<string, unknown> | undefined)?.caseType
    ?? (challenger.metadata as Record<string, unknown> | undefined)?.caseType) as string | undefined;
  return {
    caseId,
    caseType,
    baselinePassed: baseline.passed,
    challengerPassed: challenger.passed,
    baselineScore: baseline.score,
    challengerScore: challenger.score,
  };
}

function byTypeComparison(
  baseline: BenchResult,
  challenger: BenchResult,
): Record<string, TypeComparison> {
  const types = new Set([
    ...Object.keys(baseline.byType),
    ...Object.keys(challenger.byType),
  ]);
  const out: Record<string, TypeComparison> = {};
  for (const type of types) {
    const b = baseline.byType[type] ?? { n: 0, accuracy: 0, avgScore: 0 };
    const c = challenger.byType[type] ?? { n: 0, accuracy: 0, avgScore: 0 };
    out[type] = {
      type,
      baselineN: b.n,
      challengerN: c.n,
      baselineAccuracy: b.accuracy,
      challengerAccuracy: c.accuracy,
      deltaAccuracy: c.accuracy - b.accuracy,
      baselineAvgScore: b.avgScore,
      challengerAvgScore: c.avgScore,
      deltaAvgScore: c.avgScore - b.avgScore,
    };
  }
  return out;
}

function signed(n: number, digits: number, suffix = ''): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}${suffix}`;
}
