/**
 * @file scoreStageRetention.ts
 * @description Compute the fraction of high-IDF gold-answer tokens
 * that appear (as whole tokens, after normalization) in a single
 * pipeline stage's text.
 *
 * Whole-token match after NFKD-normalize + lowercase + Unicode-aware
 * tokenization. Multi-occurrence in the stage text counts as one
 * match. We measure presence, not frequency.
 *
 * Whole-token matching (rather than naive substring) prevents short
 * candidate tokens from inflating retention via accidental hits inside
 * larger tokens (e.g., the candidate `'50'` would otherwise match
 * `'1950'` and `'$50'` \u2014 both of which are unrelated to the gold
 * `'50'` token).
 *
 * @module agentos-bench/core/metrics/scoreStageRetention
 */

/**
 * Normalize text for matching: NFKD strip combining marks + lowercase.
 *
 * @param text - input
 * @returns normalized text
 */
function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Tokenize a normalized stage text into a Set of whole tokens. Splits
 * on any non-letter / non-number Unicode character (matching the same
 * regex used in {@link extractHighIdfTokens} so the two stay in sync).
 *
 * Returns a Set so membership lookups in the per-token loop are O(1).
 */
function tokenizeStage(stageText: string): Set<string> {
  const normalized = normalize(stageText);
  const cleaned = normalized.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const rawTokens = cleaned.split(/\s+/).filter(Boolean);
  return new Set(rawTokens);
}

/**
 * Fraction of `tokens` that appear (as whole tokens, normalized) in
 * `stageText`. Returns 0 if `tokens` or `stageText` is empty.
 *
 * @param tokens - high-IDF candidate tokens (already lowercased)
 * @param stageText - pipeline-stage text to search in
 * @returns fraction in [0, 1]
 */
export function scoreStageRetention(
  tokens: ReadonlyArray<string>,
  stageText: string,
): number {
  if (tokens.length === 0 || !stageText) return 0;
  const stageTokens = tokenizeStage(stageText);
  let matches = 0;
  for (const token of tokens) {
    if (stageTokens.has(token)) {
      matches += 1;
    }
  }
  return matches / tokens.length;
}
