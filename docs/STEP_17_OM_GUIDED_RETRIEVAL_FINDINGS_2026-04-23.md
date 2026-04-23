# Step 17 Findings — OM-Guided Retrieval (RED, latency-bound)

**Date:** 2026-04-23
**Scope:** Architectural alternative to Step 16c v10 routing. Implementation tested across two iterations (v1 broken parser, v2 working parser + working filter). All paths RED at Tier A.

---

## 1. Verdict

**RED at Tier A. Architecturally dominated by Step 16c v10.** The OM-guided session-scoping mechanism works mechanically (filter correctly narrows 30-evidence over-fetch to 3-14 candidate-session passages) but the architecture has a fundamental latency problem that makes it unshippable regardless of accuracy.

| Metric | Step 17 v2 fresh | v10 (Tier 2 shipping) | Canonical (Tier 1) |
|---|---:|---:|---:|
| Tier A aggregate | **50.0% (12/24)** | 66.7% Tier A → 74.6% Phase B | 73.2% Phase B |
| Excluding errored cases | 66.7% (12/18) | 66.7% / 74.6% | 73.2% |
| Cases errored on transient API | **6/24 (25%)** | 0 | 0 |
| Avg latency | **163s** | 12s | 98s |
| p95 latency | **569s (9.5 min)** | 40s | 170s |
| Worst case latency | **724s (12 min)** | ~140s | ~340s |
| Cost (Tier A N=24) | **$32.56** | $5.86 | (not run at N=24) |
| Cost/correct | $2.71 | $0.62 | (Phase B: $0.021) |

**Kill-gate check:**
- Unweighted ≥ 82%: FAIL (50.0%)
- Multi-session ≥ 50%: FAIL (33%)
- All single-session ≥ 90%: PASS for SSU (100%) and SSA (100% n=2 only), FAIL SSP (75%)
- **Latency budget:** no explicit gate, but 13x slower than v10 with 25% error rate is production-blocking on its own

---

## 2. Implementation history

Three runs across two architectural iterations:

### v1 (broken parser) — RED 70.8%

`extractPerSessionBlocks(omLog: string)` parsed the dual-path `## Per-session observations` section looking for `Date: ... (session sX)` headers. The actual format only has `Date: <date>` headers without session IDs. Parser returned empty for every case. Filter ran no-op. Effectively reduced to Step 16 K=30. Tier A 70.8%, $32.72.

### v2 attempt 1 (no embedder configured) — RED 70.8%

Refactored to `extractPerSessionBlocks(perSessionBatches: PerSessionBatchLike[])` consuming `ingest.perSessionBatches` directly. But the LongMemEvalS code requires `this.opts.embedder` to be set — the bench command didn't include `--embedder-model`, so embedder was undefined and Step 17 fell into the no-embedder branch (filter no-op). Tier A 70.8%, $32.88.

### v2 attempt 2 (cache contamination) — false negative

Re-fired with `--embedder-model text-embedding-3-small`. Cost dropped to $0.02 — case-run cache from attempt 1 (broken-no-embedder state) was being replayed. Total replayed in 11 minutes, accuracy looked the same as attempt 1 because the cached metadata had the broken-state values. Per the handoff §7.6 case-result/case-run cache bug, fingerprint v2 was correct but the broken-no-embedder runs landed in v2 buckets first.

### v2 fresh (cleared cache + embedder) — RED 50.0%

Cleared 48 case-run + 24 case-result entries with the broken `omGuidedCandidateSessionCount: 0` pattern. Fresh run showed the filter working (5 candidate sessions per case, 3-14 filtered evidence per case) but aggregate dropped to 50% with massive latency and 25% error rate. **This is the definitive Step 17 result.**

---

## 3. Per-category breakdown (v2 fresh)

| Category | n | Accuracy | vs v10 Tier A | vs v10 Phase B | Notes |
|---|---:|---:|---:|---:|---|
| single-session-user | 4 | **100%** | tied (100%) | +2.9pp | scoping helps when 1-2 sessions matter |
| single-session-assistant | 2 | **100%** | tied (100%) | +16.1pp | only 2 cases ran (others errored) |
| single-session-preference | 4 | 75% | tied (75%) | +15.0pp | small lift but n=4 noisy |
| knowledge-update | 4 | 50% | -25 | -35.9pp | scoping misses supersession sessions |
| **multi-session** | 3 | **33%** | -17 | **-26.9pp** | scoping AGGRESSIVELY misses gold sessions |
| temporal-reasoning | 1 | 0% | -75 | -71.0pp | n=1, 3 cases errored |
| unknown | 6 | 0% | — | — | embedding 503 errors |

**Key finding:** the K=5 candidate-session filter is too aggressive for cross-session questions. For multi-session questions where the answer requires combining 2-5 sessions, top-5 by embedding similarity often misses the gold sessions. Same pattern for knowledge-update where the supersession trail spans multiple sessions over time.

---

## 4. Why Step 17 is RED (architectural diagnosis)

### 4.1 The latency problem (showstopper)

Step 17's per-case work is the SUM of:
1. Full OM ingest (gpt-4o observer, dual-path, ~50 LLM calls per case): 50-150s
2. Per-session block embedder calls (~50 embeddings/case batched into 1 call): 5-15s
3. HybridRetriever K=30 over-fetch (BM25 + dense + Cohere rerank): 5-20s
4. Post-hoc session filter: <1s
5. Reader (gpt-4o, 60-90KB context): 5-15s

Total: **150-200s+ per case typical, with tail extending to 5-12 minutes** when sessions are long or APIs are slow.

Compared to v10 which routes ~80% of cases through canonical (avg 12s) and only ~20% through OM (avg ~50s), v10's amortized cost is 10x lower per case.

For Phase A N=102, Step 17 would take ~5-8 hours wall-clock (vs v10's ~30 min). For Phase B N=500, ~25-40 hours (vs v10's ~1.7 hr). **Production-impossible** for any latency-aware deployment.

### 4.2 The error-rate problem

Step 17's reliance on per-case embedder calls (50+ batched) increases the API surface area. The 25% error rate (6/24 cases) on transient OpenAI 503s is dramatically worse than v10 (0%) or canonical (typically 0-1%). Same failure pattern observed in v7 Phase A (46/102 quota errors).

### 4.3 The K-tuning dilemma

**K=5 too aggressive:** misses gold sessions for cross-session questions (KU 50%, MS 33%).
**K=10 or K=15** would help cross-session but defeats the purpose (back to Step 16 pollution territory).
**K=2 or K=3** would help single-session further but kill multi-session (gold sessions excluded).

No K value escapes the trade. The architecture itself is the problem, not the tuning.

### 4.4 The over-fetch + post-hoc filter is wasteful

The current implementation runs HybridRetriever with K=30 (over-fetch by 6x), then post-hoc filters to candidate sessions. This wastes most of the retrieval work because non-candidate-session traces are computed but discarded. A pre-hoc filter (push the session filter into the retrieval pipeline so non-candidate-session traces are never scored) would reduce both latency AND cost.

But implementing pre-hoc filtering requires modifying HybridRetriever to accept session-set filters at the trace-iteration level. That's 2-4 hours of additional work for a path that's already shown architecturally limited returns.

---

## 5. Possible Step 17 v3 paths (not pursued)

### 5.1 BM25-based session scoring (no embedder)

Replace embedding-based session scoring with BM25 over per-session OM blocks. Pros: free, fast (in-memory, no API), more accurate for specific-token queries (LongMemEval is specific-value-dominant). Cons: more code, requires building per-case BM25 index.

**Why not pursued:** even with faster scoring, the OM ingest dominates per-case latency (~80% of time). Eliminating the 5-15s embedding step doesn't fix the 50-150s OM step. v10's "skip OM for 80% of cases" wins on latency regardless.

### 5.2 Pre-hoc session filter in HybridRetriever

Push the candidate-session filter into the HybridRetriever pipeline so non-candidate-session traces are never scored. Pros: reduces retrieval latency 5-10s. Cons: requires HybridRetriever modification (interface change).

**Why not pursued:** still doesn't fix the OM-ingest-always-runs latency problem. v10 dominates by skipping OM entirely for most cases.

### 5.3 Step 17c: skip OM ingest, use Step 16-shaped retrieval with OM-guided session selection from CHEAPER source

Use a cheap LLM (gpt-5-mini) or BM25 to identify candidate sessions WITHOUT running full OM ingest. Then run scoped HybridRetriever. Pros: no OM ingest cost. Cons: now you're essentially building a less-effective version of Step 16c v10 routing.

**Why not pursued:** v10 routing already does this cleanly via the classifier + canonical/OM branch decision.

---

## 6. CodeRabbit review

Review run on Step 17 v2 implementation (latest commit hash). [If CodeRabbit findings on Step 17 code arrive after this doc is written, they'll be appended in §10.]

---

## 7. Cost summary

| Run | Variant | Cost | Result |
|---|---|---:|---|
| Step 17 v1 (broken parser) | broken | $32.72 | RED 70.8% (filter no-op) |
| Step 17 v2 attempt 1 (no embedder) | broken | $32.88 | RED 70.8% (filter no-op) |
| Step 17 v2 attempt 2 (cache hit) | broken | $0.02 | replayed broken metadata |
| **Step 17 v2 fresh (cleared cache + embedder)** | **definitive** | **$32.56** | **RED 50.0% with 25% error rate** |
| **Total Step 17 spend** | | **~$98** | exhausted, dominated by v10 |

---

## 8. Final architecture decision (settled)

| Tier | Config | Phase B / Phase A | Cost/correct | Avg latency | When to use |
|---|---|---:|---:|---:|---|
| **Tier 1 default** | canonical (Step 3 Hybrid) | **73.2% N=500** | **$0.021** | 98s | High-volume, cost-sensitive |
| **Tier 2 opt-in** | **16c v10 dynamic router** | **74.6% N=500** | $0.327 | **12s** | **Latency-sensitive, MS-heavy** |
| Tier 3 experimental | v5 OM-only | 73.5% Phase A | high | 35s | Pareto-different per-category |
| **DEPRECATED/RED** | v7, v8, Step 16, 16b, 16c-baseline/v9/v11, **Step 17 v1/v2** | all RED | n/a | varies | documented failures |

Step 17 ships as a documented architectural exploration (code remains in repo as `--om-guided-retrieval` opt-in for future iteration) but is NOT production-grade.

---

## 9. What ships from Step 17

Code preserved as opt-in for future iteration:
- `src/observational-memory/omGuidedRetrieval.ts` (extractPerSessionBlocks, scoreSessionsByQueryRelevance, pickCandidateSessions, SessionScore, PerSessionBatchLike)
- `src/observational-memory/index.ts` exports
- `src/core/IBenchmark.ts`: `omGuidedRetrieval`, `omGuidedRetrievalK` fields on RunConfig
- `src/core/BenchmarkRunner.ts`: fingerprints `step-17-om-guided:v2`, `step-17-om-guided-k:{n}` (when K ≠ 5)
- `src/cli.ts`: `--om-guided-retrieval`, `--om-guided-retrieval-k <n>` flags
- `src/benchmarks/longmemeval/LongMemEvalS.ts`: post-hoc session filter wired into the OM+retrieval branch
- 12 new tests (8 unit for helpers + 4 wiring for config/fingerprint), all GREEN

Cache fingerprint `:v2` was bumped because v1 had a broken parser (the cache entries from v1 were wrong-state). v2 is a marker for "implementation works mechanically but architecture is RED."

---

## 10. Honest verdict

Step 17's OM-guided retrieval is an **architecturally interesting but production-impractical** approach. The session-scoping mechanism works as designed; the implementation is correct; the kill criteria fail because:

1. **Latency unacceptable** (163s avg, 569s p95, 12 min worst case) — 13x slower than v10
2. **Error rate too high** (25% on transient embedder API issues)
3. **Aggregate accuracy below canonical** (50% with errors, 66.7% on completed cases vs canonical's 73.2%)
4. **Multi-session regression** (33% vs v10's 60% Phase B) — the K=5 filter is too aggressive
5. **Cost premium** ($32.56 Tier A vs v10's $5.86 — 5.5x with no accuracy lift)

A future Step 17 v3 with BM25-based session scoring + pre-hoc filter pushdown into HybridRetriever could be cheaper and faster, but the OM-ingest-on-every-case requirement still makes it strictly slower than v10's classify-then-route approach. **v10 is architecturally correct: most cases don't need OM at all, so don't run it.**

**Final recommendation: ship canonical (Tier 1) + v10 (Tier 2). Document Step 17 v1/v2 as deprecated. Defer Step 17 v3 (BM25 session scoring) to a hypothetical future workload where pre-hoc filtering matters more than amortized OM cost.**

---

## 11. Files + run JSONs

- v2 fresh run: `results/runs/2026-04-23T05-34-40-952--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- v2 attempt 2 (cache contamination): `results/runs/2026-04-23T05-32-31-459--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- v2 attempt 1 (no embedder): `results/runs/2026-04-23T05-22-35-193--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- v1 (broken parser): `results/runs/2026-04-23T05-10-39-441--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- Spec: [docs/specs/2026-04-23-step-17-om-guided-retrieval-design.md](specs/2026-04-23-step-17-om-guided-retrieval-design.md)
- Source: [src/observational-memory/omGuidedRetrieval.ts](../src/observational-memory/omGuidedRetrieval.ts)
- v10 Phase B (the winner): [STEP_16C_V10_PHASE_B_FINDINGS_2026-04-23.md](STEP_16C_V10_PHASE_B_FINDINGS_2026-04-23.md)

---

End of Step 17 findings.
