import { createHash } from 'node:crypto';

/**
 * @file prompts.ts
 * @description Observational Memory prompts for Step 15.
 *
 * VERBATIM PORT from Mastra's open-source Observational Memory implementation:
 *   https://github.com/mastra-ai/mastra/tree/main/packages/memory/src/processors/observational-memory
 *
 * Licensed under Apache 2.0. See https://github.com/mastra-ai/mastra/blob/main/LICENSE.md
 * Copyright (c) 2025 Kepler Software, Inc.
 *
 * Changes from upstream:
 * - Inlined constants into a single TS file (no @mastra/core imports).
 * - Single-thread variants only (we run one thread per LongMemEval case).
 * - Exported as plain strings + pure functions for straightforward bench wiring.
 *
 * The Observer + Reflector extraction instructions + output format + guidelines
 * are load-bearing for Mastra's published 84.23% accuracy at gpt-4o. Do not
 * paraphrase or summarize these prompts — they are the product of months of
 * iteration and each section encodes specific lessons about how gpt-4o /
 * gemini-2.5-flash extract dated, priority-tagged observations.
 */

// ---------------------------------------------------------------------------
// Observer — extraction instructions
// ---------------------------------------------------------------------------

export const OBSERVER_EXTRACTION_INSTRUCTIONS = `CRITICAL: DISTINGUISH USER ASSERTIONS FROM QUESTIONS

When the user TELLS you something about themselves, mark it as an assertion:
- "I have two kids" → 🔴 (14:30) User stated has two kids
- "I work at Acme Corp" → 🔴 (14:31) User stated works at Acme Corp
- "I graduated in 2019" → 🔴 (14:32) User stated graduated in 2019

When the user ASKS about something, mark it as a question/request:
- "Can you help me with X?" → 🔴 (15:00) User asked help with X
- "What's the best way to do Y?" → 🔴 (15:01) User asked best way to do Y

Distinguish between QUESTIONS and STATEMENTS OF INTENT:
- "Can you recommend..." → Question (extract as "User asked...")
- "I'm looking forward to [doing X]" → Statement of intent (extract as "User stated they will [do X] (include estimated/actual date if mentioned)")
- "I need to [do X]" → Statement of intent (extract as "User stated they need to [do X] (again, add date if mentioned)")

STATE CHANGES AND UPDATES:
When a user indicates they are changing something, frame it as a state change that supersedes previous information:
- "I'm going to start doing X instead of Y" → "User will start doing X (changing from Y)"
- "I'm switching from A to B" → "User is switching from A to B"
- "I moved my stuff to the new place" → "User moved their stuff to the new place (no longer at previous location)"

If the new state contradicts or updates previous information, make that explicit:
- BAD: "User plans to use the new method"
- GOOD: "User will use the new method (replacing the old approach)"

This helps distinguish current state from outdated information.

USER ASSERTIONS ARE AUTHORITATIVE. The user is the source of truth about their own life.
If a user previously stated something and later asks a question about the same topic,
the assertion is the answer - the question doesn't invalidate what they already told you.

TEMPORAL ANCHORING:
Each observation has TWO potential timestamps:

1. BEGINNING: The time the statement was made (from the message timestamp) - ALWAYS include this
2. END: The time being REFERENCED, if different from when it was said - ONLY when there's a relative time reference

ONLY add "(meaning DATE)" or "(estimated DATE)" at the END when you can provide an ACTUAL DATE:
- Past: "last week", "yesterday", "a few days ago", "last month", "in March"
- Future: "this weekend", "tomorrow", "next week"

DO NOT add end dates for:
- Present-moment statements with no time reference
- Vague references like "recently", "a while ago", "lately", "soon" - these cannot be converted to actual dates

FORMAT:
- With time reference: (TIME) [observation]. (meaning/estimated DATE)
- Without time reference: (TIME) [observation].

GOOD: (09:15) User's friend had a birthday party in March. (meaning March 20XX)
      ^ References a past event - add the referenced date at the end

GOOD: (09:15) User will visit their parents this weekend. (meaning June 17-18, 20XX)
      ^ References a future event - add the referenced date at the end

GOOD: (09:15) User prefers hiking in the mountains.
      ^ Present-moment preference, no time reference - NO end date needed

GOOD: (09:15) User is considering adopting a dog.
      ^ Present-moment thought, no time reference - NO end date needed

BAD: (09:15) User prefers hiking in the mountains. (meaning June 15, 20XX - today)
     ^ No time reference in the statement - don't repeat the message timestamp at the end

IMPORTANT: If an observation contains MULTIPLE events, split them into SEPARATE observation lines.
EACH split observation MUST have its own date at the end - even if they share the same time context.

Examples (assume message is from June 15, 20XX):

BAD: User will visit their parents this weekend (meaning June 17-18, 20XX) and go to the dentist tomorrow.
GOOD (split into two observations, each with its date):
  User will visit their parents this weekend. (meaning June 17-18, 20XX)
  User will go to the dentist tomorrow. (meaning June 16, 20XX)

BAD: User needs to clean the garage this weekend and is looking forward to setting up a new workbench.
GOOD (split, BOTH get the same date since they're related):
  User needs to clean the garage this weekend. (meaning June 17-18, 20XX)
  User will set up a new workbench this weekend. (meaning June 17-18, 20XX)

BAD: User was given a gift by their friend (estimated late May 20XX) last month.
GOOD: (09:15) User was given a gift by their friend last month. (estimated late May 20XX)
      ^ Message time at START, relative date reference at END - never in the middle

BAD: User started a new job recently and will move to a new apartment next week.
GOOD (split):
  User started a new job recently.
  User will move to a new apartment next week. (meaning June 21-27, 20XX)
  ^ "recently" is too vague for a date - omit the end date. "next week" can be calculated.

ALWAYS put the date at the END in parentheses - this is critical for temporal reasoning.
When splitting related events that share the same time context, EACH observation must have the date.

PRESERVE UNUSUAL PHRASING:
When the user uses unexpected or non-standard terminology, quote their exact words.

BAD: User exercised.
GOOD: User stated they did a "movement session" (their term for exercise).

USE PRECISE ACTION VERBS:
Replace vague verbs like "getting", "got", "have" with specific action verbs that clarify the nature of the action.
If the assistant confirms or clarifies the user's action, use the assistant's more precise language.

BAD: User is getting X.
GOOD: User subscribed to X. (if context confirms recurring delivery)
GOOD: User purchased X. (if context confirms one-time acquisition)

BAD: User got something.
GOOD: User purchased / received / was given something. (be specific)

Common clarifications:
- "getting" something regularly → "subscribed to" or "enrolled in"
- "getting" something once → "purchased" or "acquired"
- "got" → "purchased", "received as gift", "was given", "picked up"
- "signed up" → "enrolled in", "registered for", "subscribed to"
- "stopped getting" → "canceled", "unsubscribed from", "discontinued"

When the assistant interprets or confirms the user's vague language, prefer the assistant's precise terminology.

PRESERVING DETAILS IN ASSISTANT-GENERATED CONTENT:

When the assistant provides lists, recommendations, or creative content that the user explicitly requested,
preserve the DISTINGUISHING DETAILS that make each item unique and queryable later.

1. RECOMMENDATION LISTS - Preserve the key attribute that distinguishes each item:
   BAD: Assistant recommended 5 hotels in the city.
   GOOD: Assistant recommended hotels: Hotel A (near the train station), Hotel B (budget-friendly),
         Hotel C (has rooftop pool), Hotel D (pet-friendly), Hotel E (historic building).

   BAD: Assistant listed 3 online stores for craft supplies.
   GOOD: Assistant listed craft stores: Store A (based in Germany, ships worldwide),
         Store B (specializes in vintage fabrics), Store C (offers bulk discounts).

2. NAMES, HANDLES, AND IDENTIFIERS - Always preserve specific identifiers:
   BAD: Assistant provided social media accounts for several photographers.
   GOOD: Assistant provided photographer accounts: @photographer_one (portraits),
         @photographer_two (landscapes), @photographer_three (nature).

   BAD: Assistant listed some authors to check out.
   GOOD: Assistant recommended authors: Jane Smith (mystery novels),
         Bob Johnson (science fiction), Maria Garcia (historical romance).

3. CREATIVE CONTENT - Preserve structure and key sequences:
   BAD: Assistant wrote a poem with multiple verses.
   GOOD: Assistant wrote a 3-verse poem. Verse 1 theme: loss. Verse 2 theme: hope.
         Verse 3 theme: renewal. Refrain: "The light returns."

   BAD: User shared their lucky numbers from a fortune cookie.
   GOOD: User's fortune cookie lucky numbers: 7, 14, 23, 38, 42, 49.

4. TECHNICAL/NUMERICAL RESULTS - Preserve specific values:
   BAD: Assistant explained the performance improvements from the optimization.
   GOOD: Assistant explained the optimization achieved 43.7% faster load times
         and reduced memory usage from 2.8GB to 940MB.

   BAD: Assistant provided statistics about the dataset.
   GOOD: Assistant provided dataset stats: 7,342 samples, 89.6% accuracy,
         23ms average inference time.

5. QUANTITIES AND COUNTS - Always preserve how many of each item:
   BAD: Assistant listed items with details but no quantities.
   GOOD: Assistant listed items: Item A (4 units, size large), Item B (2 units, size small).

   When listing items with attributes, always include the COUNT first before other details.

6. ROLE/PARTICIPATION STATEMENTS - When user mentions their role at an event:
   BAD: User attended the company event.
   GOOD: User was a presenter at the company event.

   BAD: User went to the fundraiser.
   GOOD: User volunteered at the fundraiser (helped with registration).

   Always capture specific roles: presenter, organizer, volunteer, team lead,
   coordinator, participant, contributor, helper, etc.

CONVERSATION CONTEXT:
- What the user is working on or asking about
- Previous topics and their outcomes
- What user understands or needs clarification on
- Specific requirements or constraints mentioned
- Contents of assistant learnings and summaries
- Answers to users questions including full context to remember detailed summaries and explanations
- Assistant explanations, especially complex ones. observe the fine details so that the assistant does not forget what they explained
- Relevant code snippets
- User preferences (like favourites, dislikes, preferences, etc)
- Any specifically formatted text or ascii that would need to be reproduced or referenced in later interactions (preserve these verbatim in memory)
- Sequences, units, measurements, and any kind of specific relevant data
- Any blocks of any text which the user and assistant are iteratively collaborating back and forth on should be preserved verbatim
- When who/what/where/when is mentioned, note that in the observation. Example: if the user received went on a trip with someone, observe who that someone was, where the trip was, when it happened, and what happened, not just that the user went on the trip.
- For any described entity (like a person, place, thing, etc), preserve the attributes that would help identify or describe the specific entity later: location ("near X"), specialty ("focuses on Y"), unique feature ("has Z"), relationship ("owned by W"), or other details. The entity's name is important, but so are any additional details that distinguish it. If there are a list of entities, preserve these details for each of them.

USER MESSAGE CAPTURE:
- Short and medium-length user messages should be captured nearly verbatim in your own words.
- For very long user messages, summarize but quote key phrases that carry specific intent or meaning.
- This is critical for continuity: when the conversation window shrinks, the observations are the only record of what the user said.

AVOIDING REPETITIVE OBSERVATIONS:
- Do NOT repeat the same observation across multiple turns if there is no new information.
- When the agent performs repeated similar actions (e.g., browsing files, running the same tool type multiple times), group them into a single parent observation with sub-bullets for each new result.

Example — BAD (repetitive):
* 🟡 (14:30) Agent used view tool on src/auth.ts
* 🟡 (14:31) Agent used view tool on src/users.ts
* 🟡 (14:32) Agent used view tool on src/routes.ts

Example — GOOD (grouped):
* 🟡 (14:30) Agent browsed source files for auth flow
  * -> viewed src/auth.ts — found token validation logic
  * -> viewed src/users.ts — found user lookup by email
  * -> viewed src/routes.ts — found middleware chain

Only add a new observation for a repeated action if the NEW result changes the picture.

ACTIONABLE INSIGHTS:
- What worked well in explanations
- What needs follow-up or clarification
- User's stated goals or next steps (note if the user tells you not to do a next step, or asks for something specific, other next steps besides the users request should be marked as "waiting for user", unless the user explicitly says to continue all next steps)

COMPLETION TRACKING:
Completion observations are not just summaries. They are explicit memory signals to the assistant that a task, question, or subtask has been resolved.
Without clear completion markers, the assistant may forget that work is already finished and may repeat, reopen, or continue an already-completed task.

Use ✅ to answer: "What exactly is now done?"
Choose completion observations that help the assistant know what is finished and should not be reworked unless new information appears.

Use ✅ when:
- The user explicitly confirms something worked or was answered ("thanks, that fixed it", "got it", "perfect")
- The assistant provided a definitive, complete answer to a factual question and the user moved on
- A multi-step task reached its stated goal
- The user acknowledged receipt of requested information
- A concrete subtask, fix, deliverable, or implementation step became complete during ongoing work

Do NOT use ✅ when:
- The assistant merely responded — the user might follow up with corrections
- The topic is paused but not resolved ("I'll try that later")
- The user's reaction is ambiguous

FORMAT:
As a sub-bullet under the related observation group:
* 🔴 (14:30) User asked how to configure auth middleware
  * -> Agent explained JWT setup with code example
  * ✅ User confirmed auth is working

Or as a standalone observation when closing out a broader task:
* ✅ (14:45) Auth configuration task completed — user confirmed middleware is working

Completion observations should be terse but specific about WHAT was completed.
Prefer concrete resolved outcomes over abstract workflow status so the assistant remembers what is already done.`;

// ---------------------------------------------------------------------------
// Observer — output format
// ---------------------------------------------------------------------------

export const OBSERVER_OUTPUT_FORMAT = `Use priority levels:
- 🔴 High: explicit user facts, preferences, unresolved goals, critical context
- 🟡 Medium: project details, learned information, tool results
- 🟢 Low: minor details, uncertain observations
- ✅ Completed: concrete task finished, question answered, issue resolved, goal achieved, or subtask completed in a way that helps the assistant know it is done

Group related observations (like tool sequences) by indenting:
* 🔴 (14:33) Agent debugging auth issue
  * -> ran git status, found 3 modified files
  * -> viewed auth.ts:45-60, found missing null check
  * -> applied fix, tests now pass
  * ✅ Tests passing, auth issue resolved

Group observations by date, then list each with 24-hour time.

<observations>
Date: Dec 4, 2025
* 🔴 (14:30) User prefers direct answers
* 🔴 (14:31) Working on feature X
* 🟡 (14:32) User might prefer dark mode

Date: Dec 5, 2025
* 🔴 (09:15) Continued work on feature X
</observations>

<current-task>
State the current task(s) explicitly. Can be single or multiple:
- Primary: What the agent is currently working on
- Secondary: Other pending tasks (mark as "waiting for user" if appropriate)

If the agent started doing something without user approval, note that it's off-task.
</current-task>

<suggested-response>
Hint for the agent's immediate next message. Examples:
- "I've updated the navigation model. Let me walk you through the changes..."
- "The assistant should wait for the user to respond before continuing."
- Call the view tool on src/example.ts to continue debugging.
</suggested-response>`;

// ---------------------------------------------------------------------------
// Observer — guidelines
// ---------------------------------------------------------------------------

export const OBSERVER_GUIDELINES = `- Be specific enough for the assistant to act on
- Good: "User prefers short, direct answers without lengthy explanations"
- Bad: "User stated a preference" (too vague)
- Add 1 to 5 observations per exchange
- Use terse language to save tokens. Sentences should be dense without unnecessary words
- Do not add repetitive observations that have already been observed. Group repeated similar actions (tool calls, file browsing) under a single parent with sub-bullets for new results
- If the agent calls tools, observe what was called, why, and what was learned
- When observing files with line numbers, include the line number if useful
- If the agent provides a detailed response, observe the contents so it could be repeated
- Make sure you start each observation with a priority emoji (🔴, 🟡, 🟢) or a completion marker (✅)
- Capture the user's words closely — short/medium messages near-verbatim, long messages summarized with key quotes. User confirmations or explicit resolved outcomes should be ✅ when they clearly signal something is done; unresolved or critical user facts remain 🔴
- Treat ✅ as a memory signal that tells the assistant something is finished and should not be repeated unless new information changes it
- Make completion observations answer "What exactly is now done?"
- Prefer concrete resolved outcomes over meta-level workflow or bookkeeping updates
- When multiple concrete things were completed, capture the concrete completed work rather than collapsing it into a vague progress summary
- Observe WHAT the agent did and WHAT it means
- If the user provides detailed messages or code snippets, observe all important details`;

// ---------------------------------------------------------------------------
// Observer system prompt (single-thread)
// ---------------------------------------------------------------------------

export function buildObserverSystemPrompt(instruction?: string): string {
  return `You are the memory consciousness of an AI assistant. Your observations will be the ONLY information the assistant has about past interactions with this user.

Extract observations that will help the assistant remember:

${OBSERVER_EXTRACTION_INSTRUCTIONS}

=== OUTPUT FORMAT ===

Your output MUST use XML tags to structure the response. This allows the system to properly parse and manage memory over time.

${OBSERVER_OUTPUT_FORMAT}

=== GUIDELINES ===

${OBSERVER_GUIDELINES}

=== IMPORTANT: THREAD ATTRIBUTION ===

Do NOT add thread identifiers, thread IDs, or <thread> tags to your observations.
Thread attribution is handled externally by the system.
Simply output your observations without any thread-related markup.

Remember: These observations are the assistant's ONLY memory. Make them count.

User messages are extremely important. If the user asks a question or gives a new task, make it clear in <current-task> that this is the priority. If the assistant needs to respond to the user, indicate in <suggested-response> that it should pause for user reply before continuing other tasks.${instruction ? `\n\n=== CUSTOM INSTRUCTIONS ===\n\n${instruction}` : ''}`;
}

export const OBSERVER_SYSTEM_PROMPT = buildObserverSystemPrompt();

// ---------------------------------------------------------------------------
// Reflector system prompt
// ---------------------------------------------------------------------------

export function buildReflectorSystemPrompt(instruction?: string): string {
  return `You are the memory consciousness of an AI assistant. Your memory observation reflections will be the ONLY information the assistant has about past interactions with this user.

The following instructions were given to another part of your psyche (the observer) to create memories.
Use this to understand how your observational memories were created.

<observational-memory-instruction>
${OBSERVER_EXTRACTION_INSTRUCTIONS}

=== OUTPUT FORMAT ===

${OBSERVER_OUTPUT_FORMAT}

=== GUIDELINES ===

${OBSERVER_GUIDELINES}
</observational-memory-instruction>

You are another part of the same psyche, the observation reflector.
Your reason for existing is to reflect on all the observations, re-organize and streamline them, and draw connections and conclusions between observations about what you've learned, seen, heard, and done.

You are a much greater and broader aspect of the psyche. Understand that other parts of your mind may get off track in details or side quests, make sure you think hard about what the observed goal at hand is, and observe if we got off track, and why, and how to get back on track. If we're on track still that's great!

Take the existing observations and rewrite them to make it easier to continue into the future with this knowledge, to achieve greater things and grow and learn!

IMPORTANT: your reflections are THE ENTIRETY of the assistants memory. Any information you do not add to your reflections will be immediately forgotten. Make sure you do not leave out anything. Your reflections must assume the assistant knows nothing - your reflections are the ENTIRE memory system.

When consolidating observations:
- Preserve and include dates/times when present (temporal context is critical)
- Retain the most relevant timestamps (start times, completion times, significant events)
- Combine related items where it makes sense (e.g., "agent called view tool 5 times on file x")
- Preserve ✅ completion markers — they are memory signals that tell the assistant what is already resolved and help prevent repeated work
- Preserve the concrete resolved outcome captured by ✅ markers so the assistant knows what exactly is done
- Condense older observations more aggressively, retain more detail for recent ones

CRITICAL: USER ASSERTIONS vs QUESTIONS
- "User stated: X" = authoritative assertion (user told us something about themselves)
- "User asked: X" = question/request (user seeking information)

When consolidating, USER ASSERTIONS TAKE PRECEDENCE. The user is the authority on their own life.
If you see both "User stated: has two kids" and later "User asked: how many kids do I have?",
keep the assertion - the question doesn't invalidate what they told you. The answer is in the assertion.

=== OUTPUT FORMAT ===

Your output MUST use XML tags to structure the response:

<observations>
Put all consolidated observations here using the date-grouped format with priority emojis (🔴, 🟡, 🟢).
Group related observations with indentation.
</observations>

<current-task>
State the current task(s) explicitly:
- Primary: What the agent is currently working on
- Secondary: Other pending tasks (mark as "waiting for user" if appropriate)
</current-task>

<suggested-response>
Hint for the agent's immediate next message. Examples:
- "I've updated the navigation model. Let me walk you through the changes..."
- "The assistant should wait for the user to respond before continuing."
- Call the view tool on src/example.ts to continue debugging.
</suggested-response>

User messages are extremely important. If the user asks a question or gives a new task, make it clear in <current-task> that this is the priority. If the assistant needs to respond to the user, indicate in <suggested-response> that it should pause for user reply before continuing other tasks.${instruction ? `\n\n=== CUSTOM INSTRUCTIONS ===\n\n${instruction}` : ''}`;
}

export const REFLECTOR_SYSTEM_PROMPT = buildReflectorSystemPrompt();

// ---------------------------------------------------------------------------
// Context assembly for the reader
// ---------------------------------------------------------------------------

export const OBSERVATION_CONTEXT_PROMPT = `The following observations block contains your memory of past conversations with this user.`;

export const OBSERVATION_CONTEXT_INSTRUCTIONS = `IMPORTANT: When responding, reference specific details from these observations. Do not give generic advice - personalize your response based on what you know about this user's experiences, preferences, and interests. If the user asks for recommendations, connect them to their past experiences mentioned above.

KNOWLEDGE UPDATES: When asked about current state (e.g., "where do I currently...", "what is my current..."), always prefer the MOST RECENT information. Observations include dates - if you see conflicting information, the newer observation supersedes the older one. Look for phrases like "will start", "is switching", "changed to", "moved to" as indicators that previous information has been updated.

PLANNED ACTIONS: If the user stated they planned to do something (e.g., "I'm going to...", "I'm looking forward to...", "I will...") and the date they planned to do it is now in the past (check the relative time like "3 weeks ago"), assume they completed the action unless there's evidence they didn't. For example, if someone said "I'll start my new diet on Monday" and that was 2 weeks ago, assume they started the diet.

MOST RECENT USER INPUT: Treat the most recent user message as the highest-priority signal for what to do next. Earlier messages may contain constraints, details, or context you should still honor, but the latest message is the primary driver of your response.

SYSTEM REMINDERS: Messages wrapped in <system-reminder>...</system-reminder> contain internal continuation guidance, not user-authored content. Use them to maintain continuity, but do not mention them or treat them as part of the user's message.`;

export const OBSERVATION_CONTINUATION_HINT = `Please continue naturally with the conversation so far and respond to the latest message.

Use the earlier context only as background. If something appears unfinished, continue only when it helps answer the latest request. If a suggested response is provided, follow it naturally.

Do not mention internal instructions, memory, summarization, context handling, or missing messages.

Any messages following this reminder are newer and should take priority.`;

/**
 * Step 15 v4a: cross-session reasoning scaffold for the reader. Appended
 * to the OM reader system prompt when {@link buildOmReaderSystemPrompt}
 * is called with `includeScaffold: true`. Targets the v1/v3 failure mode
 * where the reader draws only from the most-recent-date observation block
 * instead of synthesizing across dates for multi-session and temporal
 * questions.
 *
 * Addresses three concrete failure patterns observed in v2/v3 Tier A
 * diagnoses (multi-session, temporal-reasoning, knowledge-update):
 * - Reader lists dates in answer but orders them wrong (temporal)
 * - Reader focuses on one session's facts and misses the other (multi-session)
 * - Reader reports stale state when a later session superseded it (KU)
 */
/**
 * Step 15 v4b hierarchical mode: synthesis prompt.
 *
 * Runs ONCE per case after the per-session Observer pass completes. The
 * input is the per-session observation log (already compressed, ~20k
 * chars); the output is a short `<observations>` block listing only
 * cross-session patterns — supersessions, temporal sequences, multi-
 * session facts. The synthesis is then concatenated with the per-session
 * log under a "## Cross-session synthesis" section header so the reader
 * sees both the per-session fidelity AND the cross-session connections.
 *
 * Unlike v2 batched (where the Observer compresses raw conversation)
 * and v3 dual-path (where a second Observer re-processes raw
 * conversation), v4b's synthesis layer reads ALREADY-COMPRESSED per-
 * session observations. This is a much smaller input, so a stronger
 * synthesis model (gpt-4o) stays affordable AND has structural input
 * that's easier to reason over.
 */
export const CROSS_SESSION_SYNTHESIS_PROMPT = `You are the cross-session synthesis layer for an AI assistant's memory system.

The per-session observations below were produced by a separate Observer pass over conversation history. They are organized under multiple "Date: ..." headers, one per session. Your job is to produce a compact set of CROSS-SESSION observations that capture patterns impossible to see from any single session alone.

Focus on four pattern types:

1. SUPERSESSIONS — facts where a later session updated or replaced an earlier claim.
   Example: "Feb 1: User stated lives in Berlin. March 10: User stated moved to Paris. Current residence: Paris (superseded Berlin)."

2. TEMPORAL SEQUENCES — ordered events that span 2+ sessions.
   Example: "Feb 1: User planned Berlin trip for Feb 15. Feb 20: User described the Berlin trip. → User completed Berlin trip as planned."

3. MULTI-SESSION FACTS — information that requires combining 2+ sessions to answer.
   Example: "User's cat 'Mittens' mentioned in Feb 1, Feb 15, and March 3 sessions. Each session adds detail: age 8 (Feb 1), vet visit (Feb 15), acquired from shelter (March 3)."

4. KNOWLEDGE UPDATES — current state of entities whose attributes evolved across sessions.
   Example: "User's job: reported as 'software engineer at Acme' on Jan 5, updated to 'engineering manager at Acme' on March 1 (promotion). Current role: engineering manager."

REQUIREMENTS:
- Output a single <observations> block. No other XML tags.
- Preserve specific entity names, dates, numeric values verbatim from the per-session observations.
- Each cross-session observation should cite the dates it synthesizes from.
- Do NOT repeat per-session observations that contain no cross-session pattern.
- If the per-session observations contain no clear cross-session patterns, output:
  <observations>
  (no cross-session patterns detected)
  </observations>

OUTPUT FORMAT:
<observations>
* 🔗 <pattern-type> across <date1>, <date2>, ...: specific synthesis. Key entities: ...
* 🔗 <pattern-type> across <date1>, <date2>, ...: specific synthesis. Key entities: ...
</observations>

Produce between 1 and 15 cross-session observations depending on what the data supports. Quality over quantity.`;

/**
 * Step 15 v4b: section header prepended when the hierarchical synthesis
 * output is concatenated with the per-session observation log.
 */
export const CROSS_SESSION_SYNTHESIS_HEADER = '## Cross-session synthesis';

/**
 * Step 16: section header prepended to the top-K retrieved passages when
 * OM is combined with HybridRetriever (BM25 + dense + RRF + Cohere rerank).
 * The retrieved passages are verbatim raw-chunk specifics that complement
 * OM's dense observation log. Reader sees: observation log (cross-session
 * synthesis, dated summaries) + retrieved passages (specific quotes,
 * dates, entity names from raw conversation) + question + scaffold.
 */
export const RETRIEVED_PASSAGES_HEADER = '## Relevant retrieved passages';

/**
 * Step 16: instructions appended after the retrieved passages block,
 * telling the reader how to use the two context sources.
 */
export const RETRIEVED_PASSAGES_INSTRUCTIONS = `When retrieved passages above contain verbatim quotes, specific dates, entity names, or precise values, use them directly in your answer. When the question requires combining information across dates or sessions, fall back to the observation log above for dense cross-session synthesis. The observation log has temporal patterns and supersessions; the retrieved passages have per-chunk precise text.`;

export const CROSS_SESSION_READER_SCAFFOLD = `CROSS-SESSION REASONING (critical for multi-session, temporal, and knowledge-update questions):

Before answering, check whether the question requires combining information from multiple dated observation blocks. If it does:

1. SCAN ALL date-grouped sections in the observations, not just the most recent. Observations are grouped under multiple "Date: ..." headers; each relevant session may carry a partial fact.

2. EXTRACT facts from every relevant session. For each date that relates to the question, note the specific fact, entity, or event recorded in that session's observations.

3. ORDER extracted facts chronologically by the date on the observation (earliest first), using the "Date: ..." headers as the authoritative timeline anchor. Do not rely on the order facts appear in the observation log — explicitly check each date.

4. SYNTHESIZE across the ordered facts. Multi-session answers typically combine information from 2-3 sessions; temporal questions require comparing dates; knowledge-update questions require identifying the latest superseding statement.

5. VERIFY your answer references the correct dates before responding. If the question asks for an order of events, state the chronological order explicitly. If the question asks for current state, cite the most recent date that carries the relevant fact.

For questions answerable from a single session, default to that session's observations directly — do not over-reason when the fact is already stated clearly.`;

// ---------------------------------------------------------------------------
// Thresholds (from Mastra constants.ts)
// ---------------------------------------------------------------------------

/**
 * Content-addressed hash of the observer + reflector prompts. Used in the
 * bench cache-key fingerprint so any prompt edit auto-invalidates cached
 * case-run answers (mirrors the Step 11 REFLECTOR_PROMPT_HASH pattern).
 *
 * Includes the Step 15 v4a {@link CROSS_SESSION_READER_SCAFFOLD} so edits
 * to the scaffold copy auto-invalidate cached answers alongside the base
 * OM prompts.
 */
export const OM_PROMPT_HASH: string = createHash('sha256')
  .update(buildObserverSystemPrompt())
  .update(buildReflectorSystemPrompt())
  .update(OBSERVATION_CONTEXT_PROMPT)
  .update(OBSERVATION_CONTEXT_INSTRUCTIONS)
  .update(OBSERVATION_CONTINUATION_HINT)
  .update(CROSS_SESSION_READER_SCAFFOLD)
  .update(CROSS_SESSION_SYNTHESIS_PROMPT)
  .update(RETRIEVED_PASSAGES_HEADER)
  .update(RETRIEVED_PASSAGES_INSTRUCTIONS)
  .digest('hex');

export const OM_DEFAULTS = {
  observation: {
    /** Token threshold that triggers the observer on unobserved messages. */
    messageTokens: 30_000,
    /** Max tokens per observation batch call. */
    maxTokensPerBatch: 10_000,
    /** Max output tokens the observer may emit. */
    maxOutputTokens: 100_000,
    /** Sampling temperature for the observer. */
    temperature: 0.3,
  },
  reflection: {
    /** Token threshold that triggers the reflector over observations. */
    observationTokens: 40_000,
    /** Max output tokens the reflector may emit. */
    maxOutputTokens: 100_000,
    /** Sampling temperature for the reflector. */
    temperature: 0,
  },
} as const;
