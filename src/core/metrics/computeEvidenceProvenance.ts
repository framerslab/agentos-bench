/**
 * @file computeEvidenceProvenance.ts
 * @description Shingle-based overlap matcher: given a reader's answer and
 * the top-K retrieved traces (final stage, post-rerank), find the trace
 * whose content contributes the most verbatim word-shingles to the
 * answer. Output powers the `evidenceOrigin` diagnostic, which tells
 * fact-graph synthetic traces apart from raw chunks on Step 9.
 *
 * Tokenization: whitespace split on a lowercased, punctuation-stripped
 * form. Shingles are consecutive n-grams (default n=3). Ties in overlap
 * count resolve first-match-wins by trace iteration order.
 *
 * @module agentos-bench/core/metrics/computeEvidenceProvenance
 */

export interface EvidenceProvenance {
  /** ID of the retrieved trace with maximum shingle overlap. */
  traceId: string;
  /** Source type carried from the trace's provenance. */
  sourceType: string;
  /** Number of distinct shingles shared between answer and trace content. */
  overlapScore: number;
}

export interface EvidenceTrace {
  id: string;
  content: string;
  sourceType: string;
}

/**
 * Compute word-level n-gram overlap between `answer` and each retrieved
 * trace, return the trace with the highest overlap count. Returns null
 * on empty answer or zero overlap across all traces.
 */
export function computeEvidenceProvenance(
  answer: string,
  traces: readonly EvidenceTrace[],
  n: number,
): EvidenceProvenance | null {
  const answerShingles = shingles(answer, n);
  if (answerShingles.size === 0) return null;

  let best: EvidenceProvenance | null = null;
  for (const trace of traces) {
    const traceShingles = shingles(trace.content, n);
    let overlap = 0;
    for (const s of traceShingles) {
      if (answerShingles.has(s)) overlap++;
    }
    if (overlap === 0) continue;
    if (!best || overlap > best.overlapScore) {
      best = { traceId: trace.id, sourceType: trace.sourceType, overlapScore: overlap };
    }
  }
  return best;
}

function shingles(text: string, n: number): Set<string> {
  const out = new Set<string>();
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length < n) return out;
  for (let i = 0; i <= words.length - n; i++) {
    out.add(words.slice(i, i + n).join(' '));
  }
  return out;
}
