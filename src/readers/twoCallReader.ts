/**
 * @fileoverview Emergence-style two-call reader.
 *
 * Splits a single reader invocation into:
 *  1. Extract call: raw retrieved passages -> JSON fact scratchpad
 *     with passage-id citations.
 *  2. Answer call: scratchpad -> final answer (no raw passages in
 *     final context).
 *
 * Falls back to single-call semantics on malformed extract JSON so the
 * benchmark never degrades below the pre-Step-14 pipeline on that path.
 *
 * @module agentos-bench/readers/twoCallReader
 */

import { createHash } from 'node:crypto';
import type { IReader, ReaderResponse } from './IReader.js';

export interface RetrievedPassage {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ExtractedFact {
  content: string;
  sourcePassages: string[];
}

export interface ReaderCallCost {
  tokensIn: number;
  tokensOut: number;
  model: string;
}

export interface TwoCallResult {
  answer: string;
  scratchpadFacts: ExtractedFact[];
  extractCost: ReaderCallCost;
  answerCost: ReaderCallCost;
  fallbackUsed: boolean;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export const EXTRACT_SYSTEM_PROMPT = `You are a comprehensive fact-extraction assistant. Given a user query and a set of passages (tagged [P0], [P1], ...), extract EVERY fact, detail, date, name, number, and contextual element from the passages that could possibly help answer the query. Be inclusive, not selective. Output a single valid JSON object with this exact shape:

{
  "facts": [
    { "content": "the full fact sentence preserving all literal tokens", "sourcePassages": ["P3"] }
  ]
}

Rules:
- Extract 5-20 facts per query. Err on the side of inclusion.
- Preserve ALL literal tokens VERBATIM: names (Alice, Wells Fargo), dates (March 15, 2024-03-15), numeric amounts ($350,000, 5kg, 27:12), addresses, phone numbers, times, durations, product names, relationships, quantities. Do NOT paraphrase or abbreviate these.
- Include facts that provide temporal context, causal ordering, or background even if not directly stated in the query. Multi-hop questions need supporting facts.
- Quote exact phrases from the passages when a fact contains specific-value tokens.
- If a passage says "User mentioned X on date Y", extract both X and Y as facts.
- If truly no relevant facts are present, return {"facts": []} — but this should be rare.
- Cite every fact with at least one sourcePassages entry.
- Output ONLY valid JSON. No prose before or after.`;

export const ANSWER_SYSTEM_PROMPT = `You are a Q&A assistant. Answer the user's query using ONLY the facts provided. If the facts do not contain enough information, say so briefly. Preserve literal tokens (names, dates, numeric amounts).`;

/**
 * Content-addressed hash of the extract system prompt. Bench cache keys
 * include this so any prompt edit auto-invalidates cached answers.
 */
export const EXTRACT_PROMPT_HASH: string = createHash('sha256')
  .update(EXTRACT_SYSTEM_PROMPT)
  .digest('hex');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPassagesBlock(passages: readonly RetrievedPassage[]): string {
  return passages.map((p) => `[${p.id}] ${p.content}`).join('\n\n');
}

function formatScratchpadBlock(facts: readonly ExtractedFact[]): string {
  if (facts.length === 0) return '(no facts extracted)';
  return facts
    .map((f) => `- ${f.content} (sources: ${f.sourcePassages.join(', ')})`)
    .join('\n');
}

/**
 * Strip common LLM wrappers around JSON output. Tolerates triple-backtick
 * code fences (```json ... ```), optional "json" language tag, leading
 * or trailing prose, and returns the inner JSON region if one is found.
 */
function stripJsonWrappers(raw: string): string {
  const text = raw.trim();
  // Strip ```json ... ``` fences.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  // Find the first `{` and the matching final `}`.
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }
  return text;
}

/**
 * Parse the extract-call output into a typed fact array. Returns null
 * when the output is not valid JSON OR does not match the declared
 * schema {facts: [{content: string, sourcePassages: string[]}]}.
 * Tolerates code-fence wrapping and stray prose around the JSON.
 */
function parseExtractOutput(text: string): ExtractedFact[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonWrappers(text));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const facts = (parsed as { facts?: unknown }).facts;
  if (!Array.isArray(facts)) return null;
  const out: ExtractedFact[] = [];
  for (const f of facts) {
    if (typeof f !== 'object' || f === null) return null;
    const content = (f as { content?: unknown }).content;
    const sourcePassages = (f as { sourcePassages?: unknown }).sourcePassages;
    if (typeof content !== 'string') return null;
    if (!Array.isArray(sourcePassages)) return null;
    if (!sourcePassages.every((p) => typeof p === 'string')) return null;
    out.push({ content, sourcePassages });
  }
  return out;
}

// ---------------------------------------------------------------------------
// twoCallRead
// ---------------------------------------------------------------------------

export interface TwoCallReadArgs {
  reader: IReader;
  query: string;
  passages: readonly RetrievedPassage[];
  extractMaxTokens?: number;
  answerMaxTokens?: number;
  temperature?: number;
  /**
   * System prompt to use when the extract call's JSON is malformed
   * and we fall back to single-call semantics. Pass the ORIGINAL
   * system prompt the bench would have used without two-call reader
   * (e.g. `out.prompt` from `runFullCognitiveCase`) so the fallback
   * path matches pre-Step-14 behavior exactly.
   *
   * When omitted, the fallback uses {@link ANSWER_SYSTEM_PROMPT} and
   * embeds the raw passages in the user message. Prefer passing the
   * bench's real system prompt.
   */
  fallbackSystemPrompt?: string;
}

/**
 * Execute the Emergence-style two-call read pipeline.
 *
 * @param args.reader Shared IReader (both calls go through it with
 *   different prompts).
 * @param args.query The user's original query.
 * @param args.passages Top-K retrieved passages, tagged with stable IDs
 *   (e.g. "P0", "P1"). Order is preserved in the extract prompt.
 * @param args.extractMaxTokens Completion cap for the extract call.
 *   Default 400.
 * @param args.answerMaxTokens Completion cap for the answer call.
 *   Default 256.
 * @param args.temperature Sampling temperature for both calls.
 *   Default 0.
 */
export async function twoCallRead(args: TwoCallReadArgs): Promise<TwoCallResult> {
  const {
    reader,
    query,
    passages,
    extractMaxTokens = 1200, // lifted from 400 — inclusive-extraction prompt emits more JSON
    answerMaxTokens = 256,
    temperature = 0,
    fallbackSystemPrompt,
  } = args;

  const passagesBlock = formatPassagesBlock(passages);
  const extractResponse: ReaderResponse = await reader.invoke({
    system: EXTRACT_SYSTEM_PROMPT,
    user: `Query: ${query}\n\nPassages:\n${passagesBlock}\n\nExtract the relevant facts as JSON:`,
    maxTokens: extractMaxTokens,
    temperature,
  });

  const extractCost: ReaderCallCost = {
    tokensIn: extractResponse.tokensIn,
    tokensOut: extractResponse.tokensOut,
    model: extractResponse.model,
  };

  const parsed = parseExtractOutput(extractResponse.text);

  if (parsed === null) {
    // Fallback: prefer the caller-supplied `fallbackSystemPrompt`
    // (typically the bench's full memory-retrieval system prompt) so
    // the fallback path produces the same behavior as the pre-Step-14
    // single-call pipeline. When no fallback prompt is supplied, fall
    // back to the stripped ANSWER_SYSTEM_PROMPT + raw passages (legacy
    // behavior preserved for unit tests).
    const fallbackSystem = fallbackSystemPrompt ?? ANSWER_SYSTEM_PROMPT;
    const fallbackUser = fallbackSystemPrompt
      ? query
      : `Query: ${query}\n\nPassages:\n${passagesBlock}\n\nAnswer:`;
    const fallbackResponse: ReaderResponse = await reader.invoke({
      system: fallbackSystem,
      user: fallbackUser,
      maxTokens: answerMaxTokens,
      temperature,
    });
    return {
      answer: fallbackResponse.text,
      scratchpadFacts: [],
      extractCost,
      answerCost: {
        tokensIn: fallbackResponse.tokensIn,
        tokensOut: fallbackResponse.tokensOut,
        model: fallbackResponse.model,
      },
      fallbackUsed: true,
    };
  }

  const scratchpadBlock = formatScratchpadBlock(parsed);
  const answerResponse: ReaderResponse = await reader.invoke({
    system: ANSWER_SYSTEM_PROMPT,
    user: `Query: ${query}\n\nFacts:\n${scratchpadBlock}\n\nAnswer:`,
    maxTokens: answerMaxTokens,
    temperature,
  });

  return {
    answer: answerResponse.text,
    scratchpadFacts: parsed,
    extractCost,
    answerCost: {
      tokensIn: answerResponse.tokensIn,
      tokensOut: answerResponse.tokensOut,
      model: answerResponse.model,
    },
    fallbackUsed: false,
  };
}
