# AgentOS Memory Rollout — Fresh Session Handoff

**Updated:** 2026-04-21 (end of Steps 1-8 session)
**Previous canonical doc:** [RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md](./RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md)
**Current blog post:** [blog/2026-04-20-agentos-memory-longmemeval-rollout.md](./blog/2026-04-20-agentos-memory-longmemeval-rollout.md)

This doc gives a new Claude session the full picture: what's been built, what's been measured, what to do next, and the gotchas to avoid. **Supersedes the prior Phase A handoff (2026-04-19 version) at the same path.**

---

## 1. Elevator pitch

We're running a sequenced empirical investigation of retrieval-stack improvements for AgentOS's memory system, benchmarked on LongMemEval-S (Wu et al. 2024). Each proposed feature gets its own spec → plan → TDD implementation → kill-criterion Tier A smoke → Phase A N=102 → Phase B N=500 verdict cycle. Bootstrap CIs on every metric. Matched-reader methodology. Explicit cost tracking.

**Goal:** push AgentOS's LongMemEval-S score at matched gpt-4o reader above Mastra's published 84.23%. Hit a defensible top-tier number with reproducible methodology.

**Current headline:** **Tier 1 Hybrid at Phase B N=500 = 73.2% [69.2%, 77.0%] unweighted, 74.0% weighted, $0.0213 per correct answer at gpt-4o.** This is the shipping production candidate.

**Nothing above Tier 1 has worked yet.** Steps 2, 4, 5, 6, 7, 8 are all RED. The pattern: anything that transforms, drops, or replaces retrieval content via LLM intermediate steps regresses. Only ADDITIVE signal on top of dense + rerank (Step 3 Hybrid) has helped.

---

## 2. How to start the next session

Open a new Claude session in this repo (`/Users/johnn/Documents/git/voice-chat-assistant/`). Paste this prompt verbatim as the first message:

```
Continue the AgentOS memory rollout. Read the handoff doc at
packages/agentos-bench/docs/NEXT_SESSION_HANDOFF.md end-to-end.
Then verify the current git state on master (both monorepo and
packages/agentos submodule) matches what the handoff claims, and
report any drift before doing any new work. After verification,
propose the next concrete action per the handoff's "What to do next"
section and wait for approval before firing any LLM-cost work.
```

The new session should use superpowers (brainstorming → writing-plans → executing-plans) for any new step and must honor the global rules in `/Users/johnn/.claude/CLAUDE.md` (no em dashes, no git worktrees with submodules, push agentos submodule commits with `feat:`/`fix:` prefix to trigger semantic-release, etc.).

---

## 3. What's been done (Steps 1-8)

### Step 1 — GREEN (infrastructure, always on)

Bootstrap percentile confidence intervals (10,000 resamples, seeded Mulberry32 PRNG) + judge-adversarial probe that synthesizes topically-adjacent wrong answers and reports the judge's false-positive rate as a noise floor.

Files: [packages/agentos-bench/src/core/metrics/computeBootstrapCI.ts](../src/core/metrics/computeBootstrapCI.ts), [computeJudgeAdversarial.ts](../src/core/metrics/computeJudgeAdversarial.ts).

### Step 2 — RED (SessionRetriever without rerank)

Hierarchical two-stage retriever (top-K sessions by summary similarity, top-M chunks within each). Regressed -23.5pp on multi-session at Phase A. Root cause: didn't thread the rerank signal into the new retriever. Lesson: matched-ablation discipline is non-negotiable. Ships opt-in behind `--session-retrieval` flag.

### Step 3 — **GREEN-soft (shipping)** HybridRetriever

**BM25 + dense RRF + Cohere rerank-v3.5 blend.** The one GREEN feature.

- Phase B N=500 at gpt-4o: **73.2% [69.2%, 77.0%] unweighted**, 74.0% weighted, $0.0213/correct.
- Multi-session 54.9%, KU 86.8%, temporal 70.2%.
- Architecture doc at [packages/agentos/docs/architecture/hybrid-retriever.md](../../agentos/docs/architecture/hybrid-retriever.md).
- CLI: `--hybrid-retrieval`.

### Step 4 — RED (HyDE)

LLM generates a hypothetical answer, embed that instead of the raw query. Regressed -29 to -35pp. LongMemEval is specific-value dominant; hypothesis paraphrases erase high-IDF tokens. Ships opt-in behind `--hyde`.

### Step 5 — RED (FactSupersession)

LLM post-retrieval filter that drops "superseded" traces. Regressed knowledge-update 100% → 75% (the target category) and everything else worse. Over-drops: LLM removes traces the reader needed. Ships opt-in behind `--fact-supersession`.

### Step 6 — RED (Split-on-Ambiguous)

Rerank-score-guided content trimming with monotonic guarantee. Regressed -29pp. Monotonic on rerank-score-axis does not equal monotonic on reader-utility-axis. Ships opt-in behind `--split-ambiguous <n>`.

### Step 7 — RED (Observer/Reflector as ADDITIVE overlay)

Wired the dormant Mastra-style Observer/Reflector pipeline, producing reflection-derived traces ALONGSIDE raw chunks. Regressed -25pp at Tier A (62.5%). Additive overlay dilutes retrieval; BM25/dense see asymmetric views (raw chunks in both, reflection traces dense-only). Ships opt-in behind `--observer-reflector`.

### Step 8 — **RED (just completed)** — Observer/Reflector as REPLACEMENT

Architecturally-correct fix for Step 7: skip raw chunk encoding when observer is on, force reflection at session boundaries via new `manager.flushReflection()` method, index reflection traces into BM25 so dense+sparse see symmetric views.

Two Tier A runs:
- **Run 1 (with scope bug):** 4.2% — reflector-invented scopeIds (`running_01`, `furniture_01`, etc.) put traces in different vector-store collections from what retrieval queried.
- **Run 2 (scope fix applied):** 25.0% — still killed (vs 87.5% baseline, -62.5pp).

After the scope fix, per-category reveals the architectural problem: preference 75%, user 50%, multi-session 25%, **KU 0%, assistant 0%, temporal 0%**. LLM-generated summaries lose the specific tokens the reader needs. Same failure mode as Step 5 FactSupersession at a different layer.

**Two Tier 2 variants tested (Steps 7 + 8), both RED.** Observer/Reflector as currently implemented in AgentOS does not help on LongMemEval-S at gpt-4o.

Ships opt-in behind `--observer-reflector --observer-reflector-replace`. The `flushReflection(mood?, scopeOverride?)` primitive is genuinely useful to downstream AgentOS consumers and ships regardless as `fix(memory)` in v0.1.249+.

---

## 4. Current measured state

### Progressive Enhancement Tier scoreboard

| Tier | Flags | Measured LME-S @ gpt-4o | $/correct | Status |
|---|---|---:|---:|---|
| Tier 0 (bare) | (none) | ~60% projected | ~$0.032 | untested |
| **Tier 1 (default)** | `--hybrid-retrieval --context-summary gpt-5-mini` | **73.2%** [69.2, 77.0] N=500 | **$0.0213** | **shipping** |
| Tier 2 additive (Step 7) | + `--observer-reflector` | 62.5% N=24 | $0.10+ | RED, opt-in |
| Tier 2 replacement (Step 8) | + `--observer-reflector --observer-reflector-replace` | 25.0% N=24 | $0.58 | RED, opt-in |
| Tier 3 (Step 9, planned) | + `--fact-graph-ingest` (Mem0 pattern) | TBD | TBD | no spec yet |
| Tier 4 (Step 10, planned) | + `--two-call-reader` (Emergence AI pattern) | TBD | TBD | no spec yet |

### Competitor landscape at gpt-4o (for positioning)

| System | LME-S | Notes |
|---|---:|---|
| Vanilla full-context | ~60-66% | Zep's own baseline replication |
| Zep / Graphiti | 71.2% | published |
| **AgentOS Step 3 Hybrid** | **73.2%** | **this work** |
| Mastra Observational Memory | 84.23% (gpt-4o) / 94.87% (gpt-5-mini) | published |
| Emergence AI RAG | 86% | two-stage + NDCG rerank + reasoning |
| Mem0 | 92.0 | token-efficient fact extraction |

### Cost totals across the rollout

| Step | Cost |
|---|---:|
| Step 1 (infra) | $0.02 |
| Step 2 SessionRetriever | $0.30 |
| Step 3 Hybrid (Phase B incl.) | $0.40 + $7.80 Phase B |
| Step 4 HyDE | $0.15 |
| Step 5 FactSupersession | $0.17 |
| Step 6 Split-on-Ambiguous | $0.07 |
| Step 7 Observer additive | $7.37 (gpt-4o observer wiring bug) |
| Step 8 Observer replacement | $7.20 |
| **Cumulative** | **~$23.48** |

Kill-criterion discipline has prevented many Phase A/B runs from firing on known-dead variants. Hundreds of dollars saved.

---

## 5. What to do next

Step 9 ran 2026-04-21 and RED'd at Tier A. See [STEP_9_FACT_GRAPH_FINDINGS_2026-04-21.md](STEP_9_FACT_GRAPH_FINDINGS_2026-04-21.md). The empirical rule from 7 RED steps is now: any LLM intermediate transformation on retrieval content regresses on specific-value LongMemEval-S.

### Step 9 outcome — measured

- **Tier A N=24: 58.3% unweighted [37.5%, 79.2%], 29.2pp below Tier 1 smoke 87.5%**.
- **Cost: $3.05 total ($0.218/correct, 10× Tier 1)**.
- **Diagnostic (load-bearing):** `evidenceOrigin: { user_statement: 19, fact_graph: 0, none: 5 }` — reader quoted raw chunks on every correct answer; zero of 24 cases attributed to fact-graph synthetic traces. Phase 1 `evidenceOrigin` instrumentation (shipped alongside Step 9) delivered the diagnosis in one Tier A run.
- **Root cause layered:** (1) synthetic `retrievalScore: 1.0` displaced real chunks during rerank (merged.recall 0.774 → final.recall 0.712, -6.2pp). (2) Even when synthetic + raw were both in top-K, reader preferred raw chunks' conversational context. (3) Extractor probably paraphrases the `object` field despite instructions.
- **Ships opt-in behind `--fact-graph-ingest`.** Tier 1 remains shipping default.
- Kill criterion saved ~$12-27 on Phase A + B that would have been wasted.

### Step 9b candidate — lower synthetic retrievalScore

**Rationale:** Step 9's `retrievalScore: 1.0` synthetic traces displaced raw chunks. A variant setting the synthetic score to the fact's extraction confidence (or a flat 0.5) would keep raw chunks in the final top-K while still giving fact-graph a chance to surface via rerank. Cheapest Step 9 follow-up.

**Budget:** ~$3 for Tier A only (skip Phase A/B if Tier A doesn't pass the 82.5% gate).

**Decision gate:** only worth running if the user wants to close out the fact-graph line of investigation before declaring it RED-across-all-variants. Otherwise, accept Step 9 RED and move on.

### Step 10 — Tier 4 two-call reader (Emergence AI pattern)

**Rationale:** Emergence AI's 86% comes from a two-call reader pipeline (first call extracts relevant facts from retrieved chunks, second call answers using only extracted facts). Orthogonal to retrieval-layer changes; changes the reader pipeline instead.

**Budget:** $20-40 for Tier A + Phase A + Phase B.

**Caveat:** this is a READER change, not a MEMORY change. If it works, the lift is from reader pipeline discipline, not AgentOS memory architecture.

### Step 11 — tuned reflector prompt (highest expected value in reflector family)

Step 9's RED leaves this as the most informative remaining experiment. The reflector prompt tells the LLM to "consolidate" and "elevate important facts," which gpt-5-mini interprets as permission to produce abstract paraphrases. A variant prompt instructing the reflector to preserve names, dates, numeric values verbatim is the cheapest way to test whether Mastra's 84.23% at gpt-4o is achievable with our pipeline.

**Budget:** $3-5 for Tier A.

### Step 12 (untested) — graph-expansion retrieval

**Rationale:** pull traces connected by shared-entity edges to the top-K. Additive signal (not destructive), genuinely different from Steps 4-9. Might lift multi-session further. AgentOS already has `SqliteKnowledgeGraph` + spreading activation; the bench adapter doesn't use it for query expansion yet.

**Budget:** ~$1-2 for Tier A.

### Recommendation

In order of expected ROI per dollar:
1. **Accept Step 9 RED, publish.** The Phase 1 instrumentation (paired McNemar + evidence provenance + stage-level retrieval metrics) is the durable value from this sprint. The blog post + umbrella are updated with Step 9 findings.
2. **Step 11 tuned reflector prompt** if you want one more shot at frontier parity. $3-5, high diagnostic value regardless of outcome.
3. **Step 12 graph-expansion retrieval** as the last untested additive-signal candidate. $1-2 Tier A.
4. **Step 10 two-call reader** only if you want the blog to demonstrate reader-side experiments. Orthogonal to the memory architecture story.
5. Skip Step 9b unless you specifically want to close out the fact-graph line.

---

## 6. Critical gotchas (learned the hard way this session)

### 6.1 Agentos build sometimes has to be re-run mid-session

Changes to `packages/agentos/src/` need `pnpm build` inside `packages/agentos/` before bench code can use them via `@framers/agentos` imports. TypeScript typecheck in bench will surface missing types after agentos source changes. Always rebuild agentos when bench imports fail with "property does not exist on type."

### 6.2 Observer/reflector cost model

The observer pipeline fires LLM calls at its own thresholds (30k-token buffer → notes, 50 notes → compressed, 40k compressed → reflection). For LongMemEval-S 115k-token haystacks with 40 sessions:
- Observer ~3-4 firings per case (extracting notes from buffered turns).
- Reflector fires almost never at default 40k threshold within a single case.
- Session-boundary manual `flushReflection()` is the way to force per-session reflection.

**Always use gpt-5-mini as observer invoker, not the main reader.** Mastra uses gpt-5-mini. First Step 7 run accidentally used gpt-4o via `hydeReader` reuse: $7.37 for 24 cases. With gpt-5-mini: ~$1.50 for 24 cases. Fix is in `LongMemEvalS.ts` via `createReader('gpt-5-mini')`.

### 6.3 Reflector-invented scopeIds

`MemoryReflector.reflect()` lets the LLM invent scope/scopeId from content. Produces things like `scope: 'user', scopeId: 'running_01'`. The bench queries retrieval at `scope: 'user', scopeId: 'bench'`. Traces land in different vector-store collections. **Always pass `scopeOverride` to `flushReflection` when using it in a bench.** Fix committed as `34167a9f7`.

### 6.4 Cache-key fingerprints must distinguish model/variant changes

Step 8 Run 2 silently returned Run 1's 4.2% because cache fingerprint `observer-reflector:replace` was the same before and after the scope fix. Had to bump to `observer-reflector:replace-v2` to invalidate. **Future features that iterate through variants must include the variant in the fingerprint** (e.g. `observer-reflector:replace-{v2,v3,...}`, `fact-graph-ingest:gpt-5-mini`, `fact-graph-ingest:gpt-4o`). Consumer: `packages/agentos-bench/src/core/BenchmarkRunner.ts:computeCaseRunKeyParts`.

### 6.5 Release workflow requires conventional-commits prefix

`framersai/agentos` uses semantic-release with conventional-commits preset. Only `feat:`, `fix:`, `perf:`, `refactor:`, `revert:` prefixes trigger releases. Our initial `memory:`, `bench:`, `docs:`, `chore:` prefixes produced NO releases. Now using `feat(memory):` / `fix(memory):` when shipping user-visible changes. v0.1.248 + v0.1.249 were cut this way.

### 6.6 Submodule push discipline

`packages/agentos` is a submodule pointing at `framersai/agentos`. Every push requires:
1. Local rebase onto `origin/master` (release commits that hit after our last pull).
2. `git update-index --skip-worktree` on `db_data/` + `dist/` modifications (blocking rebase).
3. Push.
4. `git update-index --no-skip-worktree` to restore.
5. Bump the monorepo pointer with `git add packages/agentos && git commit -m "chore: bump agentos submodule (...)"` + push monorepo.

### 6.7 `tail -Nn` pipes defeat progress visibility

Bench commands piped through `tail -25` buffer everything until the process exits. For runs over 30 min, check `ps -p $PID -o etime,%cpu` and `lsof -p $PID | grep ESTABLISHED | wc -l` for liveness. Memory usage rising then falling indicates cases are being processed and freed.

### 6.8 Wunderland-sol pnpm-store ENAMETOOLONG

`apps/wunderland-sol/.pnpm-store/.../.pnpm-store/...` has recursive symlinks that break vitest if the test command isn't `cd`-ed into the bench package first. Always run `cd packages/agentos-bench && pnpm vitest ...`, never `pnpm vitest` from root.

### 6.9 User's global rules to honor

From `/Users/johnn/.claude/CLAUDE.md`:
- **No em dashes** in prose (the #1 LLM tell). Use periods, commas, colons.
- No git worktrees with submodules.
- Master branch, never main.
- Opus 4.6/4.7 for ALL subagents.
- No AI attribution in commit messages.
- Always `--no-verify` on monorepo commits (secretlint blocks on tracked .env).
- Push submodule commits immediately after commit.
- NEVER push unless explicitly asked (conflicts with above: the exception is submodule commits and user-approved pushes of the current step's work).
- No stash/reset (other sessions may be active).
- Work from `apps/wilds-ai/` when doing wilds-ai work; `apps/wilds-ai/.env` holds API keys for bench runs too.
- Stop at end of session topic, don't hunt adjacent bugs.

---

## 7. Code + doc locations

### Core code

- **HybridRetriever** (Step 3, the GREEN one): [packages/agentos/src/memory/retrieval/hybrid/HybridRetriever.ts](../../agentos/src/memory/retrieval/hybrid/HybridRetriever.ts)
- **MemoryObserver** (Mastra-style): [packages/agentos/src/memory/pipeline/observation/MemoryObserver.ts](../../agentos/src/memory/pipeline/observation/MemoryObserver.ts)
- **MemoryReflector** (notes → traces + supersession): [packages/agentos/src/memory/pipeline/observation/MemoryReflector.ts](../../agentos/src/memory/pipeline/observation/MemoryReflector.ts)
- **CognitiveMemoryManager** (orchestrator; has getReflector + flushReflection added in Step 8): [packages/agentos/src/memory/CognitiveMemoryManager.ts](../../agentos/src/memory/CognitiveMemoryManager.ts)
- **Bench adapter** (wiring + replay + retrieve): [packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts](../src/benchmarks/longmemeval/LongMemEvalS.ts)
- **Bench runner** (cache keys, CI wiring): [packages/agentos-bench/src/core/BenchmarkRunner.ts](../src/core/BenchmarkRunner.ts)
- **Bench CLI**: [packages/agentos-bench/src/cli.ts](../src/cli.ts)
- **createCognitiveManager** (builds bench-ready CognitiveMemoryManager with reranker + observer): [packages/agentos-bench/src/cognitive/createCognitiveManager.ts](../src/cognitive/createCognitiveManager.ts)

### Findings docs (committed)

- `STEP_1_BOOTSTRAP_CI_AND_JUDGE_ADVERSARIAL_FINDINGS_2026-04-20.md`
- `STEP_2_SESSION_RETRIEVER_FINDINGS_2026-04-20.md`
- `STEP_3_HYBRID_RETRIEVER_FINDINGS_2026-04-20.md` (the GREEN one)
- `STEP_4_HYDE_ENABLE_FINDINGS_2026-04-20.md`
- `STEP_5_FACT_SUPERSESSION_FINDINGS_2026-04-20.md`
- `STEP_6_SPLIT_ON_AMBIGUOUS_FINDINGS_2026-04-20.md`
- `STEP_7_OBSERVER_REFLECTOR_FINDINGS_2026-04-20.md`
- **`STEP_8_OBSERVER_REPLACE_FINDINGS_2026-04-20.md`** (just added, committed as `37a6228f25`)
- `RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md` (umbrella across 6 steps, needs Step 7/8 update in fresh session)
- `blog/2026-04-20-agentos-memory-longmemeval-rollout.md` (blog post, current + Step 7; needs Step 8 update in fresh session)

### Specs + plans (in-tree, gitignored at `packages/agentos/docs/superpowers/specs,plans/`)

Each step has:
- `YYYY-MM-DD-step-N-<topic>-design.md` (spec)
- `YYYY-MM-DD-step-N-<topic>.md` (implementation plan)

These directories are gitignored in the agentos submodule, so specs/plans are local to the author's machine. The new session will have them already since this machine is the author.

### Run JSONs

Every measurement produces a run JSON committed to `packages/agentos-bench/results/runs/`. File names encode timestamp + benchmark + reader + memory mode. The canonical Phase B N=500 result is `2026-04-20T20-03-14-675--longmemeval-s--gpt-4o--full-cognitive--ingest.json`. Step 8's two run JSONs are `2026-04-21T05-37-27-009--*.json` and `2026-04-21T05-39-41-488--*.json`.

---

## 8. Reproducibility — bench CLI cheat sheet

From `packages/agentos-bench/`, with env sourced from `apps/wilds-ai/.env`:

```bash
# Tier 1 default (shipping baseline, full N=500)
set -a; source /Users/johnn/Documents/git/voice-chat-assistant/apps/wilds-ai/.env; set +a; node dist/cli.js run longmemeval-s \
  --reader gpt-4o --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --rerank cohere --context-summary gpt-5-mini \
  --hybrid-retrieval --reader-top-k 10 \
  --bootstrap-resamples 10000 --seed 42 \
  --max-usd 10.00

# Add --stratified --sample-per-type 4 for N=24 smoke
# Add --stratified --sample-per-type 17 for N=102 Phase A
# Omit stratified for full N=500 Phase B

# Available feature flags (all opt-in):
# --hyde                        Step 4 RED
# --fact-supersession           Step 5 RED
# --split-ambiguous 0.3         Step 6 RED
# --observer-reflector          Step 7 RED (additive)
# --observer-reflector --observer-reflector-replace  Step 8 RED (replacement)
# (Step 9 fact-graph-ingest — not yet implemented)
# (Step 10 two-call-reader — not yet implemented)
```

---

## 9. Outstanding tasks

- [ ] Update the umbrella findings doc with Step 7 + Step 8 (currently ends at Step 6)
- [ ] Update the blog post's Progressive Enhancement Tier table with Step 8 RED result (currently has Step 7 only)
- [ ] Decide whether to proceed with Step 9 fact-graph ingest (Mem0 pattern, $15-30 budget) — **USER HAS APPROVED budget in principle**
- [ ] Decide whether to proceed with Step 10 two-call reader (Emergence AI pattern, $20-40 budget)
- [ ] If both Step 9 + 10 GREEN, flip Tier 1 default to include the winning combination
- [ ] If both RED, publish the blog + umbrella findings with a clean "Tier 1 ships, Mastra-tier requires a reflector-prompt redesign" conclusion

---

## 10. Non-negotiables for the new session

- **Read this entire handoff before doing anything.** Then verify git state.
- **No em dashes** in any prose (blog, findings, specs). Global rule.
- **Use superpowers** (brainstorming → writing-plans → executing-plans) for any new step.
- **Matched-ablation discipline.** Every new feature compared at the same reader + judge + embedder.
- **Kill criterion before Phase B.** Don't fire expensive runs on a smoke that lost over 5pp weighted.
- **Observer/reflector invoker = gpt-5-mini**, not the main reader.
- **Cache fingerprints must distinguish variants.** Bump `:v2` if iterating.
- **Push agentos submodule commits with `feat:` or `fix:` prefix** if they should cut a release. Otherwise semantic-release ignores them.
- **Never claim SOTA.** We sit between Zep (71.2%) and Mastra (84.23%) at matched reader. Top-tier shipping is the honest framing; SOTA would require closing the 11pp gap.

---

## 11. Session accomplishment summary

- Shipped Step 3 HybridRetriever at production-quality measured 73.2% Phase B.
- Completed 7 additional experimental steps with explicit RED verdicts and full methodology.
- Total experimental cost across all 8 steps: ~$23.48.
- Added `FlushReflectionResult` + `getReflector()` + `flushReflection()` primitives to agentos core (ships in v0.1.249).
- Added `flushReflection` scopeOverride param (ships in next release).
- Published blog post + umbrella findings + 8 step-level findings docs all with real measurements and full reproducibility.
- Methodology contribution: matched-ablation + bootstrap CIs + kill-criterion across 8 studies.
- The empirical rule confirmed at n=7 (all 7 non-additive variants regress): **LLM intermediate steps that transform retrieval content erase the specific tokens LongMemEval's reader needs**. Only additive signal (BM25 alongside dense, rerank as a blend component) composes correctly on this workload.

---

End of handoff.
