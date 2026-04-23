/**
 * @file questionRouter.ts
 * @description Step 16c v2: per-question dynamic router for the bench's
 * Observational Memory + canonical retrieval architectures.
 *
 * The router classifies each LongMemEval-style question into one of six
 * categories via a cheap gpt-5-mini call, then returns a {@link RouterConfig}
 * indicating which architecture to run for that case.
 *
 * Routing table is grounded in v5 Phase A N=102 results (2026-04-22):
 *   - SSU/SSA/SSP/TR → canonical Step 3 HybridRetriever (no OM)
 *   - KU/MS → v5 OM (dual-path + gpt-4o observer + scaffold)
 *
 * See docs/specs/2026-04-22-step-16c-llm-judge-router-design.md for the
 * full per-category Phase A delta table that motivates these choices.
 *
 * @module agentos-bench/observational-memory/questionRouter
 */

import type { IReader } from '../readers/IReader.js';

/**
 * The six LongMemEval-S case categories the router knows how to dispatch.
 */
export type QuestionCategory =
  | 'single-session-user'
  | 'single-session-assistant'
  | 'single-session-preference'
  | 'knowledge-update'
  | 'multi-session'
  | 'temporal-reasoning';

const CATEGORY_TOKENS: readonly QuestionCategory[] = [
  'single-session-user',
  'single-session-assistant',
  'single-session-preference',
  'knowledge-update',
  'multi-session',
  'temporal-reasoning',
];

/**
 * System prompt sent to the classifier. Lists the six category tokens with
 * one-sentence definitions and a couple of examples each, then instructs
 * the model to return ONLY the bare category token.
 */
export const CLASSIFIER_SYSTEM_PROMPT = `You are classifying a memory-system question into one of six categories.

Return ONLY the category token (no explanation, no quotes, no punctuation).

Categories:
- single-session-user: the question asks about something the USER said, did, or stated in a specific past session. Answer is in one session. Examples: "What did I tell you about my favorite dessert?", "Where did I say I moved to last month?"
- single-session-assistant: the question asks about something the ASSISTANT said, generated, or recommended in a specific session. Answer is in one session. Examples: "What recipe did you suggest for the birthday party?", "What books did you recommend to me?"
- single-session-preference: the question asks about a preference the user stated in passing. Answer is in one session. Examples: "Do I prefer tea or coffee?", "What's my favorite type of movie?"
- knowledge-update: the question asks about current state where the answer EVOLVED across sessions (supersession). Examples: "What's my current job title?", "Where do I live now?", "What's my latest project?"
- multi-session: the question requires combining information from 2+ separate sessions. Examples: "How many different languages have I mentioned studying?", "Which authors did you recommend across our conversations?"
- temporal-reasoning: the question asks about the order, timing, or duration of events across time. Examples: "In what order did I visit the three countries?", "How many months ago did I start the new job?"`;

/**
 * Step 16c v10: few-shot variant of the classifier prompt. Adds explicit
 * Question/Category pairs after the category definitions, targeting the
 * confusion patterns observed at gpt-5-mini classifier in the v9-baseline
 * 16c Tier A run (37.5% accuracy):
 *   - SSA confused as SSU (4/4) — the YOU-said vs I-said distinction needs
 *     paired contrastive examples.
 *   - SSP confused as SSA (3/4) — preferences are often phrased like
 *     assistant-recommendations; needs disambiguating examples.
 *   - MS confused as KU (2/4) — both involve cross-session info; the
 *     "current state vs combine across sessions" distinction needs paired
 *     contrastive examples.
 *
 * Used when {@link ClassifyQuestionArgs.useFewshotPrompt} is true.
 */
export const CLASSIFIER_SYSTEM_PROMPT_FEWSHOT = `You are classifying a memory-system question into one of six categories.

Return ONLY the category token (no explanation, no quotes, no punctuation).

Categories:
- single-session-user: the question asks about something the USER said, did, or stated in a specific past session. Answer is in one session.
- single-session-assistant: the question asks about something the ASSISTANT said, generated, or recommended in a specific session. Answer is in one session.
- single-session-preference: the question asks about a preference the user stated in passing. Answer is in one session.
- knowledge-update: the question asks about current state where the answer EVOLVED across sessions (supersession). The user wants the LATEST value of an attribute that has changed over time.
- multi-session: the question requires combining information from 2+ separate sessions. Counting, listing, or aggregating items the user mentioned across sessions.
- temporal-reasoning: the question asks about the order, timing, or duration of events across time.

Examples:

Question: What did I tell you my favorite ice cream flavor was?
Category: single-session-user

Question: Where did I say I moved to last month?
Category: single-session-user

Question: What book did you recommend to me last week?
Category: single-session-assistant

Question: What recipe did you suggest for the birthday party?
Category: single-session-assistant

Question: Do I prefer working in the morning or evening?
Category: single-session-preference

Question: What's my favorite type of movie?
Category: single-session-preference

Question: What's my current job title?
Category: knowledge-update

Question: Where do I live now?
Category: knowledge-update

Question: How many different programming languages have I mentioned learning?
Category: multi-session

Question: Which authors have you recommended to me across our conversations?
Category: multi-session

Question: In what order did I visit the three European cities?
Category: temporal-reasoning

Question: How many weeks ago did I start the new job?
Category: temporal-reasoning`;

/**
 * Arguments for {@link classifyQuestion}.
 */
export interface ClassifyQuestionArgs {
  /** Reader to invoke (typically gpt-5-mini for this cheap classification call). */
  reader: IReader;
  /** The user question text to classify. */
  question: string;
  /**
   * Step 16c v10: when true, use {@link CLASSIFIER_SYSTEM_PROMPT_FEWSHOT}
   * instead of the basic prompt. The fewshot prompt adds explicit
   * Question/Category pairs targeting the SSU-vs-SSA, SSP-vs-SSA, and
   * MS-vs-KU confusion patterns observed at gpt-5-mini classifier in
   * the v9-baseline 16c Tier A run. Default false.
   */
  useFewshotPrompt?: boolean;
}

/**
 * Result of {@link classifyQuestion}. Bundles the parsed category with
 * the underlying reader response's token usage and model identifier so
 * the caller can record real costs to the {@link CostTracker}.
 */
export interface ClassifyQuestionResult {
  category: QuestionCategory;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

/**
 * Strip common LLM-output decorations from a classifier response so we
 * can match the bare category token. Handles trailing punctuation
 * (period, comma, semicolon), surrounding quotes, and common label
 * prefixes like `category:` or `type:` that the model sometimes emits
 * despite the system prompt asking for the bare token.
 */
function normalizeClassifierOutput(raw: string): string {
  // First line only — models occasionally emit multi-line explanations.
  const firstLine = raw.split('\n')[0] ?? '';
  let cleaned = firstLine.trim().toLowerCase();
  // Drop common labelling prefixes ("category:", "type:", "answer:").
  cleaned = cleaned.replace(/^(category|type|answer|label|class)\s*[:\-=]\s*/, '');
  // Drop surrounding quotes/backticks.
  cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, '');
  // Drop trailing sentence punctuation.
  cleaned = cleaned.replace(/[.,;!?]+$/g, '');
  return cleaned.trim();
}

/**
 * Run the classifier reader on a question. Returns the parsed category
 * along with the reader response's token usage so the caller can do
 * accurate cost tracking. On unparseable model output, returns
 * `category: 'multi-session'` as a safe default — multi-session routes
 * through the OM branch which at least covers cross-session synthesis
 * even when the question type is misidentified.
 *
 * The parser is tolerant of common LLM output decorations: trailing
 * punctuation (`knowledge-update.`), surrounding quotes (`"multi-session"`),
 * label prefixes (`Category: temporal-reasoning`), and case variations.
 */
export async function classifyQuestion(args: ClassifyQuestionArgs): Promise<ClassifyQuestionResult> {
  const { reader, question, useFewshotPrompt } = args;
  const userPrompt = `Question: ${question}\n\nCategory:`;
  const systemPrompt = useFewshotPrompt
    ? CLASSIFIER_SYSTEM_PROMPT_FEWSHOT
    : CLASSIFIER_SYSTEM_PROMPT;
  const response = await reader.invoke({
    system: systemPrompt,
    user: userPrompt,
    maxTokens: 16,
    temperature: 0,
  });
  const cleaned = normalizeClassifierOutput(response.text);
  let category: QuestionCategory = 'multi-session';
  for (const token of CATEGORY_TOKENS) {
    if (cleaned === token || cleaned.startsWith(`${token} `) || cleaned.startsWith(`${token}\n`)) {
      category = token;
      break;
    }
  }
  return {
    category,
    tokensIn: response.tokensIn,
    tokensOut: response.tokensOut,
    model: response.model,
  };
}

/**
 * The architecture choice the router returns for a given category.
 *
 * - `runOM === true`: run the OM ingest pipeline (gpt-4o observer + dual-path
 *   batching) and feed the observation log to the reader.
 * - `runOM === false`: skip OM entirely; use the canonical Step 3
 *   HybridRetriever path (BM25 + dense + RRF + Cohere rerank) and feed
 *   retrieved passages to the reader.
 * - `runRetrieval`: when `runOM === false`, this is always true (canonical
 *   IS retrieval). When `runOM === true`, v2 router never sets this true
 *   because Step 16 family (OM + retrieval combined) was RED.
 * - `useScaffold`: only consulted when `runOM === true`. The cross-session
 *   reader scaffold is appended to the OM finalLog system prompt.
 */
export interface RouterConfig {
  runOM: boolean;
  runRetrieval: boolean;
  useScaffold: boolean;
}

/**
 * Default route used as a safety fallback when the classifier errors. Picks
 * the v5 OM config (with scaffold) because OM at least covers MS via
 * cross-session synthesis; canonical with no OM would miss MS questions if
 * they were misclassified.
 */
export const DEFAULT_ROUTE: RouterConfig = {
  runOM: true,
  runRetrieval: false,
  useScaffold: true,
};

/**
 * Pure routing function. Maps a {@link QuestionCategory} to its
 * empirically-best architecture per the v5 Phase A N=102 result.
 */
export function routeQuestion(category: QuestionCategory): RouterConfig {
  switch (category) {
    case 'single-session-user':
    case 'single-session-assistant':
    case 'single-session-preference':
    case 'temporal-reasoning':
      // Phase A v5 N=102 data: canonical Step 3 HybridRetriever wins these
      // four categories (SSU 97.1% vs v5 94.1%; SSA 89.3% vs v5 76.5%;
      // SSP 60.0% vs v5 58.8%; TR 70.2% vs v5 52.9%). Skip OM ingest;
      // run canonical retrieval pipeline.
      return { runOM: false, runRetrieval: true, useScaffold: false };
    case 'knowledge-update':
    case 'multi-session':
      // Phase A v5 N=102 data: v5 OM wins these two categories.
      // KU 88.2% vs canonical 86.8% (+1.4pp tied within noise).
      // MS 70.6% vs canonical 54.9% (+15.7pp — load-bearing routing decision).
      return { runOM: true, runRetrieval: false, useScaffold: true };
  }
}
