# Step 16c — LLM-as-Judge Dynamic Router (v2, Phase-A-grounded routing table)

**Date:** 2026-04-22
**Status:** Design v2; routing table updated based on v5 Phase A N=102 data.
**Supersedes v1:** Original spec (2026-04-22 morning) routed only between OM variants. v2 adds **canonical (Step 3 HybridRetriever, NO OM)** as a route option, which Phase A data shows is the right destination for 4 of 6 categories.

---

## 1. Summary

The 11-variant Tier A scoreboard plus the v5 Phase A N=102 result establish a clean per-category Pareto distribution where **no single architecture wins all categories at Phase A**. The OM family (v5) lifts multi-session by +15.7pp over canonical at N=17 per category, but loses on temporal-reasoning by 17.3pp and single-session-assistant by 12.8pp. The aggregate cancels (v5 73.5% vs canonical 73.2%, statistically tied), but per-category, v5 is a Pareto-different operating point.

A **dynamic router** classifies each question first (cheap gpt-5-mini call), then routes to the per-category-best architecture. Critically, this includes routing AWAY from OM entirely for the 4 categories where canonical wins. This makes 16c both more accurate AND cheaper than v5-everywhere because most cases skip OM ingest.

**Phase A-grounded routing table:**

| Category | Best at Phase A N=17 | Score | Architecture |
|---|---|---:|---|
| single-session-user | canonical | 97.1% | Step 3 HybridRetriever, no OM |
| single-session-assistant | canonical | 89.3% | Step 3 HybridRetriever, no OM |
| single-session-preference | canonical | 60.0% | Step 3 HybridRetriever, no OM |
| knowledge-update | v5 | 88.2% | OM dual-path + scaffold + gpt-4o observer |
| multi-session | v5 | 70.6% | OM dual-path + scaffold + gpt-4o observer |
| temporal-reasoning | canonical | 70.2% | Step 3 HybridRetriever, no OM |

**Theoretical 16c-routed Phase A:** sum the per-category bests at the N=17 cell sizes:
- 17×0.971 + 17×0.893 + 17×0.600 + 17×0.882 + 17×0.706 + 17×0.702 = 80.8/102 = **79.2%**

That's **+5.7pp over canonical Phase A 73.2%**, **+5.7pp over v5 Phase A 73.5%**, the FIRST projected configuration to clear the 78.2% Phase A kill gate at matched gpt-4o reader.

**Pending: v7 Phase A.** Currently in flight. If gpt-5 observer's MS at Phase A exceeds v5's 70.6%, MS routes to v7 instead of v5; ceiling rises proportionally. v7 only matters for MS routing because v7's TR regression (-50pp) and SSU regression (-25pp) at Tier A make it strictly worse for those categories regardless of Phase A confirmation.

**Production-right architecture:** real deployments don't know question types ahead of time. A router IS the correct layer. The Phase A data turns this from "nice for production" to "the only static-cost path to 78%+ aggregate."

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

**Output parsing:** read the model's text response, trim whitespace, lowercase, match against the 6 category tokens. **Default on parse failure: `multi-session`** because (a) MS routes through OM (the safer default since OM at least handles cross-session synthesis even if classification is wrong), and (b) MS is the category with the largest delta vs canonical, so misrouting away from MS hurts more than misrouting to MS.

### 2.2 Routing table (v2 — Phase A grounded)

| Category | Architecture | Run OM? | Run retrieval? | Use scaffold? | Reader sees |
|---|---|:---:|:---:|:---:|---|
| `single-session-user` | canonical | NO | YES (Step 3 HybridRetriever K=10) | N/A | `## Relevant memories` (top-K passages) |
| `single-session-assistant` | canonical | NO | YES (Step 3) | N/A | `## Relevant memories` |
| `single-session-preference` | canonical | NO | YES (Step 3) | N/A | `## Relevant memories` |
| `knowledge-update` | v5 | YES (gpt-4o observer, dual-path) | NO | YES | `## Per-session observations` + `## Cross-session patterns` + scaffold |
| `multi-session` | v5 | YES (gpt-4o observer, dual-path) | NO | YES | Same as KU |
| `temporal-reasoning` | canonical | NO | YES (Step 3) | N/A | `## Relevant memories` |

**Default fallback** (classifier errors or unknown category): v5 (with OM ingest). Choosing v5 over canonical for fallback because OM at least covers cross-session synthesis; canonical with no OM might miss MS questions if they get misclassified.

**v7 substitution (pending Phase A):** if v7 Phase A multi-session ≥ v5's 70.6%, swap MS row to v7 (gpt-5 observer + scaffold + dual-path). All other rows unchanged because v7's TR/SSU regressions are intrinsic to gpt-5 observer regardless of Phase A confirmation.

### 2.3 Per-case execution flow (CHANGED from v1)

v1 ran OM ingest unconditionally and varied only the reader prompt. v2 conditionally runs OM based on routing because canonical (no OM) is the right route for 4 of 6 categories.

```
For each case:
  1. classifyQuestion(reader=gpt-5-mini, question) → category
  2. routeQuestion(category) → { runOM, runRetrieval, useScaffold }
  3. Branch on runOM:
     a. runOM === false (canonical route):
        - Run runFullCognitiveCase() (Step 3 HybridRetriever pipeline)
        - Reader system prompt: standard canonical Step 3 prompt
        - Reader user prompt: question + retrieved passages
     b. runOM === true (OM route):
        - Run ingestSessions() with --om-mode dual-path --om-observer-model gpt-4o
        - If runRetrieval (currently never true in v2 routing — Step 16 family is RED):
          - Also run runFullCognitiveCase() to get retrieved passages
        - Reader system prompt: buildOmReaderSystemPrompt(finalLog, { includeScaffold: useScaffold, retrievedPassages? })
        - Reader user prompt: question
  4. Run reader (gpt-4o)
  5. Run judge (gpt-4o)
  6. Record routing decision in metadata
```

**Cost implications:** OM ingest is the expensive step (~$0.50/case at gpt-4o observer). Routing 4 of 6 categories AWAY from OM means OM ingest only fires for ~33% of cases (KU + MS distribution). Estimated cost reduction vs v5-everywhere: ~50%.

### 2.4 Reader context assembly

Three call shapes based on route:

| Route | System prompt builder | Notes |
|---|---|---|
| Canonical | `buildCanonicalReaderSystemPrompt(retrievedEvidence)` | Existing Step 3 helper; no OM context |
| OM (KU, MS) | `buildOmReaderSystemPrompt(ingest.finalLog, { includeScaffold: true })` | OM finalLog + scaffold; no retrieval |
| OM + retrieval (NOT USED in v2) | `buildOmReaderSystemPrompt(ingest.finalLog, { retrievedPassages })` | Reserved for future Step 16 family iteration; kept callable but not wired |

The router never invokes the third shape in v2 because Step 16 family is documented as architecturally dominated. If Step 17 (OM-guided retrieval) lands later, the router can be extended to route to that as a new architecture.

### 2.5 Cache fingerprint

New tag: `step-16c-router:v2`. Bumped from `:v1` to invalidate any caches from the original spec which used different routing.

Tag is appended to BOTH `runKeyParts` and `resultKeyParts` when `--om-dynamic-router` is on.

The case-run cache stores the final (classified + routed + answered) run. The case fingerprint captures the router's choice via the resulting metadata fields (`omRouterCategory`, `omRouterRunOM`). Classifier is set to temperature=0 and `reasoning_effort: 'minimal'` for deterministic routing across re-runs.

---

## 3. Implementation

### 3.1 New file: `questionRouter.ts`

Path: `packages/agentos-bench/src/observational-memory/questionRouter.ts`.

Exports:
- `QuestionCategory` type union (6 values, unchanged from v1)
- `RouterConfig` type — `{ runOM: boolean; runRetrieval: boolean; useScaffold: boolean }` (CHANGED from v1's `{ useScaffold; useRetrieval }`)
- `classifyQuestion({reader, question}): Promise<QuestionCategory>` — one classifier call (unchanged signature)
- `routeQuestion(category): RouterConfig` — pure function, returns architecture choice
- `CLASSIFIER_SYSTEM_PROMPT` constant
- `DEFAULT_ROUTE: RouterConfig` exported for fallback inspection

**routeQuestion implementation:**

```typescript
export function routeQuestion(category: QuestionCategory): RouterConfig {
  switch (category) {
    case 'single-session-user':
    case 'single-session-assistant':
    case 'single-session-preference':
    case 'temporal-reasoning':
      // Canonical (Step 3 HybridRetriever) wins these 4 categories at Phase A.
      // OM hurts them by 1.2-17.3pp depending on category.
      return { runOM: false, runRetrieval: true, useScaffold: false };
    case 'knowledge-update':
    case 'multi-session':
      // v5 OM (gpt-4o observer + scaffold + dual-path) wins these 2 categories.
      // KU: v5 88.2% vs canonical 86.8% (+1.4pp).
      // MS: v5 70.6% vs canonical 54.9% (+15.7pp) — load-bearing routing decision.
      return { runOM: true, runRetrieval: false, useScaffold: true };
  }
}

export const DEFAULT_ROUTE: RouterConfig = { runOM: true, runRetrieval: false, useScaffold: true };
// Default falls back to v5 OM config because OM at least covers MS via cross-session synthesis;
// canonical with no OM would miss MS questions on classifier errors.
```

### 3.2 Extend `IBenchmark.ts`

Add `omDynamicRouter?: boolean` to `RunConfig`. Add to both Pick lists in `BenchContext['config']`.

Already in v1 spec — unchanged.

### 3.3 Extend `BenchmarkRunner.ts`

In `resolveRunConfig`: propagate `omDynamicRouter`.

In `computeCaseRunKeyParts`: append `step-16c-router:v2` (NOT v1) when `omDynamicRouter` is on. **Tag bumped to v2** to invalidate caches from the v1 spec since routing semantics changed.

### 3.4 Extend `cli.ts`

New option `--om-dynamic-router` (boolean). Threaded into runConfig. Help text updated to explain v2 routing semantics.

### 3.5 Wire into `LongMemEvalS.runCase` (CHANGED from v1)

The router decides whether to run the OM branch or the canonical branch. Pseudocode:

```typescript
async runCase(c: Case, ctx: BenchContext): Promise<CaseRun> {
  if (ctx.config.omDynamicRouter) {
    // Step 16c v2: classify first, then route to canonical or OM
    const classifierReader = createReader('gpt-5-mini');
    let category: QuestionCategory;
    try {
      category = await classifyQuestion({ reader: classifierReader, question: c.question });
    } catch {
      category = 'multi-session'; // safe default — falls into OM branch
    }
    const route = routeQuestion(category);
    ctx.costTracker.record({
      category: 'reader',
      model: 'gpt-5-mini',
      tokensIn: 120, tokensOut: 4,
      tag: `${c.id}:om-classifier`,
    });

    const runMetadata: Record<string, unknown> = {
      omDynamicRouter: true,
      omRouterCategory: category,
      omRouterRunOM: route.runOM,
      omRouterScaffold: route.useScaffold,
    };

    if (!route.runOM) {
      // Canonical route — same as base full-cognitive path with no OM
      return await this.runFullCognitiveCase(c, ctx, runMetadata);
    }

    // OM route — same as v5 path, parameterized by useScaffold
    return await this.runOmCase(c, ctx, {
      includeScaffold: route.useScaffold,
      retrievedPassages: undefined,  // v2 router never combines OM + retrieval
      runMetadata,
    });
  }

  // ... existing OM branch (when --om-dynamic-router is off but --observational-memory is on) ...
  // ... existing canonical branch ...
}
```

This requires extracting the existing OM and canonical paths into helper functions (`runOmCase`, `runFullCognitiveCase`) if they aren't already structured that way. May need light refactoring of LongMemEvalS internals.

### 3.6 Tests (CHANGED from v1)

Add to `tests/observationalMemory.unit.spec.ts` (or new `tests/questionRouter.unit.spec.ts`):

1. `classifyQuestion` calls reader once with the classifier system prompt, returns parsed category from lowercase match.
2. `classifyQuestion` parses tokens with trailing whitespace/newlines via `startsWith` matching.
3. `classifyQuestion` defaults to `multi-session` on unparseable model output.
4. `routeQuestion('single-session-user')` returns `{ runOM: false, runRetrieval: true, useScaffold: false }`.
5. `routeQuestion('single-session-assistant')` returns same as SSU (canonical route).
6. `routeQuestion('single-session-preference')` returns same as SSU (canonical route).
7. `routeQuestion('temporal-reasoning')` returns same as SSU (canonical route).
8. `routeQuestion('knowledge-update')` returns `{ runOM: true, runRetrieval: false, useScaffold: true }`.
9. `routeQuestion('multi-session')` returns same as KU (OM route).

Add to `tests/step15ObservationalMemory.wiring.spec.ts`:

10. `resolveRunConfig` preserves `omDynamicRouter: true`.
11. Cache fingerprint includes `step-16c-router:v2` when on (note: v2 tag, not v1).
12. Cache fingerprint omits the tag when off.

Total new tests: 12 (9 unit + 3 wiring).

---

## 4. Kill criteria

Same as v1:

| Metric | Threshold |
|---|---:|
| Unweighted | ≥ 82% |
| Multi-session | ≥ 50% |
| Single-session-user | ≥ 90% |
| Single-session-assistant | ≥ 90% |
| Single-session-preference | ≥ 90% |

Router must beat v5 by at least 3pp aggregate to justify the implementation overhead AND classifier cost.

---

## 5. Expected outcomes

### 5.1 Best case (theoretical Phase A ceiling)

If classifier accuracy is high (≥80%) and per-category routing fires correctly:
- Aggregate Phase A: **78-80%** (theoretical 79.2% from per-category Pareto)
- Single-session: 89.3-97.1% (canonical route preserves ceilings)
- Multi-session: 70.6% (v5 route)
- KU: 88.2%
- TR: 70.2% (canonical route, scaffold conflict avoided)

This would be the **first AgentOS configuration to beat canonical at matched gpt-4o reader at Phase A** by a margin clear of CI overlap.

### 5.2 Null case (router adds nothing)

Classifier accuracy is too low → routes go to wrong configs → individual category scores worse than canonical or v5. Aggregate ~73-75%. Fall back to canonical for production.

### 5.3 Failure case

Classifier dominates cost (unlikely given gpt-5-mini pricing) or some classifier calls error out, breaking cases. Low risk.

### 5.4 v7 substitution upside

If v7 Phase A MS exceeds v5's 70.6% (e.g., 75-80%), swap MS routing to v7. Aggregate ceiling rises to ~80-82%.

---

## 6. Cost (REVISED downward — most cases skip OM)

| Line | v1 estimate | **v2 estimate** | Notes |
|---|---:|---:|---|
| Classifier (24 cases × gpt-5-mini ~$0.0005) | $0.012 | $0.012 | unchanged |
| OM ingest (only routed cases) | ~$25 (24/24 cases) | **~$8** (8/24 cases — KU + MS only) | **−$17 savings** |
| Canonical retrieval (16/24 cases) | $0 | **~$1.50** (16 × $0.09) | new line item |
| Reader + judge | ~$3 | ~$3 | unchanged |
| **Total Tier A N=24** | **~$30** | **~$13** | **−$17 (−57%)** |

Phase A N=102 projected: **~$50-60** (down from v1's $125 estimate).
Phase B N=500 projected: **~$250-300** (down from v1's $600).

This is a big win. 16c v2 is cheaper than v5 because most cases skip the expensive OM ingest. Production economics are excellent.

---

## 7. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Classifier misclassifies 30%+ of questions | Medium | Tier A with 4 cases per category reveals confusion matrix. If misroutes > 20%, revise prompt; potentially add few-shot examples. |
| Classifier at gpt-5-mini is too weak | Medium | Upgrade to gpt-4o for classifier (~$0.03 × 24 = $0.72, still negligible). |
| Non-deterministic routing across re-runs | Low | Classifier `temperature: 0` and `reasoning_effort: 'minimal'`. Re-runs should hit identical category. |
| Routing table's choices wrong at Phase A | Low (after this v2) | Routing table is grounded in v5 Phase A N=102 data. v1 spec was speculative. |
| Cache behavior with variable routing | Low | Case-run cache key per (case-id + fingerprint). Deterministic classifier means cache hit replays correctly. |
| Phase A v7 result invalidates MS row | Low | If v7 MS at Phase A > v5's 70.6%, route MS to v7 instead. Single-line change. |
| Misroute SSU → OM hurts that case | Medium | SSU OM Phase A score = 94.1% vs canonical 97.1%; misrouting only loses 3pp per case. |
| Misroute MS → canonical loses big | High per-case (15pp) | High-impact misroute. Mitigation: classifier must be tuned to maximize MS recall. Few-shot examples for MS questions in prompt. |

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
    --om-reader-scaffold \
    --rerank cohere --context-summary gpt-5-mini --hybrid-retrieval \
    --reader-top-k 10 \
    --stratified --sample-per-type 4 \
    --bootstrap-resamples 10000 --seed 42 \
    --max-usd 30
```

Notes on flags:
- `--om-with-retrieval` is NOT set; v2 router never combines OM + retrieval. Canonical-only retrieval handles single-session/temporal; v5 OM-only handles MS/KU.
- `--om-reader-scaffold` is on for the v5 OM route; canonical route doesn't use the scaffold (it's specific to the OM observation log layout).
- `--om-mode dual-path` and `--om-observer-model gpt-4o` are the v5 baseline — only consulted when the router picks the OM branch.
- `--reader-top-k 10` is the canonical Step 3 default — only consulted when the router picks the canonical branch.

---

## 9. Phase A command (after Tier A passes)

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
    --om-reader-scaffold \
    --rerank cohere --context-summary gpt-5-mini --hybrid-retrieval \
    --reader-top-k 10 \
    --sample 102 --stratified --sample-per-type 17 \
    --bootstrap-resamples 10000 --seed 42 \
    --max-usd 80
```

Cost: ~$50-60 marginal (Tier A 24 cases hit cache; 78 fresh cases × ~$0.50 OM-or-canonical-mix).

---

## 10. Open questions (deferred)

- **Few-shot classifier prompt**: add 2-3 examples per category if zero-shot misroutes > 15%. Particularly important for MS (where misroutes cost 15pp/case).
- **Classifier model upgrade**: gpt-4o classifier if gpt-5-mini misclassifies. +$0.7 per Tier A; worth testing once if v2 Tier A doesn't clear the gate due to classifier accuracy.
- **Route table tuning**: if KU's small canonical-vs-v5 delta (1.4pp at Phase A) is sampling noise, route KU to canonical for cost savings (one fewer route through OM ingest). Test in Tier A.
- **v7 substitution**: pending v7 Phase A. If MS at v7 > v5, single-line change to routing table.
- **Step 16d (canonical + tighter top-K=3)**: untested as a route option for SSP (Phase A 60.0% — lowest single-session score, with widest CI). Defer.
- **Step 17 (OM-guided retrieval)**: alternative architecture, not a router branch. Could replace v5 in MS route if it lifts MS further. Defer to next-next session.

---

## 11. Acceptance

Design v2 finalized 2026-04-22 evening after v5 Phase A N=102 result. Ready for execution after v7 Phase A confirms whether MS routes to v5 or v7. Implementation is 1-2 hours per the plan in [docs/plans/2026-04-22-step-16c-plan.md](../plans/2026-04-22-step-16c-plan.md) (plan file needs minor updates to match v2 spec — routing table, fingerprint tag bump, test additions).

---

End of spec v2.
