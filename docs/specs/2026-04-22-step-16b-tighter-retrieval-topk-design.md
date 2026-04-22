# Step 16b — Tighter Retrieval Top-K for OM+Retrieval Combined

**Date:** 2026-04-22
**Status:** Design approved; ready for fresh-session execution
**Supersedes:** None. Extends Step 16 ([STEP_16_OM_PLUS_RETRIEVAL_FINDINGS_2026-04-22.md](../STEP_16_OM_PLUS_RETRIEVAL_FINDINGS_2026-04-22.md)).

---

## 1. Summary

Step 16 combined OM observation log + HybridRetriever top-K=10 passages in one reader context. Tier A regressed to **70.8%** vs v5's **79.2%** — the retrieval passages helped multi-session (+25pp, 25%→50%) but hurt single-session-user (−25pp), single-session-preference (−25pp), and temporal-reasoning (−25pp). Net −8.4pp aggregate.

**Hypothesis**: context pollution from too many retrieved passages (10 chunks × ~500 chars each = ~5k chars of verbatim content) distracts the reader from the dense observation log. Reducing top-K to **3** keeps the 2-3 most relevant chunks (enough to add multi-session signal) while shrinking the context-pollution surface.

**If correct**, Step 16b clears the 82% kill gate AND preserves single-session ≥ 90%.

**If wrong**, the combination is architecturally dominated by v5 and we fall back to v5 for Phase A. (Step 16c dynamic router is the second swing.)

---

## 2. Context

Step 16 Tier A per-category (v5 baseline → Step 16 top-K=10):

| Category | v5 | Step 16 top-K=10 | Δ |
|---|---:|---:|---:|
| single-session-user | 100% | 75% | −25pp |
| single-session-assistant | 100% | 100% | 0 |
| single-session-preference | 100% | 75% | −25pp |
| knowledge-update | 75% | 75% | 0 |
| multi-session | 25% | 50% | +25pp |
| temporal-reasoning | 75% | 50% | −25pp |
| **Aggregate** | **79.2%** | **70.8%** | **−8.4pp** |

At N=24 with n=4 per category, each category is ±25pp from a single case flip. The pattern still reads coherent: multi-session wants retrieved chunks (the specific sessions' content), single-session and temporal want the dense observation log to dominate attention.

**Top-K=10 is the standard** for HybridRetriever in the canonical pipeline (Step 3). At top-K=10, the reader's context includes ~5-10k chars of verbatim conversation chunks. For OM-plus-retrieval, this fights the observation log (50-60k chars) for the reader's attention — 10% content that's somehow authoritative because it's later in context.

**Top-K=3 keeps the top 3 most-relevant chunks** from Cohere rerank-v3.5. For multi-session questions, the answer is almost always in 1-2 sessions — top-3 captures them. For single-session questions, the answer is in 1 session — top-3 is enough and doesn't bring 7 irrelevant chunks along.

---

## 3. Architecture

### 3.1 Unchanged from Step 16

Identical configuration EXCEPT `--reader-top-k`:

- OM ingest: dual-path mode, 24k-token batches, gpt-4o observer, scaffold ON
- Retrieval: HybridRetriever with BM25 + dense (openai text-embedding-3-small) + RRF (w_dense=0.7, w_sparse=0.3, k=60) + Cohere rerank-v3.5 + 0.7/0.3 cognitive/neural blend
- Reader context shape: `## Per-session observations ... ## Cross-session patterns ... ## Relevant retrieved passages [...top-3 chunks...] ... instructions ... scaffold ... continuation hint`
- Reader: gpt-4o, temperature=0, max_tokens=256
- Judge: gpt-4o with LongMemEval-provided rubric

### 3.2 The only change

`--reader-top-k 3` (was 10 in Step 16). Threads through HybridRetriever's `recallTopK` and clamps the final top-K returned to the reader.

### 3.3 Cache fingerprint

No new tags required. Existing `topk:3` fingerprint (from Step 1 work) already participates in both `runKeyParts` and `resultKeyParts`. Step 16b cache entries will be naturally distinct from Step 16 (top-K=10) entries.

---

## 4. Kill criteria

| Metric | Threshold |
|---|---:|
| Unweighted | ≥ 82% |
| Multi-session | ≥ 50% |
| Single-session-user | ≥ 90% |
| Single-session-assistant | ≥ 90% |
| Single-session-preference | ≥ 90% |

ALL thresholds must pass. Lower bar than claiming SOTA; higher than v5's 79.2% so it's worth laddering over v5.

**If Step 16b clears the gate**: compare against v5 head-to-head. If 16b dominates on ≥ 4 of 6 categories, it's the Phase A candidate. Otherwise pick v5 and note 16b as an interesting tradeoff.

**If Step 16b fails the gate**: retrieval + OM is architecturally dominated for our reader. Step 16 family is documented as a RED path. Move to Step 16c (dynamic router) or fall back to v5 Phase A.

---

## 5. Expected outcomes

### 5.1 Best case (hypothesis correct)

- Aggregate: 82-84%
- Single-session: all ≥ 95% (pollution reduced)
- Multi-session: 50-60% (top-3 still catches cross-session chunks)
- KU: 80-90%
- Temporal: 70-80%

If this result holds at Phase A (which v4a showed is NOT guaranteed at N=24 → N=102 expansion), 16b becomes the shipping OM config for Tier 2 deployments.

### 5.2 Null case (same as v5)

- Aggregate ~79-82%
- Single-session holds at 95%+
- Multi-session 40-55%

Slight improvement over v5's 25% multi-session. Marginal but not worth laddering unless all three single-session categories pass.

### 5.3 Failure case (still below v5)

- Aggregate < 78%
- Any single-session < 90%

Step 16 family dies. Phase A fires on v5.

---

## 6. Cost + runtime

- Step 16 Tier A cost: $33.67. Step 16b with smaller top-K doesn't reduce cost materially (retrieval cost is dominated by observer + reader + judge).
- Projected: $30-40 Tier A N=24. ~45-60 min runtime.
- Max USD cap: `--max-usd 60` for headroom.

---

## 7. Tier A command

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant && \
  set -a && source apps/wilds-ai/.env && set +a && \
  OPENAI_API_KEY="$OPENAI_API_KEY" COHERE_API_KEY="$COHERE_API_KEY" \
  pnpm --filter @framers/agentos-bench bench run longmemeval-s \
    --reader gpt-4o --judge-model gpt-4o \
    --memory full-cognitive --replay ingest \
    --observational-memory \
    --om-mode dual-path --om-batch-tokens 24000 \
    --om-reader-scaffold --om-observer-model gpt-4o \
    --om-with-retrieval \
    --rerank cohere --context-summary gpt-5-mini --hybrid-retrieval \
    --reader-top-k 3 \
    --stratified --sample-per-type 4 \
    --bootstrap-resamples 10000 --seed 42 \
    --max-usd 60
```

---

## 8. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Top-K=3 drops a load-bearing chunk for multi-session | Medium | RRF + rerank is sharp at K=3 for specific-value queries. If multi-session drops below 30% (worse than v5), 16b is RED. |
| Single-session still regresses (pollution not just top-K) | Medium | If any single-session < 90%, Step 16 family is dominated. Accept v5 as the OM config. |
| Sampling luck at N=24 (v4a precedent) | High | Phase A N=102 mandatory before shipping 16b. Same gate discipline as v4a. |
| Cost blowup from simultaneous retrieval + OM ingest | Low | Retrieval is cheap. Observer is $25-30. Total ~$40 Tier A. Max-usd cap at $60. |

---

## 9. Open questions (deferred)

- **Top-K=5 or top-K=7?** If Step 16b with top-K=3 shows promise but doesn't clear the gate, a midpoint test could reveal the sweet spot. Cost: $35 each.
- **Different reranker weights?** Current 0.7 cognitive / 0.3 neural blend is tuned for retrieval-only. When combined with OM, maybe 0.5/0.5 or 0.3/0.7 works better. Out of scope for 16b.
- **Position ordering:** currently retrieved passages come AFTER observations. Swap order? May help if reader weights later content (Liu et al. "lost in the middle"). Out of scope for 16b; could test as 16d.

---

## 10. Acceptance

Design finalized 2026-04-22 at end-of-session. Ready for execution in fresh session per [NEXT_SESSION_CONTINUATION_2026-04-22_FINAL.md](../NEXT_SESSION_CONTINUATION_2026-04-22_FINAL.md) §6.1.

End of spec.
