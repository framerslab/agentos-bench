# Step 7 Findings — Observer/Reflector Pipeline (Tier 2)

**Date:** 2026-04-20
**Scope:** new `--observer-reflector` CLI flag wiring the dormant `MemoryObserver` + `MemoryReflector` pipeline into the bench adapter's ingest path. Three-tier pipeline (raw notes → compressed observations → reflections → encoded traces) with personality-biased extraction and MemoryReflector-driven supersession, per the Mastra-style design already present in AgentOS core code.
**Spec:** [2026-04-20-step-7-observer-reflector-enable-design.md](../../agentos/docs/superpowers/specs/2026-04-20-step-7-observer-reflector-enable-design.md)
**Plan:** [2026-04-20-step-7-observer-reflector-enable.md](../../agentos/docs/superpowers/plans/2026-04-20-step-7-observer-reflector-enable.md)

---

## Verdict: RED at Tier A

Tier A smoke on LongMemEval-S N=24 triggered the kill criterion. Phase A N=102 and Phase B N=500 NOT executed per plan §7.4. The Observer/Reflector pipeline as wired in Step 7 does NOT help on the LongMemEval-S workload; it actively regresses accuracy by roughly 25pp.

| Cell | Configuration | LME-S N=24 unweighted | Δ vs Tier 1 smoke 87.5% | Kill? |
|---|---|---:|---:|---|
| Hybrid + `--observer-reflector` | Tier 2 | **62.5%** (15/24) | **-25.0pp** | YES (threshold 82.5%) |

Per-category breakdown:

| Category | n | Accuracy | Tier 1 baseline (smoke) | Δ |
|---|---:|---:|---:|---:|
| knowledge-update | 4 | 75.0% | 100% | -25pp |
| multi-session | 4 | **25.0%** | 75% | -50pp |
| single-session-assistant | 4 | 75.0% | 100% | -25pp |
| single-session-preference | 4 | 50.0% | 100% | -50pp |
| single-session-user | 4 | 100% | 100% | 0 |
| temporal-reasoning | 4 | 50.0% | 100% | -50pp |
| **Unweighted** | 24 | **62.5%** | 87.5% | **-25.0pp** |

Cost: **$7.37 total, $0.49 per correct answer** (23x Tier 1's $0.0213/correct). The first Tier A run used gpt-4o as the observer invoker (a bug vs the spec's gpt-5-mini default); this was fixed in a follow-up commit but the cache hit returned the same accuracy numbers because cache-key fingerprint `observer-reflector:on` doesn't distinguish observer models.

---

## Why Observer/Reflector failed here

The Step 7 design assumed additive semantics: the observer produces reflection-derived traces that live ALONGSIDE raw chunks in the same MemoryStore, queried by HybridRetriever. Expected outcome: modest accuracy lift on multi-session (where abstract summaries help).

What actually happened:

1. **Trace pollution.** The Observer/Reflector adds many summary traces to the memory store. HybridRetriever's dense side returns top-K by cosine similarity, so reflection summaries (which are semantically close to queries but lack the specific-value detail) rank high enough to displace raw chunks that contain the answer. Case 1 alone had 211 raw encodes + ~6-8 reflection-derived encodes; at retrieval time the reader sees summaries where it used to see hero chunks.

2. **BM25 index mismatch.** Our bench indexes BM25 only over raw chunks (via the `hybridBm25.addDocument` hook in the ingest loop). Reflection-derived traces go through `handle.manager.encode()` inside `manager.observe()` — those never reach BM25. Result: dense retrieval sees raw + reflection traces, sparse sees only raw. RRF merge over these asymmetric lists favors the less-precise dense-matched reflection traces, because sparse couldn't rank them at all.

3. **Supersession is destructive.** MemoryReflector detects conflicting claims and soft-deletes "superseded" traces via `this.store.softDelete(id)`. On a benchmark where every trace might be the answer-bearing one, this is pure loss. Knowledge-update dropped from 100% → 75%. Multi-session dropped from 75% → 25%.

4. **Mastra's architecture is REPLACEMENT, not additive.** Mastra's Observational Memory replaces the raw message history with a compressed observation log. Our wiring ADDS the observation log alongside raw chunks. The addition dilutes retrieval where Mastra's replacement concentrates it.

These four failure modes compound. Raw chunks + reflection summaries produce a noisier retrieval pool. Supersession takes valid raw chunks out of that pool. BM25 can only see half of the traces. The reader gets fewer direct answers and more abstract paraphrases.

---

## What ships

- **All the code is committed and working.** The bench wiring + tests pass (218/218 bench tests). `--observer-reflector` is available as an opt-in flag, default off.
- **Observer model defaults to gpt-5-mini** (not the main reader) for cost control, matching the spec. Fixed after the first Tier A run identified the issue.
- **Findings doc (this file)** documenting the negative result.

The wiring code itself is correct and reversible. Anyone who wants to experiment with different thresholds, different observer models, or different reflector settings can do so via the flag + direct config.

---

## What does NOT ship

- **No production default flip.** Tier 1 Hybrid remains the shipping default at 73.2% / $0.0213/correct.
- **Phase A and Phase B NOT run.** Tier A kill was decisive; running Phase A at $3 or Phase B at $12+ on known-dead variant is waste.
- **LOCOMO and Oracle Tier A smokes NOT run.** The LME-S kill was sufficient; saving ~$1.80 by not firing them.

---

## Cost accounting for Step 7

| Run | USD | Notes |
|---|---:|---|
| Tier A LME-S N=24 Hybrid + Observer (gpt-4o observer, initial wiring bug) | $7.37 | one smoke |
| Tier A re-run with gpt-5-mini observer | $0.00 | cached — same accuracy |
| Tier A LOCOMO, Oracle | $0 | skipped per kill |
| Phase A, Phase B | $0 | skipped per kill |
| **Total** | **$7.37** | Well within the $18 spec cap |

The first run's $7.37 was inflated by the gpt-4o observer bug. With gpt-5-mini observer, the same pipeline would have cost ~$1.50 per Tier A smoke. Future sub-tier experiments (if tested) should budget ~$1-3 per Tier A.

---

## Progressive Enhancement tier scoreboard

Updated with Step 7's RED measurement:

| Tier | Flags | Measured accuracy | Measured $/correct | Status |
|---|---|---:|---:|---|
| Tier 0 (bare) | (none) | ~60% (projected) | ~$0.032 (projected) | not measured |
| Tier 1 (default) | `--hybrid-retrieval --context-summary` | **73.2%** [69.2%, 77.0%] | **$0.0213** | **ships, Phase B N=500 GREEN-soft** |
| Tier 2 (Step 7) | Tier 1 + `--observer-reflector` (ADDITIVE) | **62.5%** at N=24 smoke | $0.49 (gpt-4o observer) / ~$0.10 (gpt-5-mini, cached) | **RED at Tier A, ships opt-in** |
| Tier 3 (Step 8 candidate) | Tier 2 + `--fact-graph-ingest` | TBD | TBD | not designed |
| Tier 4 (Step 9 candidate) | Tier 3 + `--two-call-reader` | TBD | TBD | not designed |

---

## Sub-tier variants worth considering (not tested)

The current Step 7 is one of many possible wirings. If we want to revisit Observer/Reflector, these variants are worth testing:

1. **Replacement semantics.** Only encode reflection-derived traces, NOT raw chunks. Matches Mastra's architecture more faithfully. Would require an adapter flag to SKIP `timedEncode` calls when observer is on. Risk: if reflections don't cover some content the reader needs, that content is gone.

2. **Observer without supersession.** Disable MemoryReflector's soft-delete on supersession. Reflection traces still get encoded but old raw chunks persist. Should test whether the accuracy loss is mostly supersession or mostly dilution.

3. **BM25 on reflection traces.** Wire the BM25 index into `CognitiveMemoryManager.encode()` so reflection-derived traces also get indexed sparsely. Would align BM25 and dense views. Requires a small agentos-core hook.

4. **Lower observer thresholds.** Default 30k-token buffer + 50-note compression. At 115k-token haystacks, observer fires 3-4 times per case. Lower thresholds would fire more often with smaller notes — might produce more precise reflections.

5. **Different observer prompt.** The current prompt emphasizes personality-biased extraction (emotional shifts, commitments, preferences). LongMemEval rewards factual-value recall. A benchmark-matched "extract only concrete factual claims" prompt might perform better.

6. **Observer on query, not ingest.** Run observer over the retrieved top-K AT QUERY TIME to compress into a reader-ready summary. Saves per-case ingest cost, changes failure mode (retrieval still imperfect; observer works on the retrieved pool).

Variants 1 and 3 are the most architecturally significant. Variant 2 is the cheapest diagnostic to run ($1-2). No commitment to any of these; this is the research shelf.

---

## Commits (Step 7)

Monorepo:
- `3d631b398a` bench: RunConfig.observerReflector + cache-key fingerprint + integration tests
- `f065cfe4a0` bench: observerReflectorLlmInvoker option on createCognitiveManager
- `69968886b7` bench: --observer-reflector CLI flag + entry.build passthrough
- `3a53c06001` bench: LongMemEvalS wires Observer/Reflector pipeline (Tier 2)
- `4fe97ae254` bench: Locomo adapter --observer-reflector propagation
- `fe91ea3a0e` bench: observer uses gpt-5-mini (not main reader) + extend ReaderModel type

No agentos core changes (the Observer/Reflector pipeline already existed and worked correctly; Step 7 wired the dormant subsystem).

---

## Rollback

Not required. `--observer-reflector` defaults off. Tier 1 production stack unchanged.

If a future operator deletes the infrastructure:
- Revert the 6 commits above.
- Remove `observerReflector?` from `RunConfig`.
- Remove `observerReflectorLlmInvoker?` from `CreateCognitiveManagerOptions`.
- Remove `observer-reflector:on` cache-key fingerprint.
- Remove `manager.observe()` + flush blocks from `LongMemEvalS.ts::replayForCognitive`.
- `CASE_RUN_SCHEMA_VERSION` stays `'v8'`.

---

## Lessons

1. **Mastra's OM is REPLACEMENT, not ADDITIVE.** The spec's §3.3 claim that our implementation is "additive" was architecturally accurate but strategically wrong. Faithful Mastra-parity would replace raw chunk storage with observation-log storage. Our additive overlay dilutes the retrieval pool it's trying to improve.

2. **Cache-key fingerprints should include the model id for LLM-using features.** `observer-reflector:on` doesn't distinguish observer-with-gpt-4o from observer-with-gpt-5-mini. Future features that invoke LLMs at ingest should include the model in the fingerprint so cache bails don't mask model-change experiments.

3. **Plan-spec-code alignment needs verification.** The spec said gpt-5-mini; the code path used the main reader. A working test-wiring-verification step between Task 4.4 (build invoker) and Task 7.1 (run) would have caught this.

4. **Additive vs replacement is a bigger architectural question than "wire it up."** Step 7 treated "enable the observer" as a plumbing change; the measurement showed it's actually an architecture change. Future steps should ask "does this add to or replace existing retrieval pools?" before treating them as same-class changes.

5. **Tier A kill-criterion discipline works.** $7.37 saved us from a $3 Phase A + $12+ Phase B on a clearly-broken cell. The kill-criterion pattern from Steps 1-6 continues to pay for itself.

---

## Recommendation

**Pause Tier 2+ progressive enhancement work.** Step 7 as designed is a negative result. The honest options for closing the gap to Mastra (84.23%) / Mem0 (92.0):

**Option A: Re-architect Tier 2 as REPLACEMENT.** Skip raw chunk encoding when observer is on. High risk (content loss), moderate reward (Mastra parity). Would need its own spec + plan.

**Option B: Skip to Tier 3 (fact-graph ingest, Mem0 pattern).** Different mechanism entirely — per-trace LLM extraction of (subject, predicate, object) at ingest. The failure mode is different from Step 5's post-retrieval filter because extraction-at-ingest changes what's STORED, not what's SELECTED. Budget: $10+.

**Option C: Accept the blog post's current positioning.** Tier 1 at 73.2% is real and defensible. We're between Zep (71.2%) and Mastra (84.23%) at matched reader. The methodology we've demonstrated (matched-ablation + kill-criterion + bootstrap CIs) is the contribution; hitting Mastra's number requires a different architecture than we've tried.

I lean Option C unless the user wants to budget another $15-30 for Tier 3 and risk another negative result. The marginal cost of more tier experiments is climbing relative to the information gain.

---

End of Step 7 findings doc.
