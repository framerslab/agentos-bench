# Step 8 Findings — Observer/Reflector REPLACEMENT Semantics (Tier 2 Fix)

**Date:** 2026-04-20
**Scope:** Tier 2 architectural fix for Step 7's additive-overlay RED. Addresses root causes #1 (additive → replacement) and #2 (BM25 index mismatch) via new `flushReflection` method on `CognitiveMemoryManager` + session-boundary reflection + BM25 indexing of reflection-derived trace IDs.
**Spec:** [2026-04-20-step-8-observer-replacement-design.md](../../agentos/docs/superpowers/specs/2026-04-20-step-8-observer-replacement-design.md)
**Plan:** [2026-04-20-step-8-observer-replacement.md](../../agentos/docs/superpowers/plans/2026-04-20-step-8-observer-replacement.md)

---

## Verdict: RED at Tier A

Two Tier A runs, both killed:

| Run | Config | LME-S N=24 unweighted | Δ vs Tier 1 87.5% | Notes |
|---|---|---:|---:|---|
| First | replace + scope bug (reflector invented scopeIds) | 4.2% (1/24) | -83.3pp | traces landed in wrong vector-store collections |
| Second | replace + scope fix (`flushReflection` scopeOverride) | **25.0%** (6/24) | **-62.5pp** | scope fix worked; replacement semantics itself still fails |

Phase A and Phase B NOT executed per plan §7.4.

### Per-category breakdown (run 2, after scope fix)

| Category | n | Accuracy | Tier 1 baseline | Δ |
|---|---:|---:|---:|---:|
| single-session-preference | 4 | 75.0% | 100% | -25pp |
| single-session-user | 4 | 50.0% | 100% | -50pp |
| multi-session | 4 | 25.0% | 75% | -50pp |
| knowledge-update | 4 | **0.0%** | 100% | -100pp |
| single-session-assistant | 4 | **0.0%** | 100% | -100pp |
| temporal-reasoning | 4 | **0.0%** | 100% | -100pp |
| **Unweighted** | 24 | **25.0%** | 87.5% | **-62.5pp** |

Cost: $3.50 total, $0.58/correct (27× Tier 1 $0.0213).

The pattern is clear: REPLACEMENT preserves **abstract category information** (preferences summarize cleanly) but destroys **specific-value recall** (KU, assistant, temporal all flat-line at 0%).

---

## Two bugs + the architectural lesson

### Bug 1: Reflector-invented scopeIds (fixed mid-rollout)

The first Tier A run scored 4.2% because `MemoryReflector.reflect()` lets the LLM invent scopeIds based on content topics. LME-S reflections produced scopeIds like `running_01`, `wellbeing_01`, `linkedin_01`, `thread_keycloak_15_0_2`, `politics_iraq_01`, `furniture_01`, `sports_summary_01`. The bench retrieval path queries `scope: 'user', scopeId: 'bench'`. The reflection traces landed in separate vector-store collections from where retrieval queries looked. Nothing matched.

**Fix:** added a `scopeOverride` parameter to `CognitiveMemoryManager.flushReflection()`. Bench adapter passes `{ scope: 'user', scopeId: 'bench' }`. Reflection traces now land in the same collection as retrieval queries. Committed as `34167a9f7` in framersai/agentos.

After the fix + cache invalidation (`observer-reflector:replace-v2` fingerprint), accuracy moved from 4.2% → 25.0%. Scope fix worked. But the 25.0% is still RED.

### Bug 2 (conceptual): LLM summaries don't retain specific tokens

The remaining 62.5pp gap vs Tier 1 is architectural, not plumbing. Replacement semantics replace raw chunks with reflection-derived summaries. Summaries are:
- **Good at preferences** (category-level facts survive summarization): 75% vs Tier 1's 100%.
- **OK at user facts** (50% — personal facts sometimes survive): 50% vs 100%.
- **Bad at knowledge-update** (0% — supersession detail is lost in compression).
- **Bad at single-session-assistant** (0% — the hero chunk was a direct statement that got paraphrased away).
- **Bad at temporal-reasoning** (0% — specific dates and ordinals disappear).

This is the **same failure mode as Step 5 FactSupersession**: LLM-generated text over retrieved traces erases the specific tokens the reader needs. Step 5 RED'd at post-retrieval; Step 8 RED'd at ingest-via-reflection. The LLM layer is the common cause.

### Why Mastra's 84% doesn't reproduce here

[Mastra's Observational Memory](https://mastra.ai/research/observational-memory) reports 84.23% at gpt-4o on LongMemEval-S. Our faithful-replacement implementation at the same reader scores 25%. Possible reasons:

1. **Their reflector prompt preserves specifics better than ours.** `MemoryReflector`'s current prompt tells the LLM to "consolidate" and "elevate important facts." In practice gpt-5-mini produces abstract summaries. Mastra likely has a prompt tuned to preserve high-IDF tokens (names, dates, numeric values).
2. **Their retrieval path does something we don't.** Mastra might weight their observation log differently from raw chunks, or retrieve both and rank observations higher.
3. **Different reader behavior on compressed context.** Mastra's gpt-4o might do better with dense summaries than ours does.
4. **Not directly reproducible.** The 84.23% is a self-reported number on their specific stack. Matching stacks exactly would require running their open-source code end-to-end. Out of scope here.

The honest conclusion: **Observer/Reflector as a replacement mechanism on LongMemEval-S underperforms Step 3 Hybrid + raw chunks** in our implementation. A tuned reflector prompt is the most likely gap, but verifying it would take another 2-3 spec cycles.

---

## What ships

- Code commits (feature-gated):
  - `34167a9f7` fix(memory): `flushReflection` scopeOverride param (ships the underlying bug fix regardless of Tier 2 verdict)
  - Bench-side: `--observer-reflector-replace` flag, cache-key fingerprint `observer-reflector:replace-v2`, session-boundary flush logic in `replayForCognitive`
  - All opt-in, default-off
- Findings doc (this file).
- Two run JSONs in `packages/agentos-bench/results/runs/` (one per Tier A attempt).

The `flushReflection` scope-override is **architecturally correct** and **genuinely useful to downstream AgentOS consumers** even if Tier 2 itself RED'd. Callers that want reflection traces under a specific scope now have the API for it.

---

## What does NOT ship

- No production default flip. Tier 1 Hybrid remains the default.
- Phase A + Phase B NOT run.
- LOCOMO + Oracle Tier A NOT run (kill was decisive on LME-S).

---

## Cost accounting

| Run | USD | Notes |
|---|---:|---|
| Tier A Run 1 (scope bug) | $3.70 | 24 cases, reflection traces landed in wrong collections |
| Tier A Run 2 (scope fix, cache-v2) | $3.50 | 24 cases with fix |
| Tier A LOCOMO, Oracle | $0 | skipped per kill |
| Phase A, Phase B | $0 | skipped per kill |
| **Total** | **$7.20** | Within $28 spec cap |

Total Step 8 cost: $7.20. Well under the $28 hard cap and within the user's "hundreds" budget signal.

Cost/correct on the better run: **$0.58** (vs Tier 1 $0.0213). The ingest-side reflection LLM calls dominate the cost: ~40 sessions × 24 cases × $0.001 per gpt-5-mini session flush = ~$1 of observer+reflector calls alone, plus reader + judge.

---

## Updated Progressive Enhancement Tier scoreboard

| Tier | Flags | Measured accuracy | $/correct | Status |
|---|---|---:|---:|---|
| Tier 0 (bare) | (none) | ~60% projected | ~$0.032 | untested |
| Tier 1 (default) | `--hybrid-retrieval --context-summary` | **73.2%** [69.2%, 77.0%] | **$0.0213** | **ships** |
| Tier 2 ADDITIVE (Step 7 RED) | Tier 1 + `--observer-reflector` | 62.5% at N=24 | ~$0.10+ | RED, opt-in |
| **Tier 2 REPLACEMENT (Step 8 RED)** | Tier 1 + `--observer-reflector --observer-reflector-replace` | **25.0% at N=24** | **$0.58** | **RED, opt-in** |
| Tier 3 (Step 9 candidate) | + `--fact-graph-ingest` (Mem0 pattern) | TBD | TBD | spec pending |
| Tier 4 (Step 10 candidate) | + `--two-call-reader` (Emergence pattern) | TBD | TBD | spec pending |

Two Tier 2 variants tested, both RED. Tier 2 as currently implemented in AgentOS does not help on LongMemEval-S at gpt-4o reader.

---

## Commits (Step 8)

Agentos core (framersai/agentos):
- `30fda0c93` feat(memory): getReflector() accessor + flushReflection() for forced reflection at caller boundaries
- `34167a9f7` fix(memory): flushReflection scopeOverride param — ensures reflection traces land in caller's scope, not LLM-invented one

Monorepo:
- `9a27b82ae0` bench: RunConfig.observerReflectorReplace + cache-key fingerprint + integration tests
- `33b72b355e` bench: --observer-reflector-replace CLI flag + entry.build passthrough
- `7106cdb2eb` bench: LongMemEvalS REPLACEMENT mode — skip raw encode, flushReflection at session boundaries, index reflections into BM25
- `3e1f8a897f` bench: Locomo adapter --observer-reflector-replace propagation
- `f2c615b013` bench: flushReflection scope override — force reflection traces into bench scope
- `182f792e3a` bench: bump observer-reflector:replace -> :replace-v2 fingerprint (invalidate cache from pre-scope-fix first run)

---

## Lessons for Step 9

1. **LLM-generated intermediate representations (summaries, reflections) lose the specific tokens LongMemEval needs.** Step 5 RED'd on post-retrieval LLM filter. Step 7 RED'd on additive LLM reflection overlay. Step 8 RED'd on LLM reflection replacement. The pattern is consistent: any intermediate LLM step that transforms retrieval content regresses on factual-value benchmarks.
2. **Mem0's 92% might work because fact extraction preserves the actual tokens.** Mem0 extracts (subject, predicate, object, timestamp) TUPLES per turn, not natural-language summaries. The object field retains the literal value. If Step 9 implements this faithfully, the specific-value erasure failure mode doesn't apply.
3. **`flushReflection` shipped** as a general-purpose agentos-core addition with scope override. Downstream consumers get a usable primitive even though Tier 2 itself RED'd.
4. **Kill-criterion discipline still paying for itself.** $7.20 at Tier A instead of $28+ for a full rollout of a known-dead variant.

---

## Rollback

Not required. `--observer-reflector-replace` defaults off. Tier 1 production stack unchanged.

If a future operator deletes the infrastructure:
- Revert the 6 bench commits + 2 agentos commits above (though the scope-override fix is worth keeping as a standalone improvement).
- `CASE_RUN_SCHEMA_VERSION` stays `'v8'`.

---

## Recommendation

**Step 9 (fact-graph ingest, Mem0 pattern) is the next candidate.** Different mechanism: per-turn LLM extraction of structured tuples instead of natural-language summaries. If specific-value preservation is the core requirement, tuple extraction should retain it where summary-based approaches erase it.

Budget: $15-25 for Tier A + Phase A at gpt-5-mini extractor.

Both Tier 2 variants are now confirmed RED. No further Observer/Reflector work recommended absent a radical reflector-prompt redesign.

---

End of Step 8 findings.
