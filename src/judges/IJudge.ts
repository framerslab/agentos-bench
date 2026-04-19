/**
 * @file IJudge.ts
 * @description LLM-as-judge contract for scoring benchmark answers.
 *
 * External benchmarks supply a per-case-type rubric (vendored from the
 * upstream repo — LongMemEval's `evaluation_prompts/`, LOCOMO's rubric,
 * BEAM's rubric). The judge formats the rubric with `{question, actual,
 * expected}` and asks a judge LLM (GPT-4o by default) to score the answer.
 *
 * A single `IJudge` implementation lives in {@link LongMemEvalJudge};
 * LOCOMO and BEAM extend or reuse it with different rubric sets. All
 * implementations must cache deterministically on
 * `(benchmarkId, caseId, actualOutput, rubricVersion)`.
 *
 * @module agentos-bench/judges/IJudge
 */

/**
 * Input to a judge call.
 */
export interface JudgeInput {
  /** Benchmark this case belongs to — used for cache keys + rubric selection. */
  benchmarkId: string;
  /** Case identifier. */
  caseId: string;
  /** Case type — drives rubric selection (e.g. `temporal-reasoning`). */
  caseType: string;
  /** The question or prompt that was asked. */
  question: string;
  /** The reader's actual output. */
  actual: string;
  /** The gold-standard expected output. */
  expected: string;
  /** Optional alternative acceptable answers. */
  acceptableAnswers?: string[];
  /** Optional benchmark-specific hints for the judge (e.g. expected reasoning steps). */
  hints?: Record<string, unknown>;
}

/**
 * Output of a judge call.
 */
export interface JudgeOutput {
  /** Normalized score in [0, 1]. */
  score: number;
  /** True iff the answer is considered correct under the rubric. */
  correct: boolean;
  /** Judge's reasoning (stored for audit, not for user-facing reports). */
  reasoning?: string;
  /** Model that produced the judgment (for provenance). */
  judgeModel: string;
  /** Tokens consumed by the judgment — recorded against the cost tracker. */
  tokensIn: number;
  tokensOut: number;
  /** Rubric version used. Cache invalidation key. */
  rubricVersion: string;
}

/**
 * LLM-as-judge contract.
 */
export interface IJudge {
  /** Judge model identifier — used for cost accounting. */
  readonly model: string;
  /**
   * Rubric set version (bumped when prompts change). Cached judgments
   * with a different version MUST be re-scored.
   */
  readonly rubricVersion: string;

  /**
   * Score one case. Implementations MUST consult `ctx.cache` before
   * calling the judge LLM.
   */
  judge(input: JudgeInput): Promise<JudgeOutput>;
}
