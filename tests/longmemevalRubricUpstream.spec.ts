/**
 * @file longmemevalRubricUpstream.spec.ts
 * @description The judge prompts are LongMemEval's own. Each template below is copied character for character from
 * `get_anscheck_prompt` in LongMemEval's evaluator
 * (https://github.com/xiaowu0162/LongMemEval/blob/d6dc8b50a2d9ac0c99485ea28fa5755c62414c34/src/evaluation/evaluate_qa.py#L24-L45),
 * and `buildJudgePrompt` must return what `template.format(question, answer, response)` returns there, for every
 * question type and for the abstention branch.
 */
import { describe, expect, it } from 'vitest';
import { RUBRIC_SOURCE, RUBRIC_VERSION, buildJudgePrompt, type LongMemEvalQuestionType } from '../src/index.js';

const BASE_TEMPLATE =
  "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. \n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only.";
const TEMPORAL_TEMPLATE =
  "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct. \n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only.";
const KNOWLEDGE_UPDATE_TEMPLATE =
  "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.\n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only.";
const PREFERENCE_TEMPLATE =
  "I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.\n\nQuestion: {}\n\nRubric: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only.";
const ABSTENTION_TEMPLATE =
  "I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not.\n\nQuestion: {}\n\nExplanation: {}\n\nModel Response: {}\n\nDoes the model correctly identify the question as unanswerable? Answer yes or no only.";

/** Python's `str.format` with three positional `{}` fields. */
function format(template: string, ...values: string[]): string {
  let i = 0;
  return template.replace(/\{\}/g, () => values[i++]!);
}

const QUESTION = 'Where did I move after Lisbon?';
const ANSWER = 'Porto';
const RESPONSE = 'You moved to Porto.';

const CASES: Array<[LongMemEvalQuestionType, string]> = [
  ['single-session-user', BASE_TEMPLATE],
  ['single-session-assistant', BASE_TEMPLATE],
  ['multi-session', BASE_TEMPLATE],
  ['temporal-reasoning', TEMPORAL_TEMPLATE],
  ['knowledge-update', KNOWLEDGE_UPDATE_TEMPLATE],
  ['single-session-preference', PREFERENCE_TEMPLATE],
  ['abstention', ABSTENTION_TEMPLATE],
];

describe("LongMemEval's judge prompts", () => {
  it.each(CASES)('for %s match the upstream evaluator exactly', (type, template) => {
    expect(buildJudgePrompt(type, QUESTION, ANSWER, RESPONSE)).toBe(format(template, QUESTION, ANSWER, RESPONSE));
  });

  it('name the upstream commit they were copied from', () => {
    expect(RUBRIC_SOURCE).toContain('d6dc8b50a2d9ac0c99485ea28fa5755c62414c34');
  });

  it('carry a rubric version no judgment was cached under before they matched upstream', () => {
    // Judgments are cached by rubric version; one cached under the earlier prompts must not be read back.
    expect(RUBRIC_VERSION).not.toBe('2026-04-18.1');
  });
});
