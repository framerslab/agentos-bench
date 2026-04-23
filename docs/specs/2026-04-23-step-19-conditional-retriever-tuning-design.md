# Step 19 — Conditional Retriever Tuning for Multi-Session Questions

**Date:** 2026-04-23
**Status:** Design v1; pivot from Step 18 v2 Phase B based on per-correctness retention diagnosis.
**Supersedes:** None. Independent retriever-side intervention orthogonal to Step 18's reader-side conditional verbatim rule.
**Authoring context:** Step 18 baseline retention analysis surfaced that canonical's HybridRetriever drops 63.5% of high-IDF gold tokens on multi-session questions (raw→retrieved 0.365 — the largest single-stage drop in any tier × category cell). v10 router fixes this by routing MS to the OM pipeline at +5.3pp Phase B but only ~80% of cases stay on canonical so the bigger fix is on the canonical retriever itself. Step 19 tests whether per-question conditional retriever tuning (gated on the v10 router classifier) closes that 63% gap on MS-routed canonical cases.

---

## 1. Summary

Add three classifier-conditional retriever variants. When the v10 router classifies a question as `multi-session`, the retriever applies a per-question parameter override targeted at the cross-session retrieval pattern. Otherwise the retriever runs with default parameters (preserves all other categories' baseline behavior).

**Hypothesis (from Step 18 baseline data):** canonical retriever's MS rawToRetrieved 0.365 means BM25 + dense + RRF + Cohere rerank-v3.5 misses ~64% of gold tokens for cross-session questions. Three plausible mechanisms could be retrieving more cross-session content per case: larger top-K (more chunks → more chance of bridging two sessions); stronger BM25 weight in RRF (BM25 is better at exact-token cross-session matches); wider over-fetch before rerank (gives the cross-encoder more candidates to reorder).

**Variant matrix:**
- **A: K-override for MS** — `readerTopK = 30` for MS-classified cases (default 10).
- **B: BM25-heavy RRF for MS** — flip RRF weights from dense=0.7 / sparse=0.3 to dense=0.3 / sparse=0.7 for MS-classified cases.
- **C: Wider over-fetch for MS** — over-fetch K=60 (vs current 30), keep top-10 cut after rerank.

All three are gated on `metadata.omRouterCategory === 'multi-session'`. Other categories use the canonical configuration unchanged. This mirrors the Step 18 v2 conditional reader pattern that produced reproducible Tier A GREEN at +4.2pp.

**Expected lift:** if any variant closes 10-20pp of the MS retention gap, that translates to roughly +3-7pp on canonical MS accuracy (54.9% Phase B baseline → 58-62%) which lifts canonical Phase B aggregate from 73.2% to roughly 74-76%. Combined with the Step 18 v2 reader conditional already shown to add +1.9pp at Phase A, a stacked Step 18 + Step 19 conditional could push v10 Phase A toward ~80%.

---

## 2. Architecture

### 2.1 Plumbing — three new RunConfig knobs

Add three optional config fields on `RunConfig` (interface in [src/core/IBenchmark.ts](../../src/core/IBenchmark.ts)):

```typescript
// Step 19: per-question conditional retriever tuning. All three default
// to undefined (no override). Each variant is independently testable.
omRetrieverMsKOverride?: number;          // Variant A — readerTopK for MS-classified cases
omRetrieverMsBm25Weight?: number;          // Variant B — sparse weight in RRF for MS-classified cases (dense weight = 1 - this)
omRetrieverMsOverFetchMultiplier?: number; // Variant C — over-fetch multiplier for MS-classified cases (default is 3, set to 6 for K=60)
```

Add three CLI flags in [src/cli.ts](../../src/cli.ts):

```typescript
.option('--om-retriever-ms-k <n>', 'Step 19A: readerTopK override for MS-classified cases. Default 10.', parseInteger)
.option('--om-retriever-ms-bm25-weight <w>', 'Step 19B: BM25 weight in RRF for MS-classified cases. Default 0.3 → set to 0.7 for BM25-heavy.', parseFloatArg)
.option('--om-retriever-ms-overfetch <m>', 'Step 19C: over-fetch multiplier for MS-classified cases. Default 3 → set to 6 for K=60.', parseFloatArg)
```

### 2.2 Per-case routing logic

In [LongMemEvalS.runCase](../../src/benchmarks/longmemeval/LongMemEvalS.ts), inside the canonical-route branch (where the v10 router classified the case as a non-OM category), check `routerCategory === 'multi-session'` AND check whether any of the three Step 19 overrides are set. If so, pass them through to `runFullCognitiveCase` (the existing canonical retrieval path) as a per-call parameter override.

The override is applied per-case at retrieval time. The runner already constructs HybridRetriever with run-level config; Step 19 needs a per-call shim that mutates the retriever's parameters for one call. Two implementation options:

**Option 1 (preferred — bench-side only):** mutate the existing `RetrievalContext` passed to `runFullCognitiveCase` at the call site. The bench's retriever helpers already accept per-call options — Step 19 just threads new ones through.

**Option 2 (touches agentos):** modify HybridRetriever in the agentos package to accept per-call overrides. Larger blast radius; defer unless Option 1 doesn't have the necessary hooks.

Implementation will follow Option 1 if `runFullCognitiveCase` exposes the relevant parameters; falls back to Option 2 only if necessary.

### 2.3 Cache fingerprint

Each variant gets its own cache fingerprint tag in `computeCaseRunKeyParts` (BenchmarkRunner.ts) AND mirrored in `resultKeyParts` (so per-variant cached scored results coexist):

```typescript
if (typeof config.omRetrieverMsKOverride === 'number') {
  const tag = `step-19a-ms-k:${config.omRetrieverMsKOverride}`;
  runKeyParts.push(tag);
  resultKeyParts.push(tag);
}
if (typeof config.omRetrieverMsBm25Weight === 'number') {
  const tag = `step-19b-ms-bm25:${config.omRetrieverMsBm25Weight.toFixed(2)}`;
  runKeyParts.push(tag);
  resultKeyParts.push(tag);
}
if (typeof config.omRetrieverMsOverFetchMultiplier === 'number') {
  const tag = `step-19c-ms-overfetch:${config.omRetrieverMsOverFetchMultiplier.toFixed(1)}`;
  runKeyParts.push(tag);
  resultKeyParts.push(tag);
}
```

The three tags are independent — a single run can combine variants if desired (e.g., Variant A K=30 + Variant B BM25 0.7 simultaneously). The cache key reflects the combination.

---

## 3. Per-tier instrumentation reuse

The Step 18 token-retention metric works unchanged for Step 19. After the Tier A runs:

- The aggregator computes per-stage retention as before. Variants are expected to lift `rawToRetrieved` on MS-classified cases (the canonical-route subset of v10) without changing other categories.
- The per-correctness gap on MS cases is the predictor: if a variant lifts MS rawToRetrieved without lifting wrong-case retention disproportionately, it's a real architectural win (not over-confident).

---

## 4. Variants in detail

### 4.1 Variant A — K-override for MS (`--om-retriever-ms-k 30`)

**Mechanism:** Reader sees 30 chunks instead of 10. More chunks → higher chance one of them carries the cross-session bridge token. Risk: dilutes context, may distract the reader on cases where 10 was enough.

**Cost:** ~$10 Tier A (just larger reader context for a subset of cases — ~5 MS cases × ~3x context length × $0.0001/case).

**Expected:** lifts MS rawToRetrieved by +10-25pp (more chunks include more cross-session candidates). Aggregate accuracy lift modest (+1-3pp) because reader may not fully use the extra context.

**Implementation effort:** trivial — `readerTopK` is already a config knob, just add the per-case conditional.

### 4.2 Variant B — BM25-heavy RRF for MS (`--om-retriever-ms-bm25-weight 0.7`)

**Mechanism:** RRF currently weights `dense=0.7 / sparse=0.3`. Flipping to `dense=0.3 / sparse=0.7` boosts BM25's influence in the merged ranking. Bench blog §3.6 explanation: BM25 cross-sections by exact tokens, so cross-session gold tokens rank higher when sparse weight is up.

**Cost:** ~$15 Tier A — reader context size unchanged, just different chunks selected.

**Expected:** lifts MS rawToRetrieved by +15-30pp (BM25 is mechanism-aligned for cross-session bridging). Aggregate accuracy lift +3-7pp.

**Implementation effort:** medium — RRF weights are currently fixed in HybridRetriever or its bench-side wrapper. Need to thread per-call override. If HybridRetriever in agentos doesn't accept it, bench-side shim that builds a fresh HybridRetriever per-call with overrides (more expensive setup) is fallback.

### 4.3 Variant C — Wider over-fetch for MS (`--om-retriever-ms-overfetch 6.0`)

**Mechanism:** Over-fetch from each of dense and sparse changes from K * 3 to K * 6 (i.e., 60 candidates each instead of 30). The reranker (Cohere rerank-v3.5) sees twice as many candidates to choose from. More candidate diversity → reranker picks better cross-session combinations.

**Cost:** ~$15 Tier A — Cohere rerank cost scales with input size (~$0.0001 per 100 tokens). 60 vs 30 candidates ~doubles rerank cost on MS cases, but only on the ~5 MS cases per Tier A.

**Expected:** lifts MS rawToRetrieved by +5-15pp (modest, depends on whether the 30 over-fetch was already capturing the gold passages and the rerank step was the bottleneck).

**Implementation effort:** medium-low — the `overFetchTopK = recallTopK * 3` is hardcoded in HybridRetriever or its wrapper. Same plumbing question as Variant B.

---

## 5. Experiment plan

### 5.1 Phase 1 — plumbing (no LLM cost)

1. Add three RunConfig fields + 3 CLI flags + 3 cache fingerprint tags.
2. Wire per-case conditional override in `LongMemEvalS.runCase` (canonical-route branch).
3. Implement the per-call retriever parameter override (Option 1 bench-side preferred).
4. Add unit tests for the fingerprint + the per-case routing decision (3-5 tests).
5. Run `pnpm typecheck` (silent) + `pnpm vitest run` (must pass all existing 401+ tests + new ones).
6. Run `pnpm build` (silent).

### 5.2 Phase 2 — fire 3 Tier A variants in parallel (~$45 total)

Three v10 Tier A runs at N=24, all with `--om-dynamic-router --om-classifier-fewshot` (so the classifier still labels MS cases) but each with one Step 19 variant:

```bash
# Variant A
pnpm bench run longmemeval-s ... --om-retriever-ms-k 30 --max-usd 30 --sample-per-type 4

# Variant B
pnpm bench run longmemeval-s ... --om-retriever-ms-bm25-weight 0.7 --max-usd 30 --sample-per-type 4

# Variant C
pnpm bench run longmemeval-s ... --om-retriever-ms-overfetch 6.0 --max-usd 30 --sample-per-type 4
```

The three runs cache-independently via the new fingerprint tags. Total fresh-execute cost ~$45 (~$15 each). Wall clock ~10-20 minutes per run; can fire serial to avoid embedder API contention.

### 5.3 Phase 3 — diagnose + pick winner (~$0)

Per-correctness retention analysis on each variant's run JSON. Look for:

1. Which variant lifts MS `rawToRetrieved` the most? (Mechanism check: did the intervention actually pull more cross-session tokens into the retrieved set?)
2. Which variant lifts MS aggregate accuracy at Tier A without regressing other categories?
3. Which variant has the cleanest per-correctness signal (high gap, low wrong-case retention)?

Pick the strongest variant for Phase A ladder.

### 5.4 Phase 4 — Phase A on winning variant (~$30-50)

Fire winner at N=102. Apply existing Phase A kill criteria (canonical + 5pp at point estimate AND McNemar p < 0.05).

### 5.5 Phase 5 — Phase B (conditional, ~$120-150)

Only if Phase A clears the kill gate. Explicit user approval required.

---

## 6. Kill criteria

### 6.1 Phase 1 framework gate

- `pnpm typecheck` silent
- `pnpm vitest run` passes all existing tests + 3-5 new tests
- `pnpm build` silent
- Per-case override only fires for MS-classified cases (verified by reading run JSON metadata)

### 6.2 Tier A variant gates (per variant)

- **GREEN:** MS rawToRetrieved improves ≥ 10pp AND aggregate accuracy ≥ baseline (no regression > 5pp on any single category) → eligible for Phase A.
- **NULL:** MS rawToRetrieved unchanged or improved < 5pp AND aggregate accuracy unchanged → variant doesn't move the bottleneck. Document and don't ladder.
- **RED:** any variant regresses aggregate accuracy by > 5pp → STOP that variant. Other variants may still ladder.

### 6.3 Phase A gate

Per existing kill ladder (handoff §11): < canonical + 5pp at point estimate OR McNemar p ≥ 0.05 → STOP, do not fire Phase B.

---

## 7. Cost ledger

| Item | Cost | Cum. |
|---|---:|---:|
| Phase 1 framework code (no LLM) | $0 | $0 |
| Phase 2 Variant A Tier A | ~$10 | ~$10 |
| Phase 2 Variant B Tier A | ~$15 | ~$25 |
| Phase 2 Variant C Tier A | ~$15 | ~$40 |
| Phase 3 diagnosis (no LLM) | $0 | ~$40 |
| Phase 4 winner Phase A | ~$30-50 | ~$70-90 |
| Phase 5 Phase B (conditional, explicit approval) | ~$120-150 | ~$190-240 |

Approved budget: $1k+. Step 19 well within budget.

For comparison: Phase B v2 (the alternative we're skipping) would have cost ~$120-150 to confirm a +1.9pp effect within ±4pp CI noise. Step 19 spends $40 to test three architecturally-distinct hypotheses, then ~$30-50 to ladder the winner to Phase A. **Strictly better expected value at any reasonable success probability.**

---

## 8. Documentation expectations

Per handoff §10:

1. **Spec doc** (this file).
2. **Plan doc** at `docs/plans/2026-04-23-step-19-conditional-retriever-tuning-plan.md` — checkbox tasks for `superpowers:executing-plans`.
3. **Findings doc** at `docs/STEP_19_CONDITIONAL_RETRIEVER_TUNING_FINDINGS_{YYYY-MM-DD}.md`. Mirrors Step 18 structure.
4. **Umbrella scoreboard update** with Step 19 A/B/C row(s).
5. **Bench blog update** ONLY IF a shipping tier shifts.
6. **LEADERBOARD update** ONLY IF a shipping tier shifts at Phase B.
7. **Architecture decision matrix update** ONLY IF ship-tier assignments change.
8. **Next-session continuation handoff** capturing Step 18 + Step 19 trajectory.

---

## 9. Out of scope (defer)

- **Tuning the canonical retriever for OTHER categories.** The per-correctness data shows MS is the worst offender (raw→retrieved 0.365). Other categories are 0.708-1.000 raw→retrieved on canonical — not worth tuning at this stage.
- **Stacking with Step 18 v2 conditional reader prompt.** Each is independently testable. If both ladder green at Phase A, a stacked test (Step 18 v2 + Step 19 winner) is a future spec.
- **Modifying HybridRetriever in the agentos package.** Prefer bench-side shim per Option 1 in §2.2. Only touch agentos if the bench-side approach can't expose the necessary parameter overrides.
- **Per-question RRF k tuning** (the constant in the RRF formula). Out of scope — only the dense vs sparse weights are toggled in Variant B.
- **Trying retriever variants for non-OM tiers (canonical without router).** Would require running canonical at full N=500 per variant, expensive. Defer until v10 router stack proves the conditional pattern at retriever level.

---

## 10. Open questions to resolve during implementation

- **Where does HybridRetriever's RRF weight live?** Need to grep `agentos/src/memory/retrieval/hybrid/HybridRetriever.ts` to confirm whether `denseWeight: 0.7, sparseWeight: 0.3` is hardcoded in the call to `reciprocalRankFusion()` or accepted as a parameter. If hardcoded, Variant B requires either an agentos PR or a bench-side bypass.
- **Does `runFullCognitiveCase` accept per-call retriever overrides?** Need to read the function signature in `LongMemEvalS.ts` (line ~1164 per handoff §6). If it doesn't, the per-case override needs to construct a fresh HybridRetriever per call (more expensive setup but possible).
- **Cohere rerank cost scaling for Variant C** — confirm that doubling over-fetch K doesn't triple-bill the Cohere rerank call. Per Cohere pricing, rerank is per-query, not per-document; cost should scale linearly with documents scored.
- **Per-route v10 attribution for retention metric** — Step 18's `metadata.omRouterRunOM` boolean already exists. Step 19 should also use `metadata.omRouterCategory === 'multi-session'` to identify which canonical-route cases got the variant override applied. The retention aggregator should optionally split by `omRouterCategory` for finer diagnosis.

---

## 11. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Variant fails to lift MS rawToRetrieved → NULL result | Documented as informative null. The mechanism didn't reach the bottleneck; try a different mechanism in a v2 spec. |
| Variant lifts retention but not accuracy | Same per-correctness diagnostic from Step 18 applies — could indicate retrieved tokens aren't reader-actionable. Document and pivot. |
| Variant regresses aggregate accuracy beyond -5pp | STOP that variant per kill criteria. Other variants may still ladder. |
| HybridRetriever doesn't expose the necessary parameters | Implementation pivots to Option 2 (modify agentos) — adds 1-2 days of cross-package work. Spec calls this out so reviewers know the contingency. |
| All 3 variants fail at Tier A | Strong evidence canonical's retriever for MS is structurally limited at this query distribution. Pivot to Step 19 v2 (e.g., session-aware retrieval that explicitly requires top-K from ≥2 sessions for MS, or graph-expansion retrieval per umbrella §9.3). Out of current spec but a clear next direction. |

---

## 12. Acceptance criteria

The Step 19 work is "shipped" when:

1. ✅ Three new RunConfig fields + 3 CLI flags + 3 cache fingerprint tags + per-case routing logic + 3-5 unit tests committed.
2. ✅ Phase 2 produces 3 run JSONs each with `tokenRetention.perCorrectness` populated.
3. ✅ Phase 3 findings doc identifies which variant moves MS rawToRetrieved most + accuracy delta.
4. ✅ Either GREEN-ladder to Phase A, NULL-document, or RED-stop per kill criteria.
5. ✅ Findings doc + umbrella update + handoff committed (commits ONLY when user explicitly asks).

---

End of Step 19 spec.
