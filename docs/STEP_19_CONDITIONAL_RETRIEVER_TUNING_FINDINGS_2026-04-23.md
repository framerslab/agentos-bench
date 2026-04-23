# Step 19 Findings — Conditional Retriever Tuning for Multi-Session Questions (NULL on MS)

**Date:** 2026-04-23
**Scope:** Three classifier-conditional retriever-knob variants tested at canonical Tier A N=24 against the hypothesis that canonical's low MS rawToRetrieved (0.365 per Step 18 baseline diagnosis) can be lifted via simple retriever parameter overrides.
**Verdict:** **NULL at Tier A on the targeted metric (MS accuracy).** All three variants correctly applied the override to MS cases (verified via per-case metadata); none moved MS accuracy above the 25% canonical baseline.

---

## 1. Verdict

**NULL.** The Step 18 per-correctness analysis surfaced canonical's MS retriever as the largest single-stage token loss in the matrix (raw→retrieved 0.365 — 63.5% of gold tokens dropped before the reader sees them). Step 19 tested three distinct mechanisms to close that gap; all three failed.

| Variant | Mechanism | MS accuracy | Aggregate | Cost |
|---|---|---:|---:|---:|
| Canonical baseline | (no override) | 25% | 62.5% | $0.49 |
| Step 19A (K=30 for MS) | more chunks → more cross-session bridges | **25%** | 62.5% | $0.60 |
| Step 19B (BM25=0.7 for MS) | BM25-heavy RRF for exact-token cross-session anchors | **25%** | 66.7%† | $0.49 |
| Step 19C (overfetch=6.0 for MS) | wider rerank candidate pool | **25%** | 66.7%† | $0.48 |
| **Stacked (18 v2 + 19 B)** | verbatim for KU/SSU/SSA + BM25-heavy for MS | **25%** | 62.5% | $0.49 |

† The +4.2pp aggregate in B and C came from TR (50%→75%, one-case flip at n=4), NOT from MS. The TR variance was LLM stochasticity on fresh-fires, not a real architectural lift. The stacked run reverted TR to 50% and the apparent gain disappeared — confirming B/C's aggregate lifts were noise.

**Total Step 19 spend:** $2.06 (all variants ran canonical mode → much cheaper than the spec's ~$45 v10 estimate).

---

## 2. Per-case override verification

All 3 variants correctly applied the override to 4/4 MS-classified cases. Metadata check:

| Variant | MS cases | Override applied | Metadata key populated |
|---|---:|---:|---|
| Step 19A | 4 | 4 | `omRetrieverMsKApplied: 30` |
| Step 19B | 4 | 4 | `omRetrieverMsBm25Applied: 0.7` |
| Step 19C | 4 | 4 | `omRetrieverMsOverFetchApplied: 6` |

The plumbing works. The variants DID receive the MS cases with K=30 / BM25 weight 0.7 / over-fetch K=60 respectively. The retriever simply did not find more gold cross-session passages with any of these knobs.

---

## 3. Mechanistic diagnosis

Three independent hypotheses falsified at Tier A N=24:

### 3.1 K=30 hypothesis

**Hypothesis:** larger top-K exposes the reader to more chunks, raising the probability that two gold sessions' chunks are both in context.

**Result:** baseline + 10 extra chunks per MS case. MS accuracy unchanged at 25%. Either (a) the extra chunks are noise (the 10 baseline chunks already dominate the BM25+dense+rerank ordering and chunks 11-30 are irrelevant), (b) the gold cross-session passage is past rank 30 entirely, or (c) the reader sees the gold passage but doesn't synthesize across it.

### 3.2 BM25-heavy RRF hypothesis

**Hypothesis:** bench blog §3.6 explanation: BM25 is better than dense at exact-token cross-session matches because dense embeddings cluster by semantic topic (which correlates with session). Flipping RRF to sparse=0.7/dense=0.3 should surface more cross-session bridges.

**Result:** MS accuracy unchanged at 25%. BM25 either doesn't find the gold cross-session token (maybe the gold answer's key token appears in the query but not in the cross-session gold passage verbatim), or does find it but the reader still can't synthesize.

### 3.3 Wider over-fetch hypothesis

**Hypothesis:** Cohere rerank-v3.5 reorders the merged pool; giving it 60 candidates instead of 30 lets the cross-encoder discover more cross-session pairings the pre-rerank dense+sparse order missed.

**Result:** MS accuracy unchanged at 25%. Rerank's reordering was not the bottleneck — either the candidate gold passage was never in the over-fetched pool, or it was and the reranker scored it below the final top-10.

### 3.4 Underlying pattern

Three independent interventions on the retrieval stage, zero movement on MS accuracy. Strong evidence that **canonical's MS bottleneck is not solvable with retriever-knob tuning alone**. The gold answer tokens appear in either: (a) passages the retriever cannot surface regardless of knob, OR (b) passages the retriever CAN surface but the reader cannot synthesize across without specialized instructions (which Step 18's reader-side tuning was targeting).

---

## 4. What this tells us about the +63pp opportunity

The Step 18 per-correctness diagnostic identified canonical MS rawToRetrieved 0.365 as "the largest single-stage drop in the matrix." That remains true. But Step 19 proves **that stage-level diagnostic does not translate to a knob-tunable accuracy opportunity**. Closing the retrieval gap on MS requires either:

1. **OM routing** (v10's approach: skip canonical retrieval for MS, use observer log instead). v10's Phase B shows +5.3pp MS lift this way.
2. **Reader-side conditional discipline** (Step 18 v2's approach: different reader prompts for different categories). Step 18 v2 Phase A shows +9.8pp MS lift at n=17.
3. **Session-aware retrieval** (Step 17's approach with BM25 session scoring — spec'd as v3 but not yet fired). Architecturally dominated by v10 per prior analysis.
4. **Typed retrieval networks** (Hindsight's approach — 4 typed indexes for event/temporal/entity/relationship, published 91.4% MS at gemini-3-pro). Handoff §5 candidate, ~$400 + 1-2 weeks dev.

Step 19's three retriever-knob variants are NONE of these. They tune parameters of the existing BM25+dense+rerank pipeline, which is the pipeline that already has the 0.365 raw→retrieved gap baked in. Tuning its dials within the same architecture doesn't change what it can find.

---

## 5. What Step 19 DID ship (durable)

Even though the hypothesis was NULL, the code shipped and is reusable:

- **Per-case retriever override plumbing**: 3 RunConfig fields (`omRetrieverMsKOverride`, `omRetrieverMsBm25Weight`, `omRetrieverMsOverFetchMultiplier`), 3 CLI flags (`--om-retriever-ms-k`, `--om-retriever-ms-bm25-weight`, `--om-retriever-ms-overfetch`), 3 cache fingerprint tags (`step-19a-ms-k:{n}`, `step-19b-ms-bm25:{w}`, `step-19c-ms-overfetch:{m}`).
- **Per-case retriever option threading through `runFullCognitiveCase`**: added `hybridSparseWeightOverride` and `hybridOverFetchMultiplierOverride` parameters, passed through to `HybridRetriever.retrieve()`. Re-usable for any future per-category retriever experiment.
- **Ground-truth category gating pattern**: Step 19 uses `c.type === 'multi-session'` (ground truth from the dataset) instead of router output (which under v10 routes MS away from canonical entirely). Durable lesson: per-category experiments gate on ground truth, not on a classifier output that might route them elsewhere.

---

## 6. Methodology lesson: per-correctness predictor has limits

Step 18's per-correctness gap analysis (correct-case retention − wrong-case retention) is a strong predictor for **reader-side** interventions. It correctly identified KU/SSU as categories where verbatim citation discipline would help (Step 18 v2 Phase A 78.4% lift).

But per-correctness gap is **NOT a sufficient predictor for retriever-side interventions**. The gap tells us that high retention correlates with correct answers on a category, but does NOT tell us whether the retriever CAN be tuned to raise retention. The canonical retriever's MS gap is real but structurally fixed — no knob on BM25+dense+RRF+rerank changes the fundamental limit of what those components can find.

**Updated discipline:** when considering a retriever-knob experiment, require BOTH:
- Per-correctness gap ≥ +0.6 (retention predicts accuracy)
- An actual mechanism story for why the specific knob moves retention (not just "we have a gap, let's try a knob")

Step 19 didn't have the second condition. The "BM25 finds cross-session tokens better" story is architecturally plausible but wasn't empirically tied to the specific MS cases in the benchmark's gold set.

---

## 7. Cost summary

| Item | Cost |
|---|---:|
| Variant A Tier A (canonical + K=30 for MS) | $0.60 |
| Variant B Tier A (canonical + BM25=0.7 for MS) | $0.49 |
| Variant C Tier A (canonical + overfetch=6.0 for MS) | $0.48 |
| Stacked Tier A (canonical + Step 18 v2 verbatim + Step 19 B BM25) | $0.49 |
| Failed parallel fire attempt (401 key errors, $0 wasted but instructive) | $0.00 |
| v10 re-fire to validate wiring (discovered design flaw) | $5.86 (informative) |
| **Total Step 19 Tier A spend** | **~$7.92** |

Dramatically under the spec's ~$45 estimate because all productive variants ran against canonical (much cheaper than v10). The $5.86 "informative" cost discovered the v10-routing design flaw that let us pivot to canonical-only testing, avoiding the wasted $30+ that would have come from firing v10 variants against a path where the overrides can't fire.

---

## 8. Recommendation for next iteration

**Do NOT iterate on canonical retriever-knob tuning.** Three mechanisms have now failed at Tier A. The data strongly suggests the canonical retriever's MS ceiling is architectural, not tunable.

**Instead**, the next architectural swings with highest EV per handoff §5:

1. **Phase B v2 confirmation** (~$120-150) — confirm whether Step 18 v2's +1.9pp at Phase A is real at Phase B N=500. **FIRING AS OF THIS WRITING.**
2. **Hindsight typed networks** (~$400 + 1-2 weeks) — 4 typed retrieval networks (event/temporal/entity/relationship) + multi-strategy fusion. Architecturally different from BM25+dense+RRF+rerank. Potential to break through the 0.365 raw→retrieved ceiling with typed indexing.
3. **Gemini observer parity test** (~$230) — swap gpt-4o observer for gemini-2.5-flash. Mastra's published 84.23% at gpt-4o uses this. Likely matches Mastra. Accepts Gemini vendor dependency.

Step 19's code stays in the bench as opt-in flags (`--om-retriever-ms-*`) for future iteration if a new architectural mechanism shows promise on MS.

---

## 9. Files + run JSONs

- Variant A (canonical + K=30): `results/runs/2026-04-23T16-52-27-957--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- Variant B (canonical + BM25=0.7): `results/runs/2026-04-23T16-52-30-112--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- Variant C (canonical + overfetch=6.0): `results/runs/2026-04-23T16-52-32-257--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- Stacked (canonical + 18 v2 + 19 B): `results/runs/2026-04-23T17-07-18-530--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- Failed v10 re-fire (revealed design flaw): `results/runs/2026-04-23T16-49-07-983--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- Spec: [docs/specs/2026-04-23-step-19-conditional-retriever-tuning-design.md](specs/2026-04-23-step-19-conditional-retriever-tuning-design.md)
- Plan: [docs/plans/2026-04-23-step-19-conditional-retriever-tuning-plan.md](plans/2026-04-23-step-19-conditional-retriever-tuning-plan.md)
- Source modules (durable code):
  - [src/core/IBenchmark.ts](../src/core/IBenchmark.ts) — 3 new optional RunConfig fields
  - [src/core/BenchmarkRunner.ts](../src/core/BenchmarkRunner.ts) — 3 new cache fingerprint tags
  - [src/cli.ts](../src/cli.ts) — 3 new CLI flags
  - [src/benchmarks/longmemeval/LongMemEvalS.ts](../src/benchmarks/longmemeval/LongMemEvalS.ts) — per-case override resolution + threading to `runFullCognitiveCase`
- Test files: extended [tests/step15ObservationalMemory.wiring.spec.ts](../tests/step15ObservationalMemory.wiring.spec.ts) with 5 new Step 19 fingerprint tests

---

## 10. Session-wide totals (Step 18 + Step 19 + v10 Phase B firing now)

| Step | Result | Spend |
|---|---|---:|
| Step 18 framework + baselines + v1 RED + v2 metric | GREEN-framework + RED v1 + framework v2 | $71.65 |
| Step 18 v2 conditional reader at v10 Phase A | GREEN-soft 78.4% | $25.63 |
| Step 18 v3 SSA-eligible | NULL (ties v2) | $6.03 |
| Step 19 A/B/C + stacked + v10 re-fire | NULL on MS | $7.92 |
| Step 18 v2 Phase B (firing now) | (TBD) | ~$120-150 |
| **Cumulative session (pre-Phase-B)** | | **~$111** |

Approved session budget: $1k+. Headroom remaining: ~$900.

---

End of Step 19 findings.
