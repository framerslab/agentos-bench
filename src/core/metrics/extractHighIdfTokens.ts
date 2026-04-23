/**
 * @file extractHighIdfTokens.ts
 * @description Heuristic high-IDF token extractor. Used by the
 * token-retention metric to derive the per-case set of tokens worth
 * tracking through the pipeline (raw conversation -> observer log /
 * retrieved passages -> reader answer).
 *
 * Heuristic v1: NFKD normalize, lowercase, strip punctuation, split on
 * hyphens and whitespace, drop English stopwords, drop tokens shorter
 * than 2 characters. The 2-char minimum keeps short numeric tokens
 * like "25" / "50" / "3x" / "pm" that appear in LongMemEval-S gold
 * answers ("$400,000", "25 minutes", "3"), while the stoplist (which
 * includes "is", "we", "he", "to", "of", etc.) filters short function
 * words. Measured empirically on a canonical Tier A N=24 run: with
 * MIN_TOKEN_LENGTH=4 the heuristic dropped 14/24 cases (including all
 * knowledge-update answers); MIN_TOKEN_LENGTH=2 keeps them in.
 *
 * @module agentos-bench/core/metrics/extractHighIdfTokens
 */

import { isStopword } from './stopwords.js';

const MIN_TOKEN_LENGTH = 2;

/**
 * Extract high-IDF candidate tokens from a piece of text (typically
 * the gold answer for a LongMemEval-S case).
 *
 * @param text - input text (gold answer, observer log, etc.)
 * @returns deduplicated array of lowercase tokens of length >= 4
 *          that are not in the stoplist
 */
export function extractHighIdfTokens(text: string): string[] {
  if (!text) return [];

  const normalized = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const cleaned = normalized.replace(/[^a-z0-9\s]/g, ' ');

  const rawTokens = cleaned.split(/\s+/).filter(Boolean);

  const filtered = rawTokens.filter(
    (t) => t.length >= MIN_TOKEN_LENGTH && !isStopword(t),
  );

  return Array.from(new Set(filtered));
}
