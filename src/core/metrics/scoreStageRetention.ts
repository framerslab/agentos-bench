/**
 * @file scoreStageRetention.ts
 * @description Compute the fraction of high-IDF gold-answer tokens
 * that appear (verbatim, after normalization) in a single pipeline
 * stage's text.
 *
 * Substring match after NFKD-normalize + lowercase. Multi-occurrence
 * in the stage text counts as one match. We measure presence, not
 * frequency.
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
 * Fraction of `tokens` that appear (substring-match, normalized) in
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
  const normalizedStage = normalize(stageText);
  let matches = 0;
  for (const token of tokens) {
    if (normalizedStage.includes(token)) {
      matches += 1;
    }
  }
  return matches / tokens.length;
}
