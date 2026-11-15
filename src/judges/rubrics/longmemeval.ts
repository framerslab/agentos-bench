/**
 * @file longmemeval.ts
 * @description LLM-as-judge rubrics for LongMemEval, vendored verbatim
 * from the official evaluation script under MIT License.
 *
 * Source: github.com/xiaowu0162/LongMemEval (commit hash tracked in
 * `RUBRIC_SOURCE` below). LongMemEval's judge emits a binary yes/no
 * judgment per case: one prompt for three question types, its own prompt
 * for each of the other three, and one for abstention questions. Keeping
 * the prompts static in this file (rather than shipping a Python script)
 * lets us avoid a runtime dependency on LongMemEval's Python harness.
 *
 * When upstream changes a rubric, bump {@link RUBRIC_VERSION} so every
 * judgment cached under the old version is invalidated.
 *
 * @module agentos-bench/judges/rubrics/longmemeval
 */

/** Upstream commit the prompts are copied from. Bump when prompts are refreshed. */
export const RUBRIC_SOURCE =
  'github.com/xiaowu0162/LongMemEval@d6dc8b50a2d9ac0c99485ea28fa5755c62414c34 (src/evaluation/evaluate_qa.py, get_anscheck_prompt)';

/**
 * Version tag for cache invalidation. Bump on ANY rubric or source update
 * so the judge cache entries recompute.
 *
 * `2026-11-15.1`: every prompt now matches upstream character for
 * character. The `2026-04-18.1` prompts had the base rubric in front of
 * the knowledge-update and preference clauses, no space before the
 * question block on the base and temporal prompts, and "not available"
 * where upstream's abstention prompt ends "not".
 */
export const RUBRIC_VERSION = '2026-11-15.1';

/** LongMemEval's five question types (plus the cross-cutting abstention variant). */
export type LongMemEvalQuestionType =
  | 'single-session-user'
  | 'single-session-assistant'
  | 'multi-session'
  | 'temporal-reasoning'
  | 'knowledge-update'
  | 'single-session-preference'
  | 'abstention';

/**
 * Base rubric: applied to `single-session-user`, `single-session-assistant`,
 * and `multi-session` question types. Upstream ends it with a space before
 * the question block, and so does this.
 */
const BASE = `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. `;

const TEMPORAL = `${BASE}In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct. `;

/** Upstream's knowledge-update prompt drops the base rubric's last two sentences. */
const KNOWLEDGE_UPDATE = `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.`;

/** Upstream's preference prompt has its own opening: the gold answer is a rubric, not an answer. */
const PREFERENCE = `I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.`;

const ABSTENTION_RUBRIC = `I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not.`;

/**
 * Compose the full judge prompt for a given question type.
 *
 * @param type     Upstream question type (see {@link LongMemEvalQuestionType}).
 * @param question The case's question text.
 * @param expected The gold-standard answer (or explanation, for abstention).
 * @param actual   The reader's answer to score.
 */
export function buildJudgePrompt(
  type: LongMemEvalQuestionType,
  question: string,
  expected: string,
  actual: string,
): string {
  switch (type) {
    case 'single-session-user':
    case 'single-session-assistant':
    case 'multi-session':
      return `${BASE}\n\nQuestion: ${question}\n\nCorrect Answer: ${expected}\n\nModel Response: ${actual}\n\nIs the model response correct? Answer yes or no only.`;
    case 'temporal-reasoning':
      return `${TEMPORAL}\n\nQuestion: ${question}\n\nCorrect Answer: ${expected}\n\nModel Response: ${actual}\n\nIs the model response correct? Answer yes or no only.`;
    case 'knowledge-update':
      return `${KNOWLEDGE_UPDATE}\n\nQuestion: ${question}\n\nCorrect Answer: ${expected}\n\nModel Response: ${actual}\n\nIs the model response correct? Answer yes or no only.`;
    case 'single-session-preference':
      return `${PREFERENCE}\n\nQuestion: ${question}\n\nRubric: ${expected}\n\nModel Response: ${actual}\n\nIs the model response correct? Answer yes or no only.`;
    case 'abstention':
      return `${ABSTENTION_RUBRIC}\n\nQuestion: ${question}\n\nExplanation: ${expected}\n\nModel Response: ${actual}\n\nDoes the model correctly identify the question as unanswerable? Answer yes or no only.`;
  }
}

/**
 * Parse the judge's reply into a binary score.
 * Matches LongMemEval's own parser: "yes" anywhere in the (stripped,
 * lowercased) reply is positive; everything else is negative.
 */
export function parseJudgeReply(reply: string): { score: 0 | 1; correct: boolean } {
  const needle = reply.trim().toLowerCase();
  const correct = needle.startsWith('yes') || /\byes\b/.test(needle.split('\n')[0] ?? '');
  return { score: correct ? 1 : 0, correct };
}
