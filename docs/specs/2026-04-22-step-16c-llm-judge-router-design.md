# Step 16c — LLM-as-Judge Dynamic Router

**Date:** 2026-04-22
**Status:** Design approved; ready for fresh-session execution
**Supersedes:** None. Extends Steps 15 v5 + Step 16 + Step 16b.

---

## 1. Summary

The 7-variant scoreboard shows each LongMemEval question type has a different optimal OM configuration. No single static config wins across all categories:

- Single-session questions want OM dual-path + gpt-4o observer, scaffold **off** (scaffold makes the reader over-think simple lookups).
- Knowledge-update wants OM + retrieval top-K=3 (needs BOTH compressed supersession signals AND the specific chunk where the update was stated).
- Multi-session wants OM + retrieval top-K=3 (retrieval surfaces specific cross-session chunks; OM synthesizes).
- Temporal-reasoning wants OM dual-path + scaffold ON (scaffold is load-bearing — scored 75% vs 25% without).
- Single-session-preference is a single-session variant — same as single-session-user above.

A **dynamic router** classifies each question up front (via a cheap gpt-5-mini classifier call) and routes to the per-question-type-optimal config. Expected lift over best static config: **+3-6pp aggregate** because each question gets its optimal strategy.

**Production-right architecture**: real deployments don't know question types ahead of time. A router IS the correct layer. Even if Tier A shows only marginal benefit, 16c is the config to ship for real-world use.

---

## 2. Architecture

### 2.1 Classifier step

One call per question, BEFORE the OM ingest and answer call.

**Input:** question text only (no haystack, no memory context).

**Model:** `gpt-5-mini` (cheap, good at short classification tasks).

**Prompt (draft — iterate based on Tier A observations):**

```
You are classifying a memory-system question into one of six categories.

Return ONLY the category token (no explanation, no quotes, no punctuation).

Categories:
- single-session-user: the question asks about something the USER said, did, or stated in a specific past session. Answer is in one session. Examples: "What did I tell you about my favorite dessert?", "Where did I say I moved to last month?"
- single-session-assistant: the question asks about something the ASSISTANT said, generated, or recommended in a specific session. Answer is in one session. Examples: "What recipe did you suggest for the birthday party?", "What books did you recommend to me?"
- single-session-preference: the question asks about a preference the user stated in passing. Answer is in one session. Examples: "Do I prefer tea or coffee?", "What's my favorite type of movie?"
- knowledge-update: the question asks about current state where the answer EVOLVED across sessions (supersession). Examples: "What's my current job title?", "Where do I live now?", "What's my latest project?"
- multi-session: the question requires combining information from 2+ separate sessions. Examples: "How many different languages have I mentioned studying?", "Which authors did you recommend across our conversations?"
- temporal-reasoning: the question asks about the order, timing, or duration of events across time. Examples: "In what order did I visit the three countries?", "How many months ago did I start the new job?"

Question: {question_text}

Category:
```

**Output parsing:** read the model's text response, trim whitespace, lowercase, match against the 6 category tokens. Default to `multi-session` on parse failure (most challenging + benefits most from both OM and retrieval).

### 2.2 Routing table

| Category | Config | Rationale |
|---|---|---|
| `single-session-user` | v5 WITHOUT scaffold | Reader doesn't over-think; fact is in one session block. |
| `single-session-assistant` | v5 WITHOUT scaffold | Same reasoning. |
| `single-session-preference` | v5 WITHOUT scaffold | Same. |
| `knowledge-update` | Step 16b (v5 + retrieval top-K=3) | Need both supersession synthesis (OM) AND specific chunk where update was stated (retrieval). |
| `multi-session` | Step 16b (v5 + retrieval top-K=3) | Need both cross-session synthesis (OM) AND specific cross-session chunks (retrieval). |
| `temporal-reasoning` | v5 WITH scaffold | Scaffold is load-bearing (+50pp from 25% to 75% observed). |

**Default fallback** (classifier errors, unknown category): v5 WITH scaffold (best single-config average).

### 2.3 Observation pipeline

**Critical optimization:** OM ingest is the expensive step (~$1 per case at gpt-4o observer). We run OM **once per case**, produce the finalLog, and reuse across all routing branches. Only the reader's system prompt varies per route.

- `single-session-*` + `temporal-reasoning` routes: reader sees OM finalLog only. Retrieval NOT run.
- `knowledge-update` + `multi-session` routes: reader sees OM finalLog AND retrieved top-K=3 passages.

This means: for each case, we run OM ingest unconditionally, then classify, then EITHER skip retrieval (4 of 6 categories) OR run retrieval (2 of 6). On average ~1/3 of cases trigger retrieval pipeline.

### 2.4 Reader context assembly

Same as v5 + Step 16 combined — the existing `buildOmReaderSystemPrompt` function (extended in Step 16) handles both paths:

- With scaffold only: `buildOmReaderSystemPrompt(ingest.finalLog, { includeScaffold: true })`
- Without scaffold, without retrieval: `buildOmReaderSystemPrompt(ingest.finalLog)`
- With retrieval (scaffold off, since 16 showed retrieval + scaffold conflict): `buildOmReaderSystemPrompt(ingest.finalLog, { retrievedPassages })`

The router just picks which of these three call shapes to invoke based on classifier output.

### 2.5 Cache fingerprint

New tag: `step-16c-router:v1`. Only appended when `--om-dynamic-router` is on. Placed after existing Step-15 / Step-16 tags in `computeCaseRunKeyParts`.

Note: Step 16c cache behavior is UNIQUE because different cases in the same run get different effective configs. The case-run cache stores the final (classified + routed + answered) run, so from the cache's perspective the fingerprint captures the router's choice for THIS case implicitly via the resulting metadata. But the fingerprint tag itself is just `step-16c-router:v1` — the classifier is non-deterministic at temperature > 0 so the cache assumes idempotent routing given the same question (which it should be).

---

## 3. Implementation

### 3.1 New file: `questionRouter.ts`

Path: `packages/agentos-bench/src/observational-memory/questionRouter.ts`.

Exports:
- `QuestionCategory` type union
- `classifyQuestion({reader, question}): Promise<QuestionCategory>` — one classifier call
- `routeQuestion(category): RouterConfig` — pure function returning `{ useScaffold: boolean; useRetrieval: boolean }`
- `CLASSIFIER_SYSTEM_PROMPT` constant

### 3.2 Extend `IBenchmark.ts`

Add `omDynamicRouter?: boolean` to `RunConfig`. Add to both Pick lists in `BenchContext['config']`.

### 3.3 Extend `BenchmarkRunner.ts`

In `resolveRunConfig`: propagate `omDynamicRouter`.
In `computeCaseRunKeyParts`: append `step-16c-router:v1` when `omDynamicRouter` is on.

### 3.4 Extend `cli.ts`

New option `--om-dynamic-router` (boolean). Also threaded into the runConfig object in the action handler.

### 3.5 Wire into `LongMemEvalS.runCase`

In the OM branch, when `ctx.config.omDynamicRouter` is on:

1. Run OM `ingestSessions` unconditionally (produces finalLog).
2. Call `classifyQuestion({ reader: createReader('gpt-5-mini'), question: c.question })`.
3. Call `routeQuestion(category)` → `{ useScaffold, useRetrieval }`.
4. If `useRetrieval`: run `runFullCognitiveCase` (as Step 16 does) to get `retrievedEvidence`.
5. Build reader system prompt:
   - `useRetrieval === false`: `buildOmReaderSystemPrompt(ingest.finalLog, { includeScaffold: useScaffold })`
   - `useRetrieval === true`: `buildOmReaderSystemPrompt(ingest.finalLog, { retrievedPassages })`
6. Record `runMetadata.omRouterCategory`, `runMetadata.omRouterScaffold`, `runMetadata.omRouterRetrieval`.
7. Cost-tracker records classifier call under `:om-classifier` tag.

### 3.6 Tests

Add to `tests/observationalMemory.unit.spec.ts` (or new `tests/questionRouter.unit.spec.ts`):

1. `classifyQuestion` calls reader once, returns parsed category from lowercase match.
2. `classifyQuestion` defaults to `multi-session` on parse failure.
3. `routeQuestion('single-session-user')` returns `{ useScaffold: false, useRetrieval: false }`.
4. `routeQuestion('temporal-reasoning')` returns `{ useScaffold: true, useRetrieval: false }`.
5. `routeQuestion('multi-session')` returns `{ useScaffold: false, useRetrieval: true }`.
6. `routeQuestion('knowledge-update')` returns `{ useScaffold: false, useRetrieval: true }`.

Add to `tests/step15ObservationalMemory.wiring.spec.ts`:

7. `resolveRunConfig` preserves `omDynamicRouter: true`.
8. Cache fingerprint includes `step-16c-router:v1` when on.
9. Cache fingerprint omits the tag when off.

Total new tests: 9 (6 unit + 3 wiring).

---

## 4. Kill criteria

| Metric | Threshold |
|---|---:|
| Unweighted | ≥ 82% |
| Multi-session | ≥ 50% |
| Single-session-user | ≥ 90% |
| Single-session-assistant | ≥ 90% |
| Single-session-preference | ≥ 90% |

Same thresholds as 16b. Router must beat v5 by at least 3pp aggregate to justify the extra classifier complexity.

---

## 5. Expected outcomes

### 5.1 Best case

- Aggregate: 84-87%
- Single-session: all 100% (scaffold-off route preserves the v5 ceiling)
- Multi-session: 55-65% (retrieval route helps)
- KU: 85-90% (retrieval route helps)
- Temporal: 75-80% (scaffold route keeps the v5 score)

This would put AgentOS AT Mastra OM gpt-4o's 84.23% using OpenAI-only.

### 5.2 Null case (router adds nothing)

Classifier accuracy is too low → routes go to wrong configs → individual category scores worse than v5. Aggregate ~78-80%. Fall back to v5.

### 5.3 Failure case

Classifier dominates cost (unlikely given gpt-5-mini pricing) or some classifier calls error out, breaking cases. Low risk.

---

## 6. Cost

| Line | Cost |
|---|---:|
| Classifier calls (24 cases × gpt-5-mini ~$0.0005) | $0.012 |
| OM ingest (24 cases × ~$1 each, gpt-4o observer) | ~$25 |
| Retrieval pipeline (≤ 8 cases × ~$0.05) | ~$0.40 |
| Reader + judge | ~$3 |
| **Total Tier A N=24** | **~$30** |

Lower than Step 16 because retrieval only fires for ~1/3 of cases.

Phase A N=102 projected: ~$125.
Phase B N=500 projected: ~$600.

---

## 7. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Classifier misclassifies 30%+ of questions | Medium | Tier A with 6 cases per category reveals the confusion matrix. If classifier misroutes > 20%, revise prompt; potentially add few-shot examples. |
| Classifier at gpt-5-mini is too weak | Medium | Upgrade to gpt-4o for classifier (~$0.03 × 24 = $0.72, still negligible). |
| Non-deterministic routing across re-runs | Low | Classifier temperature set to 0. |
| Routing table's config choices are wrong | Medium | Table encodes our 7-variant empirical findings. If wrong, Tier A reveals which categories lose; iterate table. |
| Cache behavior with variable routing | Low | Case-run cache key is per-case-id + fingerprint; doesn't capture classifier output. If classifier is deterministic (temp=0), cache hit replays correctly. |

---

## 8. Tier A command

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant && \
  set -a && source apps/wilds-ai/.env && set +a && \
  OPENAI_API_KEY="$OPENAI_API_KEY" COHERE_API_KEY="$COHERE_API_KEY" \
  pnpm --filter @framers/agentos-bench bench run longmemeval-s \
    --reader gpt-4o --judge-model gpt-4o \
    --memory full-cognitive --replay ingest \
    --observational-memory \
    --om-dynamic-router \
    --om-mode dual-path --om-batch-tokens 24000 \
    --om-observer-model gpt-4o \
    --rerank cohere --context-summary gpt-5-mini --hybrid-retrieval \
    --reader-top-k 3 \
    --stratified --sample-per-type 4 \
    --bootstrap-resamples 10000 --seed 42 \
    --max-usd 60
```

Note: `--om-reader-scaffold` and `--om-with-retrieval` are NOT set on the CLI — the router flag overrides them per-case.

---

## 9. Open questions (deferred)

- **Few-shot classifier prompt**: add 2-3 examples per category to the classifier system prompt if raw zero-shot misroutes > 15%. Test in Tier A.
- **Classifier model upgrade**: gpt-4o classifier if gpt-5-mini is too weak. +$0.7 per Tier A; worth testing once.
- **Route table tuning per ablation**: if scaffold helps KU too, add to `knowledge-update` route. Route table is data-driven; iterate.
- **Fallback category**: when classifier returns ambiguous text, default to `multi-session`. Could instead default to `single-session-user` since it's most common in LongMemEval-S (n=70 of 500). Test both defaults.

---

## 10. Acceptance

Design finalized 2026-04-22 end-of-session. Ready for execution in fresh session per [NEXT_SESSION_CONTINUATION_2026-04-22_FINAL.md](../NEXT_SESSION_CONTINUATION_2026-04-22_FINAL.md) §6.2.

End of spec.
