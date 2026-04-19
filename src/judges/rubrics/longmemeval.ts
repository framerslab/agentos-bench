/**
 * @file longmemeval.ts
 * @description LLM-as-judge rubrics for LongMemEval, vendored verbatim
 * from the official evaluation script under MIT License.
 *
 * Source: github.com/xiaowu0162/LongMemEval (commit hash tracked in
 * `RUBRIC_SOURCE` below). LongMemEval's judge emits a binary yes/no
 * judgment per case — the rubric is identical across the three core
 * case families, with small per-type clauses layered on top. Keeping
 * the prompts static in this file (rather than shipping a Python script)
 * lets us avoid a runtime dependency on LongMemEval's Python harness.
 *
 * When upstream changes a rubric, bump {@link RUBRIC_VERSION} so every
 * judgment cached under the old version is invalidated.
 *
 * @module agentos-bench/judges/rubrics/longmemeval
 */

/** Upstream commit we vendored from. Bump when prompts are refreshed. */
export const RUBRIC_SOURCE = 'github.com/xiaowu0162/LongMemEval@main (2026-04-18 snapshot)';

/**
 * Version tag for cache invalidation. Bump on ANY rubric or source update
 * so the judge cache entries recompute.
 */
export const RUBRIC_VERSION = '2026-04-18.1';

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
 * Base rubric — applied to `single-session-user`, `single-session-assistant`,
 * and `multi-session` question types without modification.
 */
const BASE = `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no.`;

const TEMPORAL_CLAUSE = ` In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct.`;

const KNOWLEDGE_UPDATE_CLAUSE = ` If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.`;

const PREFERENCE_CLAUSE = ` The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.`;

const ABSTENTION_RUBRIC = `I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not available.`;

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
      return `${BASE}${TEMPORAL_CLAUSE}\n\nQuestion: ${question}\n\nCorrect Answer: ${expected}\n\nModel Response: ${actual}\n\nIs the model response correct? Answer yes or no only.`;
    case 'knowledge-update':
      return `${BASE}${KNOWLEDGE_UPDATE_CLAUSE}\n\nQuestion: ${question}\n\nCorrect Answer: ${expected}\n\nModel Response: ${actual}\n\nIs the model response correct? Answer yes or no only.`;
    case 'single-session-preference':
      return `${BASE}${PREFERENCE_CLAUSE}\n\nQuestion: ${question}\n\nRubric: ${expected}\n\nModel Response: ${actual}\n\nIs the model response correct? Answer yes or no only.`;
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
