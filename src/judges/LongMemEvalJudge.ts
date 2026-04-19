/**
 * @file LongMemEvalJudge.ts
 * @description GPT-4o-backed LLM-as-judge for LongMemEval cases.
 *
 * Wraps an {@link IReader} (typically GPT-4o via {@link createReader})
 * with the per-type rubric composition in `rubrics/longmemeval.ts`
 * and the binary yes/no parser the LongMemEval paper defines. The
 * judge is deterministic at `temperature=0` and its outputs are cached
 * by the {@link BenchmarkRunner} via the `judge` cache namespace.
 *
 * @module agentos-bench/judges/LongMemEvalJudge
 */

import type { IJudge, JudgeInput, JudgeOutput } from './IJudge.js';
import type { IReader } from '../readers/IReader.js';
import {
  RUBRIC_VERSION,
  buildJudgePrompt,
  parseJudgeReply,
  type LongMemEvalQuestionType,
} from './rubrics/longmemeval.js';

/**
 * Options for constructing a {@link LongMemEvalJudge}.
 */
export interface LongMemEvalJudgeOptions {
  /** The reader used to call the judge LLM (typically `gpt-4o`). */
  reader: IReader;
  /** Optional rubric version override — used when vendoring updates. */
  rubricVersion?: string;
  /** Optional system prompt prefix — left empty by default to match
   *  LongMemEval's evaluator exactly. */
  systemPrompt?: string;
}

/**
 * LongMemEval-compatible LLM-as-judge.
 */
export class LongMemEvalJudge implements IJudge {
  readonly model: string;
  readonly rubricVersion: string;
  private readonly reader: IReader;
  private readonly systemPrompt: string | undefined;

  constructor(opts: LongMemEvalJudgeOptions) {
    this.reader = opts.reader;
    this.model = opts.reader.model;
    this.rubricVersion = opts.rubricVersion ?? RUBRIC_VERSION;
    this.systemPrompt = opts.systemPrompt;
  }

  async judge(input: JudgeInput): Promise<JudgeOutput> {
    const questionType = input.caseType as LongMemEvalQuestionType;
    // If a case claims an abstention answer, swap in the abstention rubric
    // even when `caseType` says something else — matches LongMemEval's
    // `check_abstention` branch in the official evaluator.
    const effectiveType: LongMemEvalQuestionType =
      input.hints?.abstention === true ? 'abstention' : questionType;

    const prompt = buildJudgePrompt(effectiveType, input.question, input.expected, input.actual);

    const response = await this.reader.invoke({
      system: this.systemPrompt,
      user: prompt,
      maxTokens: 8, // the rubric asks for "yes" or "no" — keep it tight
      temperature: 0,
    });

    const { score, correct } = parseJudgeReply(response.text);

    return {
      score,
      correct,
      reasoning: response.text,
      judgeModel: response.model,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      rubricVersion: this.rubricVersion,
    };
  }
}
