/**
 * @file abstention.ts
 * @description How LongMemEval marks an abstention question: by its id. "If `question_id` ends with `_abs`, then the
 * question is an `abstention` question" (the dataset's README,
 * https://github.com/xiaowu0162/LongMemEval/blob/d6dc8b50a2d9ac0c99485ea28fa5755c62414c34/README.md?plain=1#L71), and
 * its evaluator picks the abstention prompt by `'_abs' in question_id`
 * (https://github.com/xiaowu0162/LongMemEval/blob/d6dc8b50a2d9ac0c99485ea28fa5755c62414c34/src/evaluation/evaluate_qa.py#L101).
 * Such a question keeps its base `question_type`, and its answer is an explanation, so neither says it is one.
 *
 * @module agentos-bench/benchmarks/longmemeval/abstention
 */

/** True when a LongMemEval `question_id` names an abstention question. */
export function isLongMemEvalAbstentionId(questionId: string): boolean {
  return questionId.endsWith('_abs');
}

/**
 * Appended to the case-result and judge cache keys of a LongMemEval case whose id names an abstention question. Those
 * cases were graded with their type's rubric before the loader read the id, so a grading cached under the earlier keys
 * is not reused for them. Every other case keeps its keys, and its cache.
 */
export const LONGMEMEVAL_ABS_ID_CACHE_TAG = 'longmemeval-abs-id-is-abstention:v1';

/**
 * True when `caseId` of the benchmark `benchmarkId` takes {@link LONGMEMEVAL_ABS_ID_CACHE_TAG}. A missing id (a caller
 * that builds a key from part of its context) takes no tag.
 */
export function takesAbsIdCacheTag(benchmarkId: string | undefined, caseId: string | undefined): boolean {
  return (
    typeof benchmarkId === 'string' &&
    typeof caseId === 'string' &&
    benchmarkId.startsWith('longmemeval-') &&
    isLongMemEvalAbstentionId(caseId)
  );
}
