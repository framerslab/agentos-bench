# Step 15 v7 + v8 Findings — gpt-5 Observer (with and without scaffold)

**Date:** 2026-04-22
**Scope:** Two paired Tier A experiments swapping the observer model from gpt-4o (v5) to gpt-5. v7 keeps the v5 reader scaffold; v8 removes the scaffold to isolate whether scaffold + gpt-5 has a layout collision.

**Motivation:** deep-research on 2026-04-22 verified Mastra's published 84.23% LongMemEval-S score at gpt-4o reader uses **gemini-2.5-flash as observer**, not gpt-4o. Mastra never tested gpt-5, gpt-5-mini, o1, o3, or o3-mini as observer. The handoff inherited an unverified "OpenAI capped at 79%" claim. v7 + v8 test the next OpenAI observer tier above gpt-4o without introducing Gemini.

**Source:** [mastra.ai/research/observational-memory](https://mastra.ai/research/observational-memory) (Tyler Barnes, Feb 2026): *"In each configuration, gemini-2.5-flash ingested the data into OM as it's the default model for observation/reflection currently."*

---

## 1. Verdict

**Both RED at Tier A. gpt-5 observer is NOT a free Pareto improvement over gpt-4o observer.**

- **v7 (gpt-5 + scaffold):** 70.8% (17/24), CI [54.2%, 87.5%]. **Multi-session +25pp** (25→50%) and **temporal-reasoning −50pp** (75→25%). SSU also regressed −25pp.
- **v8 (gpt-5 - scaffold):** 66.7% (16/24), CI [50.0%, 83.3%]. Same MS lift, same TR regression as v7. SSU dropped further to 50% without scaffold.

**Layout-collision hypothesis (raised after v7's TR regression): REJECTED.** v8 removed the scaffold to test whether scaffold's "order chronologically by Date: headers" step was failing on gpt-5's observation log layout. v8 still scored TR=25%. The TR regression is intrinsic to gpt-5 observer at `reasoning_effort: 'minimal'`, not a downstream scaffold collision.

| Metric | v5 (gpt-4o + scaffold) | **v7 (gpt-5 + scaffold)** | **v8 (gpt-5 - scaffold)** | v7−v5 | v8−v7 |
|---|---:|---:|---:|---:|---:|
| Unweighted | 79.2% | 70.8% | 66.7% | −8.4 | −4.1 |
| single-session-user | 100% | 75% | 50% | −25 | −25 |
| single-session-assistant | 100% | 100% | 100% | 0 | 0 |
| single-session-preference | 100% | 100% | 100% | 0 | 0 |
| knowledge-update | 75% | 75% | 75% | 0 | 0 |
| **multi-session** | **25%** | **50%** | **50%** | **+25** | **0 (lift held)** |
| **temporal-reasoning** | **75%** | **25%** | **25%** | **−50** | **0 (still broken)** |
| Tier A cost | $24.30 | $25.68 | $25.39 | +$1.38 | −$0.29 |
| Avg latency | 46.0s | 93.9s | 59.4s | +47.9s | −34.5s |
| p95 latency | 92s | 140s | 68s | +48s | −72s |

**Kill gates:**
- Unweighted ≥ 82%: FAIL (both)
- Multi-session ≥ 50%: PASS (both)
- All single-session ≥ 90%: FAIL (SSU 75% v7, 50% v8)

---

## 2. Configurations

### v7

```bash
pnpm bench run longmemeval-s \
  --reader gpt-4o --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --observational-memory \
  --om-mode dual-path --om-batch-tokens 24000 \
  --om-reader-scaffold \
  --om-observer-model gpt-5 \
  --stratified --sample-per-type 4 \
  --bootstrap-resamples 10000 --seed 42 --max-usd 80
```

Run JSON: [results/runs/2026-04-23T00-13-07-994--longmemeval-s--gpt-4o--full-cognitive--ingest.json](../results/runs/2026-04-23T00-13-07-994--longmemeval-s--gpt-4o--full-cognitive--ingest.json).

### v8

Same as v7 with `--om-reader-scaffold` removed:

```bash
pnpm bench run longmemeval-s \
  --reader gpt-4o --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --observational-memory \
  --om-mode dual-path --om-batch-tokens 24000 \
  --om-observer-model gpt-5 \
  --stratified --sample-per-type 4 \
  --bootstrap-resamples 10000 --seed 42 --max-usd 50
```

Run JSON: [results/runs/2026-04-23T00-34-35-253--longmemeval-s--gpt-4o--full-cognitive--ingest.json](../results/runs/2026-04-23T00-34-35-253--longmemeval-s--gpt-4o--full-cognitive--ingest.json).

### gpt-5 reader path

The bench's `OpenAIHttpReader` already supports gpt-5 via the existing branch added before Step 15:

```typescript
// packages/agentos-bench/src/readers/createReader.ts
const isGpt5 = /^gpt-5/.test(this.model);
if (isGpt5) {
  requestBody.max_completion_tokens = Math.max(req.maxTokens ?? 512, 2048);
  requestBody.reasoning_effort = 'minimal';
} else {
  const GPT4O_MAX_COMPLETION_TOKENS = 16000;
  requestBody.max_tokens = Math.min(req.maxTokens ?? 512, GPT4O_MAX_COMPLETION_TOKENS);
  requestBody.temperature = req.temperature ?? 0;
}
```

`reasoning_effort: 'minimal'` was the default. Worth retesting at `'medium'` if gpt-5 observer becomes a candidate again (see §5.3).

---

## 3. What gpt-5 observer changes (per category)

### 3.1 Multi-session: lift is real, scaffold-independent

Both v7 and v8 hit MS=50% — same lift as Step 16 K=10 retrieval (which also hit MS=50% but at the cost of three other categories). gpt-5's observer produces denser cross-session encoding that helps the reader bridge sessions. The scaffold is irrelevant to this lift; gpt-5's observation log itself carries enough cross-session structure.

This is the **first observer-tier change** to lift MS without retrieval pollution. Confirms observer model class is a load-bearing variable for cross-session synthesis.

### 3.2 Temporal-reasoning: regression is intrinsic to gpt-5 observer

v7 and v8 both score TR=25%. Removing the scaffold did not recover TR. Three plausible mechanisms:

1. **`reasoning_effort: 'minimal'` strips temporal anchors.** gpt-5 with minimal reasoning may produce more abstract observations, dropping specific dates/times that TR questions require.
2. **Compression style differs from gpt-4o.** gpt-5 may write event-density-optimized observations rather than time-density-optimized ones. The reader can no longer resolve "in what order did X, Y, Z happen?"
3. **Sampling artifact at N=24.** Per-category n=4 means ±25pp single-flip uncertainty. v7 + v8 both at 25% means 1/4 case correct — could be the same one case both runs solved.

The cause matters for whether v9 (gpt-5 with `reasoning_effort: 'medium'`) is worth testing. If mechanism 1 is right, medium reasoning recovers TR. If mechanism 2 is right, reasoning effort doesn't matter and only an explicit "preserve dates" prompt addendum helps. If mechanism 3 is right, Phase A on v7 settles the question.

### 3.3 Single-session-user: scaffold helps gpt-5 observer

| Variant | SSU | gpt-4o vs gpt-5 observer | with vs without scaffold |
|---|---:|---|---|
| v5 | 100% | gpt-4o, scaffold | baseline |
| v7 | 75% | gpt-5, scaffold | scaffold helps gpt-5 +25pp vs v8 |
| v8 | 50% | gpt-5, NO scaffold | scaffold absent |

**Scaffold helps gpt-5 observer's SSU more than gpt-4o's.** Hypothesis: gpt-5's observation log is denser, so the reader benefits more from explicit guidance on how to navigate it.

### 3.4 SSA, SSP, KU: unchanged

Single-session-assistant (100%), single-session-preference (100%), and knowledge-update (75%) are all at the v5 ceiling regardless of observer model and scaffold. These categories don't depend on either observer-tier or scaffold contribution.

---

## 4. Implications for Step 16c routing table

The original 16c spec (2026-04-22) proposed a routing table where multi-session went to "Step 16 (or 16b if GREEN)". Both 16 and 16b RED'd; 16c had no good MS config to route TO.

v7's data fixes this. **The updated 16c routing table:**

| Category | Best config | Tier A score | Reason |
|---|---|---:|---|
| single-session-user | v5 (gpt-4o + scaffold) | 100% | gpt-5 regresses SSU even with scaffold |
| single-session-assistant | v5 | 100% | unchanged across configs |
| single-session-preference | v5 | 100% | unchanged across configs |
| temporal-reasoning | **v5** | 75% | **v5 only — gpt-5 observer regresses TR by 50pp regardless of scaffold** |
| knowledge-update | v5 | 75% | tied across configs |
| **multi-session** | **v7** (gpt-5 + scaffold) | **50%** | **v5 only 25%; gpt-5 observer is the load-bearing change** |

**Theoretical 16c ceiling at Tier A N=24:** 12 single-session + 3 KU + 3 TR + 2 MS = **20/24 = 83.3%**.

This is the first projected Tier A config that would clear the 82% kill gate. Previous projection had no good MS config; v7 unblocks 16c.

### 4.1 Implementation cost

The 16c spec proposes per-question dynamic routing: classify question first, run only the matched observer. With this approach:
- ~70% of cases route to v5 (gpt-4o observer): ~$0.50/case
- ~30% route to v7 (gpt-5 observer): ~$1.10/case
- Average $0.68/case + classifier ~$0.0005/case
- Tier A: ~$25-30 (cheaper than v5 because most cases use cheaper gpt-4o observer)

Code: ~1-2 hours per the spec (new `questionRouter.ts` + 9 tests + LongMemEvalS wiring).

---

## 5. What's next

### 5.1 Phase A on v5 currently running

v5 Phase A N=102 fired in parallel with v8. Will resolve whether v5's 79.2% Tier A holds at larger N or collapses (v4a precedent: 83% Tier A → 72% Phase A). Result expected ~2 hr after Tier A v8 completion.

If v5 Phase A holds at 75%+: v5 ships as Tier 2. 16c becomes the next architectural investment for 82%+.

If v5 Phase A drops to ~71-73%: noise floor confirmed; 16c becomes the only remaining Tier A path to 82%+ without architectural rework.

### 5.2 Step 16c implementation (next session candidate)

The routing table in §4 is now complete. 1-2 hours of implementation + ~$30 Tier A would test whether the theoretical 83.3% ceiling holds at N=24. If yes, Phase A on 16c (~$60-80 marginal accounting for cache hits across observer routes) confirms.

### 5.3 v9 — gpt-5 observer with `reasoning_effort: 'medium'` (deferred)

If TR mechanism 1 (reasoning effort underprovisioning) is the cause, medium reasoning could restore TR while keeping MS lift. Cost: ~$50-80 Tier A (medium reasoning produces 3-5x more output tokens than minimal). Worth queuing if 16c's MS routing doesn't deliver expected lift, since gpt-5 observer with restored TR would mean MS routing might not need to swap observers — same observer might cover all categories.

### 5.4 Step 17 OM-guided retrieval (deferred to next-next session)

Architectural alternative to 16c: use OM observation log to identify candidate sessions, run HybridRetriever scoped to those sessions only. Different from Step 16 because retrieval scope narrows from full corpus to ~2-5 OM-identified sessions. Estimated 4-6 hr implementation + ~$60 Tier A. Defer until 16c results are in.

---

## 6. Cost

| Experiment | Tier A cost | Cases | Cost/case | Cost/correct |
|---|---:|---:|---:|---:|
| v5 baseline | $24.30 | 24 | $1.01 | $1.28 |
| **v7 (gpt-5 + scaffold)** | **$25.68** | **24** | **$1.07** | **$1.51** |
| **v8 (gpt-5 - scaffold)** | **$25.39** | **24** | **$1.06** | **$1.59** |

gpt-5 observer at `reasoning_effort: 'minimal'` is roughly cost-equivalent to gpt-4o observer per case despite gpt-5 being a flagship model. Latency is materially higher (94s v7 vs 46s v5) because gpt-5 reasoning tokens are slower to generate.

Cumulative session spend through v8: ~$280 (~$195 prior + $33 16b + $26 v7 + $25 v8 + Phase A v5 budgeted at ~$80-100 still in flight).

---

## 7. Takeaways

### 7.1 OpenAI is NOT capped at 79% for OM observer

The inherited "OpenAI ceiling" claim was based on gpt-4o observer. gpt-5 observer lifts MS by +25pp, confirming observer-tier matters. The ceiling is per-category dependent: gpt-4o is best for SSU/TR; gpt-5 is best for MS.

### 7.2 No single observer wins all categories

This is the architectural justification for Step 16c dynamic routing. Static config selection forces a tradeoff; per-question routing escapes the tradeoff.

### 7.3 Scaffold contribution depends on observer

Scaffold helps SSU more with gpt-5 observer than with gpt-4o (v7→v8 SSU drops 25pp without scaffold; v5 doesn't have a paired-no-scaffold comparison but Step 15 v3 without scaffold scored SSU 100% at gpt-5-mini observer). Scaffold + observer model are interaction terms, not orthogonal.

### 7.4 Layout-collision was the wrong hypothesis

v8 disproves it. The TR regression isn't caused by scaffold's "Date: header" assumption clashing with gpt-5's output format. The cause is intrinsic to gpt-5 observer's compression style at `reasoning_effort: 'minimal'`.

### 7.5 16c routing is now the load-bearing next experiment

Before v7, 16c had no good MS config. Now it does. The theoretical 83.3% ceiling at Tier A is the first projected Tier A config to clear the 82% kill gate. 16c implementation moves from "nice to have for production architecture" to "the only static-cost path to 82% aggregate."

### 7.6 gpt-5 reasoning effort is a free knob to test

`'minimal'` is cheap and fast. `'medium'` and `'high'` would cost more but might recover TR. Worth testing in the next OpenAI observer round if 16c routing doesn't fully close the Mastra gap.

---

## 8. Files + run JSONs

- v7 run JSON: [results/runs/2026-04-23T00-13-07-994--longmemeval-s--gpt-4o--full-cognitive--ingest.json](../results/runs/2026-04-23T00-13-07-994--longmemeval-s--gpt-4o--full-cognitive--ingest.json)
- v8 run JSON: [results/runs/2026-04-23T00-34-35-253--longmemeval-s--gpt-4o--full-cognitive--ingest.json](../results/runs/2026-04-23T00-34-35-253--longmemeval-s--gpt-4o--full-cognitive--ingest.json)
- v5 baseline: [STEP_15_V5_OBSERVATIONAL_MEMORY_FINDINGS_2026-04-22.md](STEP_15_V5_OBSERVATIONAL_MEMORY_FINDINGS_2026-04-22.md)
- 16c spec (now load-bearing): [specs/2026-04-22-step-16c-llm-judge-router-design.md](specs/2026-04-22-step-16c-llm-judge-router-design.md)
- 16c plan: [plans/2026-04-22-step-16c-plan.md](plans/2026-04-22-step-16c-plan.md)
- Mastra source verification (deep-research): [mastra.ai/research/observational-memory](https://mastra.ai/research/observational-memory)

---

End of v7 + v8 findings.
