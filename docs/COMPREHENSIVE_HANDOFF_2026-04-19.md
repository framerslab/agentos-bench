# Comprehensive Handoff — AgentOS Memory Benchmark, 2026-04-19 (evening)

**Purpose:** everything a fresh Claude Code session needs to pick up this work with zero prior context. Includes mission, verified numbers, architecture, file map, cost honesty, every failed experiment, current open question, and the exact prompt text to paste into a new session.

**Prior handoffs to also read:**
- [NEXT_SESSION_HANDOFF.md](./NEXT_SESSION_HANDOFF.md) — the running session-to-session baton (now partly outdated by this doc)
- [PHASE_A_FINDINGS_2026-04-19.md](./PHASE_A_FINDINGS_2026-04-19.md) — Phase A (102-case) detailed findings
- [PHASE_0_FINDINGS.md](./PHASE_0_FINDINGS.md) — original metrics-framework + signal-ablation findings
- [SOTA_RESEARCH_2026-04-19.md](./SOTA_RESEARCH_2026-04-19.md) — deep research on SOTA techniques
- [INDUSTRY_CONTEXTUAL_RETRIEVAL_RESEARCH_2026-04-19.md](./INDUSTRY_CONTEXTUAL_RETRIEVAL_RESEARCH_2026-04-19.md) — verified library adoption of Anthropic contextual retrieval

---

## 1. Mission

Ship a **citation-backed, honest-numbers blog post** demonstrating AgentOS's cognitive memory layer on public agent-memory benchmarks. Target publications: `apps/agentos-live-docs/blog/` (Docusaurus) AND `apps/agentos.sh/content/blog/` (Astro marketing).

**Three claims the blog should back with numbers**, every claim gated on matched-reader comparison:

1. **Accuracy is competitive** on published benchmarks at matched reader (gpt-5-mini).
2. **Architectural cost advantage** (call counts / tokens at matched reader), not a pricing-tier artifact.
3. **The cognitive-memory layer earns its keep** (signal ablation results — see Phase 0 doc).

**Hard-coded honesty rules (from user, repeated verbatim multiple times):**

- **Never claim cost advantage across different reader models.** gpt-5-mini at $0.25/1M input vs gpt-4o at $2.50/1M is a pricing tier, not architecture. Write same-reader tables only; if the only competitor number is at gpt-4o and we run gpt-5-mini, say "not directly comparable on cost — Phase C gate."
- **Verify every specific number before claiming it.** If the source is "it seemed plausible," rewrite the claim. This session burned two trust breaks by inventing (a) "10-18× cheaper than SOTA" cross-reader and (b) "Mastra fires ~15+ Observer calls per session" un-verified. Both are fixed; feedback memory pinned.

---

## 2. User rules (global CLAUDE.md + session-specific)

Read `~/.claude/CLAUDE.md` + per-project memory at `~/.claude/projects/-Users-johnn-Documents-git-voice-chat-assistant/memory/MEMORY.md`. Highlights relevant to THIS work:

- **No subagents.** Do all work directly, never dispatch the Agent tool.
- **No git worktrees with submodules** (agentos is a submodule).
- **Always `master`** branch, never `main`.
- **No em dashes** in prose — use periods/commas/colons.
- **No AI / Claude / Opus mentions** in commit messages. Write commits as if a human developer wrote them.
- **No "Co-Authored-By: Claude..."** lines.
- **Never commit unless explicitly asked.** In doubt, stage only.
- **Only run targeted tests** — never full suite. In agentos-bench, `cd packages/agentos-bench && pnpm test -- --run` is fine (the package IS the targeted scope).
- **Production builds only** in wilds-ai contexts — don't `next dev`.
- **No local `next build`** — push + CI deploys.
- **Postgres in production**, SQLite only when portability matters.
- **Use `--no-verify`** on monorepo commits if hooks block (secretlint).
- **`docs/superpowers/`** is gitignored in agentos submodule. Plans + specs live there.
- **`packages/agentos-bench/docs/`** is TRACKED — findings docs are public.
- **Use `deep-research` skill for web research** — never raw curl to Serper/Tavily/Firecrawl.

Full memory files at `~/.claude/projects/-Users-johnn-Documents-git-voice-chat-assistant/memory/` — worth skimming on session start.

---

## 3. Repo / packages map

Monorepo root: `/Users/johnn/Documents/git/voice-chat-assistant/`

| Path | Remote | Role |
|---|---|---|
| `packages/agentos/` | `github.com/framersai/agentos` (submodule) | Core cognitive memory library. `CognitiveMemoryManager`, `RerankerService`, `CohereReranker`, `MemoryObserver`, `MemoryReflector`, **`SessionSummarizer`** (Anthropic contextual retrieval, added this session). |
| `packages/agentos-bench/` | monorepo-local (NOT a submodule) | Benchmark harness. LongMemEval, LOCOMO, Oracle adapters + micro-benchmarks. Where almost all this session's work happened. |
| `packages/agentos-extensions/` | `github.com/framersai/agentos-extensions` (submodule) | Agentos ecosystem extensions. Not touched. |
| `packages/sql-storage-adapter/` | `github.com/framersai/sql-storage-adapter` (submodule) | Storage adapter. Not touched by us, but its `dist/index.js` had a transient rebuild gap mid-smoke today; re-verify it's present before running. |
| `apps/wilds-ai/` | `github.com/framersai/wilds-ai` (submodule) | Primary consumer app (game platform). Not touched this session, but `.env.local` holds our `OPENAI_API_KEY`, `COHERE_API_KEY`, `SERPER_API_KEY`, `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`. |
| `apps/paracosm/` | `github.com/framersai/paracosm` (submodule) | Second consumer. Not touched. |
| `apps/agentos-live-docs/` | monorepo-local | Docusaurus docs site. Future blog home. |
| `apps/agentos.sh/` | `github.com/framersai/agentos.sh` (submodule) | Astro marketing site. Future blog home. |

**Submodule push rule (from global CLAUDE.md):** commit in submodule → push submodule → update monorepo pointer. Never `git subtree push`. Never force-push without asking.

---

## 4. Current production state (verified, reproducible)

As of 2026-04-19 evening, `git status` in the monorepo shows agentos-bench changes staged, agentos submodule has `SessionSummarizer` staged on local master but not yet committed.

### Production stack config (what the default CLI invocation uses today)

```
reader: gpt-5-mini (OpenAI)
judge: gpt-4o (OpenAI)
memory mode: full-cognitive
replay mode: ingest
embedder: openai:text-embedding-3-small (1536-dim), CachedEmbedder wrapper for disk cache
rerank: cohere rerank-v3.5 (candidateMultiplier=3 → 30-chunk rerank pool for K=10)
contextual retrieval: session-summary prepend, summarizer=gpt-5-mini, on-disk cache
reader prompt: v9 (latest-wins for knowledge-update + temporal scratchpad + personalization rule for advice + anti-abstention — full comment block in LongMemEvalS.ts `buildFullCognitivePrompt`)
reader top-K: 10 (default; `--reader-top-k N` flag available per this session's Option 1 plumbing)
```

### Verified accuracy numbers

**LongMemEval-S @ gpt-5-mini, Phase A (102 stratified cases):**

| Version | Unweighted | Weighted | Multi-session | Cost/correct |
|---|---:|---:|---:|---:|
| v9 + rerank (no contextual retrieval) | 85.3% | 80.6% | 56.3% (9/16) | $0.0028 |
| v9 + rerank + **contextual retrieval** (current production) | **85.3%** | **87.1%** | **68.8%** (11/16) | **$0.0024** |
| v9 + rerank + contextual retrieval + **K=15** (Option 1 Phase A this session) | 89.2% | 85.9% | 64.7% (11/17) | $0.0032 |

**Smoke cells at 24 cases (high variance, directional only):**

| Benchmark | N | Unweighted | Cost/correct | Notes |
|---|---:|---:|---:|---|
| LongMemEval-Oracle | 24 | 79.2% | $0.0027 | Pre-ctx retrieval smoke |
| LOCOMO | 30 | 60.0% (v5) / 63.3% (v8) / 53.3% (v9) | $0.0012–0.0016 | Known judge-inconsistency issue on adversarial (17%) |
| LME-S at K=10 fresh-cache (today) | 24 | 79.2% | $0.0037 | Confirms ±10pp N=24 variance |
| LME-S at K=15 (today smoke) | 24 | 83.3% | $0.0044 | K=15 on same sample, multi-session didn't move |

### The 95.8% number I was previously citing

**Retracted.** It was an N=24 lucky-variance outcome at an early v9+ctx smoke. Phase A at N=102 shows the real baseline is 85.3% unweighted / 87.1% weighted. At N=24 variance per category is ±10pp — a 4-of-4 sweep in 4-5 categories gave the lucky 95.8%. Today's fresh-cache K=10 re-run produced 79.2% at the same config — the unlucky end of the same variance window.

**Rule for future:** report Phase A numbers as the accuracy signal. Smoke results are directional at best.

---

## 5. Cost matrix — same architecture, variable reader

From measured token counts on the 24-case v9+ctx run: **175,283 reader-in + 2,947 reader-out tokens** across 24 cases.

Same architecture, same chunking, same prompt, same rerank — only the reader price changes:

| Reader | Input $/M | Output $/M | Reader cost / 24 cases | Reader cost / correct |
|---|---:|---:|---:|---:|
| **gpt-5-mini** (our actual cell) | $0.25 | $2.00 | $0.050 | **$0.00216** |
| claude-haiku-4-5 (projected) | $0.80 | $4.00 | $0.152 | $0.00661 |
| gpt-4o (projected) | $2.50 | $10.00 | $0.468 | $0.02033 |
| claude-sonnet-4-6 (projected) | $3.00 | $15.00 | $0.570 | $0.02478 |

All-in (reader + judge gpt-4o + embedding + rerank + summary, amortized warm-cache):

| Reader | All-in $/correct |
|---|---:|
| gpt-5-mini | **~$0.003** |
| claude-haiku-4-5 | ~$0.008 |
| gpt-4o | ~$0.022 |
| claude-sonnet-4-6 | ~$0.026 |

**Rule:** compare $/correct only at same reader. Cross-reader ratios are pricing artifacts.

---

## 6. Verified competitor numbers (Mastra OM as primary comparable)

**Mastra Observational Memory architecture** (verified from [docs](https://mastra.ai/docs/memory/observational-memory) + [workshop repo](https://github.com/mastra-ai/mastra-observational-memory-workshop)):

- Observer fires when **unprocessed messages hit 30,000 tokens** (threshold)
- Reflector fires when **observations hit 40,000 tokens** (threshold)
- For a 115k-token LongMemEval case, that's **~4 Observer calls + 1-2 Reflector calls = ~5-6 ingest LLM calls per case**
- Default summarizer/observer model: `google/gemini-2.5-flash`
- Reader context: ~30k tokens stable prefix + live messages, prompt-cached

**Mastra OM published LongMemEval-S results** (from [mastra.ai/research/observational-memory](https://mastra.ai/research/observational-memory)):

| Model | Overall | Multi-session | Temporal | Preference | Knowledge-update |
|---|---:|---:|---:|---:|---:|
| gpt-5-mini | **94.87%** | 87.2% | 95.5% | 100.0% | 96.2% |
| gemini-3-pro-preview | 93.27% | — | — | — | — |
| gpt-4o | 84.23% | 79.7% | 85.7% | 73.3% | 85.9% |

**Our AgentOS numbers at gpt-5-mini (Phase A v9+rerank+contextual retrieval):**

| Metric | AgentOS | Mastra OM | Gap |
|---|---:|---:|---:|
| Overall | 85.3% | 94.87% | −9.6pp |
| Weighted | 87.1% | — | — |
| Multi-session | **68.8%** | **87.2%** | **−18.4pp** ← dominant remaining gap |
| Temporal | 88.2% | 95.5% | −7.3 |
| Preference | 94.1% | 100% | −5.9 |
| Knowledge-update | 94.1% | 96.2% | −2.1 |

**Call-count comparison at matched reader (architectural, not pricing):** AgentOS amortizes ~4 ingest LLM calls per case across a 500-case sweep (one summary per unique session, content-addressed cache). Mastra OM: ~5-6 per case (no cross-case cache as far as we know). Ratio: **~1.5× fewer calls for AgentOS**, NOT an order of magnitude.

**LOCOMO public leaderboard** (from [dev.to compilation](https://dev.to/varun_pratapbhardwaj_b13/5-ai-agent-memory-systems-compared-mem0-zep-letta-supermemory-superlocalmemory-2026-benchmark-59p3)):

| System | Score | Reader required |
|---|---:|---|
| EverMemOS | 92.3% | cloud |
| MemMachine | 91.7% | cloud |
| Hindsight | 89.6% | cloud |
| Zep | ~85% | cloud |
| Letta/MemGPT | ~83.2% | cloud |
| Supermemory | ~70% | cloud |
| Mem0 (independent measurement) | ~58% | cloud |
| **AgentOS (our smoke N=30 @ gpt-5-mini, v9+ctx+rerank)** | **53.3%** | gpt-5-mini |

LOCOMO has a known adversarial-category judge-inconsistency problem (Mastra declines to publish LOCOMO because of it).

---

## 7. Complete file change inventory (this session)

### In `packages/agentos/` (core — gitignored specs + one real code change)

**New file (not yet committed to `framersai/agentos`):**
- `src/memory/ingest/SessionSummarizer.ts` — LLM-backed session-level contextual retrieval (Anthropic Sep 2024 variant, session-granularity). Content-addressed disk cache. Exported from `packages/agentos/src/memory/index.ts` as `SessionSummarizer`, `SessionSummarizerInvoker`, `SessionSummarizerOptions`, `SummarizerStats`.
- `src/memory/ingest/__tests__/SessionSummarizer.spec.ts` — 12 unit tests (cache hit/miss, disk persistence, cache invalidation on model/template change, content-addressed, concurrency safety).

**Gitignored under `docs/superpowers/` (local-only, not pushed):**
- `specs/2026-04-19-reader-topk-bump-design.md` — Option 1 design spec
- `plans/2026-04-19-reader-topk-bump.md` — Option 1 implementation plan

### In `packages/agentos-bench/` (tracked)

**Modified:**
- `src/core/IBenchmark.ts` — added `RunConfig.rerank`, `RunConfig.contextSummaryModel`, `RunConfig.readerTopK`. Matching `BenchContext['config']` Pick/Omit updates.
- `src/core/BenchmarkRunner.ts` — `redactSecretsFromConfig`, `computeCaseRunKeyParts` (extracted helper, exported for tests), `CaseKeyContext` interface, `CASE_RUN_SCHEMA_VERSION = 'v8'` (module-level).
- `src/cli.ts` — flags: `--rerank cohere`, `--rerank-model`, `--rerank-api-key`, `--rerank-candidate-multiplier`, `--context-summary <model>`, `--reader-top-k N`. `parsePositiveInteger` validator. Constructs `SessionSummarizer` from `@framers/agentos/memory` and passes to adapters.
- `src/cognitive/createCognitiveManager.ts` — accepts Cohere reranker config; constructs `RerankerService` + `CohereReranker` provider; passes to `CognitiveMemoryManager.initialize` via `rerankerService`.
- `src/benchmarks/longmemeval/LongMemEvalS.ts` — rerank wiring, candidate-pool expansion (3× multiplier when rerank active), RETRIEVAL_SCORE_MIN_RERANKED=0.1, session-summary prepend in `replayForCognitive` (both `observe` and `ingest` paths), v9 reader prompt with detailed failed-experiment log (v6, v7, Fix A, session-diverse top-K revert notes), `sessionSummarizer` adapter option, `readerTopK` resolution priority.
- `src/benchmarks/longmemeval/index.ts` — unchanged; `LongMemEvalM` / `LongMemEvalOracle` inherit all new behavior transparently.
- `src/benchmarks/locomo/Locomo.ts` — stratified sampling, dataset schema fix for `number` answer, `sessionSummarizer` option, `readerTopK` resolution priority.
- `src/benchmarks/locomo/dataset.ts` — accept `z.number()` in QA answer union.

**New files:**
- `tests/redactSecretsFromConfig.spec.ts` — 5 tests pinning API-key redaction invariants.
- `tests/readerTopK.spec.ts` — 3 tests pinning readerTopK propagation + conditional cache-key append + backwards-compat length pin.
- `docs/PHASE_A_FINDINGS_2026-04-19.md` — Phase A detailed findings (v9+rerank+ctx baseline + same-arch cost matrix).
- `docs/SOTA_RESEARCH_2026-04-19.md` — deep research on SOTA RAG techniques beyond HyDE.
- `docs/INDUSTRY_CONTEXTUAL_RETRIEVAL_RESEARCH_2026-04-19.md` — verified library adoption research.
- `docs/COMPREHENSIVE_HANDOFF_2026-04-19.md` — this file.

**Updated:**
- `docs/NEXT_SESSION_HANDOFF.md` — Quick-status section prepended with current numbers + honesty rules.
- `docs/PHASE_0_FINDINGS.md` — cost-language updates for same-reader honesty.

### Test state

**agentos-bench: 177/177 pass** (174 pre-existing + 3 readerTopK regression tests; redaction suite counts as 5 of the 174 existing after being added). Build clean (`pnpm build` → no errors).

**agentos core (memory/ingest/SessionSummarizer): 12/12 pass** via `npx vitest run src/memory/ingest` from `packages/agentos/`.

---

## 8. Failed experiments log (preserved in code comments)

Every failed experiment stays documented AT the revert site so the next person doesn't repeat it.

### Reader prompt experiments (v6, v7) — documented inline in `buildFullCognitivePrompt`

- **v6 (rigid `ROLE:` + `FORMAT:` headers + "memory-lookup function, not chat agent" framing):** regressed LongMemEval-S weighted −10pp. Over-constrained gpt-5-mini on synthesis questions. Some answers duplicated their `Answer:` line; multi-session crashed 50%→25%.
- **v7 (presupposition-gated abstention — two-branch rule):** regressed ALL THREE benchmarks. LME-S 83.3%→66.7%, LOCOMO 60%→53%, Oracle 75%→71%. Reader couldn't reliably classify topic-present vs topic-absent.

### Retrieval experiment (Fix A — session-diverse top-K with MAX_CHUNKS_PER_SESSION=3)

Documented inline in `runFullCognitiveCase`. Regressed 24-case smoke 95.8%→79.2%, multi-session 100%→25%. Root cause: Cohere rerank already orders the pool by genuine relevance; displacing rank 1-10 with rank 11-30 from other sessions added noise without adding gold coverage when the answer legitimately lived in 1-2 sessions.

**Cache pollution sub-issue:** When Fix A ran, it did NOT bump `CASE_RUN_SCHEMA_VERSION` so its regressed answers got cached under v7. When Fix A was reverted, the cache was stale. Today's v8 schema bump fixes this. Lesson: code reverts must come with schema bumps when the code path produces different cached outputs.

### Reader K experiment (Option 1 — `--reader-top-k 15` bump)

Just completed. Phase A at K=15: **89.2% unweighted (+3.9pp) BUT 85.9% weighted (−1.2pp vs K=10).** Multi-session target did NOT lift (68.8% → 64.7% at similar sample). Per spec's explicit success criteria, this is a FAILED experiment on the weighted axis and on the multi-session target. **The `--reader-top-k` CLI flag + plumbing stays** (zero cost when unused, enables future sweeps at K=20 etc.). **Default stays at K=10.** The 5 files touched by Option 1 stay wired — removing them would lose valuable infrastructure for Option 2.

---

## 9. Open experiments (what's NEXT)

User's direction: run Options 1 → 2 → 3a → 3b → 3c in sequence, speccing each via `superpowers:brainstorming` before implementation, testing each time to verify improvement.

### ✅ Option 1 — Reader top-K bump (COMPLETE — FAILED criterion)

Results above. Flag + plumbing retained; default unchanged.

### ⏭ Option 2 — Session-level retrieval (NEXT)

**Concept:** instead of retrieving top-K chunks, retrieve top-K **sessions** using the already-generated session summaries as the embedding target. Include top-M chunks from each retrieved session. Guarantees cross-session coverage by construction (can't have a single-session-dominates-the-pool problem like chunk-level retrieval).

**Implementation sketch:**
- New vector collection for session summaries (one embedding per unique session).
- At retrieve time: embed query → search summary collection → top-K=5 sessions → include top-M=3 chunks from each = 15 chunks from 5 distinct sessions.
- Can piggyback on the `--reader-top-k` infrastructure from Option 1.

**Expected payoff:** +8–15pp on multi-session (the 18.4pp gap vs Mastra OM is the target). Published contextual-retrieval literature supports this.

**Build effort:** ~4-6 hours, ~$0.50 smoke cost.

### ⏭ Option 3a — Observer-style in-context (Mastra-equivalent)

**Concept:** skip retrieval; dump all session summaries (or observations) into reader context on every query. Prompt-cached for stable prefix. This IS what Mastra does.

**Trade-off:** closes the architectural asymmetry but changes the cost profile — large stable context (~30k tokens). Cost claims would need to be rewritten.

**Build effort:** ~1 day.

### ⏭ Option 3b — Hybrid BM25 + semantic retrieval (`HybridSearcher` already in agentos)

**Concept:** add lexical BM25 alongside vector search, merge via reciprocal-rank-fusion. AgentOS RAG already has `packages/agentos/src/rag/search/HybridSearcher.ts` — just needs wiring to the bench.

**Why it might help:** catches exact term matches (names, dates, numbers) that pure semantic retrieval misses. Directly attacks LOCOMO adversarial fabrications + knowledge-update specific-value questions.

**Build effort:** ~4-6 hours.

### ⏭ Option 3c — Iterative / agentic retrieval (CRAG-style)

**Concept:** first retrieval + reader pass; if reader emits "need more info" low-confidence signal, generate a refined query and re-retrieve.

**Build effort:** ~6-8 hours.

### Not in the queue: Phase C (gpt-4o reader cell)

Separate concern. Would unlock "our architecture at gpt-4o = $0.022/correct vs agentmemory at gpt-4o = ~$0.03/correct" as a measured (not projected) claim. Cost: ~$60-120 for the full 500-case + 3-benchmark matrix. Run when the blog is close to shipping.

---

## 10. Running benchmarks — exact commands

All commands run from monorepo root: `/Users/johnn/Documents/git/voice-chat-assistant`

**Env setup (required for every command):**
```bash
set -a && source apps/wilds-ai/.env.local && set +a
```

Provides `OPENAI_API_KEY`, `COHERE_API_KEY`, `ANTHROPIC_API_KEY`, `SERPER_API_KEY`, `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`.

### Build + test (always do first)

```bash
cd packages/agentos-bench
pnpm build
pnpm test -- --run
# expected: 177/177 pass
```

### 24-case stratified smoke (LongMemEval-S, ~$0.10, ~5 min warm cache)

```bash
AGENTOS_BENCH_DATA_DIR=packages/agentos-bench/data \
AGENTOS_BENCH_RESULTS_DIR=/tmp/agentos-bench-smoke \
  node packages/agentos-bench/dist/cli.js run longmemeval-s \
  --reader gpt-5-mini --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --sample 24 --stratified --sample-per-type 4 \
  --embedder-model openai:text-embedding-3-small \
  --rerank cohere --rerank-model rerank-v3.5 \
  --context-summary gpt-5-mini \
  --max-usd 3 --concurrency 4
```

Replace `longmemeval-s` with `locomo` / `longmemeval-oracle` for the other two.

### Phase A (102-case stratified, ~$3, ~15-20 min warm cache)

Same command, change `--sample 102 --stratified --sample-per-type 17 --max-usd 10`.

### With `--reader-top-k` (Option 1 flag, available now)

Add `--reader-top-k 15` (or any K ≥ 1). Candidate pool scales as K × rerank.candidateMultiplier.

### Dry-run (no API calls, cheap sanity check)

Add `--dry-run`. Uses `MockReader`. Useful for CLI-plumbing verification.

### Scratch data that survives across runs

- **Session summary cache:** `packages/agentos-bench/data/.session-summary-cache/` (~4,000+ files after today's runs)
- **Embedding cache:** `packages/agentos-bench/data/.embedding-cache/`
- **Case-run cache:** `packages/agentos-bench/data/cache/case-run/` and `case-result/`

Summary + embedding caches are content-addressed by sha256 and survive schema bumps. Case-run cache is invalidated by `CASE_RUN_SCHEMA_VERSION`; current value `v8`.

---

## 11. Feedback memories saved this session

At `~/.claude/projects/-Users-johnn-Documents-git-voice-chat-assistant/memory/`:

- `feedback_use_deep_research_skill.md` — use `Skill` with `deep-research` for web research, not raw curl to Serper/Tavily.
- `feedback_honest_cost_comparisons.md` — never compare cost across different reader models; verify all specific competitor numbers.

Indexed in `memory/MEMORY.md` (always loaded at session start).

---

## 12. The current moment (what to do right now)

**State:** Option 1 failed its success criteria. Code + flag + tests retained. Defaults unchanged. Ready to move to Option 2.

**Pending decision (user's):**
- (A) Keep Option 1 flag infrastructure + default K=10 → move to Option 2 ✅ recommended
- (B) Hard-revert Tasks 5 & 6 (remove resolution lines) → move to Option 2
- (C) Full revert → move to Option 2
- (D) Try K=20 at Phase A before concluding — maybe the effect is non-monotonic

Plus: update docs with Phase A K=15 numbers + correct any lingering 95.8% citations regardless.

---

## 13. Prompt to paste into a new session

Copy-paste the block below into a fresh Claude Code session at the same working directory (`/Users/johnn/Documents/git/voice-chat-assistant/`).

```
Pick up the AgentOS memory benchmark work from packages/agentos-bench/docs/COMPREHENSIVE_HANDOFF_2026-04-19.md.

READ THESE FIRST in order:
1. ~/.claude/CLAUDE.md — global user rules (no em dashes, no AI in commits, no subagents, etc.)
2. ~/.claude/projects/-Users-johnn-Documents-git-voice-chat-assistant/memory/MEMORY.md — per-project memories
3. packages/agentos-bench/docs/COMPREHENSIVE_HANDOFF_2026-04-19.md — this session's complete state
4. packages/agentos-bench/docs/PHASE_A_FINDINGS_2026-04-19.md — Phase A measured numbers
5. packages/agentos-bench/docs/SOTA_RESEARCH_2026-04-19.md — technique research
6. packages/agentos-bench/docs/INDUSTRY_CONTEXTUAL_RETRIEVAL_RESEARCH_2026-04-19.md — library-adoption research
7. packages/agentos/docs/superpowers/specs/2026-04-19-reader-topk-bump-design.md — Option 1 spec (local, gitignored)

CURRENT STATE:
- Production stack: gpt-5-mini reader + gpt-4o judge + Cohere rerank-v3.5 + v9 prompt + contextual retrieval via SessionSummarizer + reader top-K default 10.
- Phase A 102-case LongMemEval-S verified: 85.3% unweighted / 87.1% weighted / $0.0024/correct at gpt-5-mini. Multi-session 68.8%.
- Tests: 177/177 pass (agentos-bench) + 12/12 pass (agentos core SessionSummarizer).
- Option 1 (--reader-top-k bump) complete and FAILED its success criteria (weighted regressed -1.2pp at Phase A K=15, multi-session target didn't move). Flag + plumbing retained; default K=10.
- Cache schema: v8 (bumped today to invalidate Fix-A-era stale cache pollution).

HARD RULES (repeatedly violated earlier — DO NOT violate again):
1. Never claim cost advantage across different reader models. gpt-5-mini cost vs gpt-4o cost is pricing, not architecture. Same-reader cost tables only.
2. Never invent specific competitor numbers. Verify from docs/source or explicitly mark "estimated — not verified." Previously invented "10-18x cheaper" and "15+ Observer calls per session"; both were wrong.
3. Use deep-research skill (not raw curl) for web research.
4. Never commit without explicit user approval.
5. No em dashes in prose. No AI/Claude/Opus in commit messages.
6. No subagents (Agent tool). Do all work directly.
7. Specs + plans in packages/agentos/docs/superpowers/ are gitignored (local-only). Findings in packages/agentos-bench/docs/ are tracked.

NEXT WORK:
The user wants to proceed with Option 2 (session-level retrieval using existing session summaries) using superpowers:brainstorming to spec, then superpowers:writing-plans, then superpowers:executing-plans. Target: multi-session 68.8% → 80%+ at Phase A. Expected build: ~4-6 hours + ~$3 Phase A smoke cost. Full details in COMPREHENSIVE_HANDOFF §9.

Start by: (1) confirming you've read the handoff + user rules, (2) verifying build + tests pass with `cd packages/agentos-bench && pnpm build && pnpm test -- --run` (expect 177/177), (3) invoking superpowers:brainstorming to spec Option 2.
```

---

## 14. Environment verification checklist (new session)

Run these before touching code:

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant

# 1. Check env file has keys
ls apps/wilds-ai/.env.local
grep -c "OPENAI_API_KEY\|COHERE_API_KEY" apps/wilds-ai/.env.local
# expected: 2

# 2. Check sql-storage-adapter dist is present (transient rebuild issue today)
ls packages/sql-storage-adapter/dist/index.js
# expected: file exists

# 3. Build + test agentos-bench
cd packages/agentos-bench
pnpm build 2>&1 | tail -3
pnpm test -- --run 2>&1 | tail -5
# expected: build clean, 177/177 tests pass

# 4. Build agentos core (optional but good hygiene)
cd ../agentos
pnpm build 2>&1 | tail -3
# expected: clean

# 5. Verify datasets downloaded
ls packages/agentos-bench/data/longmemeval/longmemeval_s.json
ls packages/agentos-bench/data/locomo/locomo10.json
# expected: both files present (dataset setup was done in earlier sessions)

# 6. Verify summary cache exists (warm cache saves ~$0.80 per smoke run)
ls packages/agentos-bench/data/.session-summary-cache/ | wc -l
# expected: >= 4000 (~4,191 as of this handoff)
```

If any of these fail, fix before proceeding.

---

## 15. Git hygiene snapshot (as of this handoff)

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git status --short
```

Expected output (roughly):

```
 M apps/wilds-discord-bot/src/knowledge.ts        (other session's work — leave alone)
 m packages/agentos                                (submodule has local commits not yet pushed)
 M packages/agentos-bench/docs/NEXT_SESSION_HANDOFF.md
 M packages/agentos-bench/docs/PHASE_0_FINDINGS.md
 M packages/agentos-bench/src/benchmarks/locomo/Locomo.ts
 M packages/agentos-bench/src/benchmarks/locomo/dataset.ts
 M packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts
 M packages/agentos-bench/src/cli.ts
 M packages/agentos-bench/src/cognitive/createCognitiveManager.ts
 M packages/agentos-bench/src/core/BenchmarkRunner.ts
 M packages/agentos-bench/src/core/IBenchmark.ts
 m packages/agentos-extensions                    (other session)
 M pnpm-lock.yaml                                  (other session)
?? packages/agentos-bench/docs/COMPREHENSIVE_HANDOFF_2026-04-19.md
?? packages/agentos-bench/docs/INDUSTRY_CONTEXTUAL_RETRIEVAL_RESEARCH_2026-04-19.md
?? packages/agentos-bench/docs/PHASE_A_FINDINGS_2026-04-19.md
?? packages/agentos-bench/docs/SOTA_RESEARCH_2026-04-19.md
?? packages/agentos-bench/tests/readerTopK.spec.ts
?? packages/agentos-bench/tests/redactSecretsFromConfig.spec.ts
```

**`packages/agentos/` submodule state (inside that dir):**

```
cd packages/agentos
git status --short
```

Shows:
- `?? src/memory/ingest/SessionSummarizer.ts` (new, gitignored path? no — `src/` is tracked, this is real untracked code)
- `?? src/memory/ingest/__tests__/SessionSummarizer.spec.ts`
- `?? docs/superpowers/specs/2026-04-19-reader-topk-bump-design.md` (gitignored)
- `?? docs/superpowers/plans/2026-04-19-reader-topk-bump.md` (gitignored)
- ` M src/memory/index.ts` (exported SessionSummarizer from the barrel)

**Nothing is committed yet.** When user says "commit X", follow global CLAUDE.md git-hygiene protocol. Submodule pushes go to `framersai/agentos` first, then bump monorepo pointer.

---

End of comprehensive handoff. Good luck to the next session.

Other context from before:

Phase A K=15 results vs K=10 baseline — mixed outcome
Metric	K=10 Phase A	K=15 Phase A	Δ	Verdict
Unweighted accuracy	85.3% (87/102)	89.2% (91/102)	+3.9pp, +4 cases	🟢 up
Weighted accuracy	87.1%	85.9%	−1.2pp	🔴 down
Multi-session (target)	68.8% (11/16)	64.7% (11/17)	same 11 correct, sample differs	⚫ flat
Cost/correct	$0.0024	$0.0032	+33%	🔴 up
Temporal	88.2%	88.2%	0	flat
Preference	94.1%	88.2%	−5.9pp	slight regression
Knowledge-update	94.1%	94.1%	0	held
What actually happened
The target metric didn't move. K=10 caught 11 multi-session cases; K=15 also caught 11. Sample sizes differ (16 vs 17) because the stratified sampler found one more multi-session in the 102 after the unknown artifact in the prior run disappeared — but the absolute count of correct multi-session answers is identical. Widening the reader window did not rescue the gold-session coverage gaps identified in Phase 1.

Unweighted went up 4 cases from small single-digit improvements elsewhere (1 case each in knowledge-update, temporal, preference regions) — but weighted went down 1.2pp because those lifts happen in lower-prior-weight categories while multi-session (26.6% prior) stayed flat.

Cost per correct went up 33% from the bigger prompt (K=15 = 50% more reader input tokens per case).

Plan gates
Per the spec's §Success definition (which was explicit):

❌ Multi-session ≥ 75%: failed (64.7%)
❌ Weighted ≥ 87.1% (no net regression): failed (85.9%)
Per revert criteria: "If weighted accuracy regresses: REVERT (undo Tasks 5 & 6). Document as failed experiment."

My honest recommendation
Don't fully revert — keep the --reader-top-k flag infrastructure but don't change the default. Three reasons:

The flag is Option 2's prerequisite. Session-level retrieval will want to test different per-session chunk counts; the flag is the natural knob.
K=10 stays as default so the production path is unchanged (no behavior regression for anyone not passing --reader-top-k).
Document honestly that K=15 didn't solve multi-session, so the next experiment (Option 2) should target the retrieval layer, not the reader window.
So: keep the code (flag + plumbing + helper + tests) but leave the adapter default at 10. Tasks 5 & 6 already use ctx.config.readerTopK ?? this.opts.recallTopK ?? 10 — that's the right behavior. K=15 only fires when explicitly requested.

Stronger revert option: undo Tasks 5 & 6 too (remove the resolution lines), keep only the test + helper. Cleaner but loses the ability to re-test K values without re-implementing.

Strongest revert option: undo everything back to pre-implementation. Not recommended — the test + helper have independent value.

Want me to:

(A) Keep flag + default K=10 (my recommendation) + document this as failed experiment → move to Option 2
(B) Hard revert Tasks 5 & 6 (remove the resolution lines) → move to Option 2
(C) Full revert → move to Option 2
(D) Try K=20 at Phase A (~$3) before concluding — maybe the effect is non-monotonic
Also need to update docs with these measured numbers regardless of which revert path.

Write COMPREHENSIVE_HANDOFF_2026-04-19.md
522 lines
# Comprehensive Handoff — AgentOS Memory Benchmark, 2026-04-19 (evening)

**Purpose:** everything a fresh Claude Code session needs to pick up this work with zero prior context. Includes mission, verified numbers, architecture, file map, cost honesty, every failed experiment, current open question, and the exact prompt text to paste into a new session.

**Prior handoffs to also read:**
- [NEXT_SESSION_HANDOFF.md](./NEXT_SESSION_HANDOFF.md) — the running session-to-session baton (now partly outdated by this doc)
- [PHASE_A_FINDINGS_2026-04-19.md](./PHASE_A_FINDINGS_2026-04-19.md) — Phase A (102-case) detailed findings
- [PHASE_0_FINDINGS.md](./PHASE_0_FINDINGS.md) — original metrics-framework + signal-ablation findings
- [SOTA_RESEARCH_2026-04-19.md](./SOTA_RESEARCH_2026-04-19.md) — deep research on SOTA techniques
- [INDUSTRY_CONTEXTUAL_RETRIEVAL_RESEARCH_2026-04-19.md](./INDUSTRY_CONTEXTUAL_RETRIEVAL_RESEARCH_2026-04-19.md) — verified library adoption of Anthropic contextual retrieval

---

## 1. Mission

Ship a **citation-backed, honest-numbers blog post** demonstrating AgentOS's cognitive memory layer on public agent-memory benchmarks. Target publications: `apps/agentos-live-docs/blog/` (Docusaurus) AND `apps/agentos.sh/content/blog/` (Astro marketing).

**Three claims the blog should back with numbers**, every claim gated on matched-reader comparison:

1. **Accuracy is competitive** on published benchmarks at matched reader (gpt-5-mini).
2. **Architectural cost advantage** (call counts / tokens at matched reader), not a pricing-tier artifact.
3. **The cognitive-memory layer earns its keep** (signal ablation results — see Phase 0 doc).

**Hard-coded honesty rules (from user, repeated verbatim multiple times):**

- **Never claim cost advantage across different reader models.** gpt-5-mini at $0.25/1M input vs gpt-4o at $2.50/1M is a pricing tier, not architecture. Write same-reader tables only; if the only competitor number is at gpt-4o and we run gpt-5-mini, say "not directly comparable on cost — Phase C gate."
- **Verify every specific number before claiming it.** If the source is "it seemed plausible," rewrite the claim. This session burned two trust breaks by inventing (a) "10-18× cheaper than SOTA" cross-reader and (b) "Mastra fires ~15+ Observer calls per session" un-verified. Both are fixed; feedback memory pinned.

---

## 2. User rules (global CLAUDE.md + session-specific)

Read `~/.claude/CLAUDE.md` + per-project memory at `~/.claude/projects/-Users-johnn-Documents-git-voice-chat-assistant/memory/MEMORY.md`. Highlights relevant to THIS work:

- **No subagents.** Do all work directly, never dispatch the Agent tool.
- **No git worktrees with submodules** (agentos is a submodule).
- **Always `master`** branch, never `main`.
- **No em dashes** in prose — use periods/commas/colons.
- **No AI / Claude / Opus mentions** in commit messages. Write commits as if a human developer wrote them.
- **No "Co-Authored-By: Claude..."** lines.
- **Never commit unless explicitly asked.** In doubt, stage only.
- **Only run targeted tests** — never full suite. In agentos-bench, `cd packages/agentos-bench && pnpm test -- --run` is fine (the package IS the targeted scope).
- **Production builds only** in wilds-ai contexts — don't `next dev`.
- **No local `next build`** — push + CI deploys.
- **Postgres in production**, SQLite only when portability matters.
- **Use `--no-verify`** on monorepo commits if hooks block (secretlint).
- **`docs/superpowers/`** is gitignored in agentos submodule. Plans + specs live there.
- **`packages/agentos-bench/docs/`** is TRACKED — findings docs are public.
- **Use `deep-research` skill for web research** — never raw curl to Serper/Tavily/Firecrawl.

Full memory files at `~/.claude/projects/-Users-johnn-Documents-git-voice-chat-assistant/memory/` — worth skimming on session start.

---

## 3. Repo / packages map

Monorepo root: `/Users/johnn/Documents/git/voice-chat-assistant/`

| Path | Remote | Role |
|---|---|---|
| `packages/agentos/` | `github.com/framersai/agentos` (submodule) | Core cognitive memory library. `CognitiveMemoryManager`, `RerankerService`, `CohereReranker`, `MemoryObserver`, `MemoryReflector`, **`SessionSummarizer`** (Anthropic contextual retrieval, added this session). |
| `packages/agentos-bench/` | monorepo-local (NOT a submodule) | Benchmark harness. LongMemEval, LOCOMO, Oracle adapters + micro-benchmarks. Where almost all this session's work happened. |
| `packages/agentos-extensions/` | `github.com/framersai/agentos-extensions` (submodule) | Agentos ecosystem extensions. Not touched. |
| `packages/sql-storage-adapter/` | `github.com/framersai/sql-storage-adapter` (submodule) | Storage adapter. Not touched by us, but its `dist/index.js` had a transient rebuild gap mid-smoke today; re-verify it's present before running. |
| `apps/wilds-ai/` | `github.com/framersai/wilds-ai` (submodule) | Primary consumer app (game platform). Not touched this session, but `.env.local` holds our `OPENAI_API_KEY`, `COHERE_API_KEY`, `SERPER_API_KEY`, `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`. |
| `apps/paracosm/` | `github.com/framersai/paracosm` (submodule) | Second consumer. Not touched. |
| `apps/agentos-live-docs/` | monorepo-local | Docusaurus docs site. Future blog home. |
| `apps/agentos.sh/` | `github.com/framersai/agentos.sh` (submodule) | Astro marketing site. Future blog home. |

**Submodule push rule (from global CLAUDE.md):** commit in submodule → push submodule → update monorepo pointer. Never `git subtree push`. Never force-push without asking.

---

## 4. Current production state (verified, reproducible)

As of 2026-04-19 evening, `git status` in the monorepo shows agentos-bench changes staged, agentos submodule has `SessionSummarizer` staged on local master but not yet committed.

### Production stack config (what the default CLI invocation uses today)

```
reader: gpt-5-mini (OpenAI)
judge: gpt-4o (OpenAI)
memory mode: full-cognitive
replay mode: ingest
embedder: openai:text-embedding-3-small (1536-dim), CachedEmbedder wrapper for disk cache
rerank: cohere rerank-v3.5 (candidateMultiplier=3 → 30-chunk rerank pool for K=10)
contextual retrieval: session-summary prepend, summarizer=gpt-5-mini, on-disk cache
reader prompt: v9 (latest-wins for knowledge-update + temporal scratchpad + personalization rule for advice + anti-abstention — full comment block in LongMemEvalS.ts `buildFullCognitivePrompt`)
reader top-K: 10 (default; `--reader-top-k N` flag available per this session's Option 1 plumbing)
```

### Verified accuracy numbers

**LongMemEval-S @ gpt-5-mini, Phase A (102 stratified cases):**

| Version | Unweighted | Weighted | Multi-session | Cost/correct |
|---|---:|---:|---:|---:|
| v9 + rerank (no contextual retrieval) | 85.3% | 80.6% | 56.3% (9/16) | $0.0028 |
| v9 + rerank + **contextual retrieval** (current production) | **85.3%** | **87.1%** | **68.8%** (11/16) | **$0.0024** |
| v9 + rerank + contextual retrieval + **K=15** (Option 1 Phase A this session) | 89.2% | 85.9% | 64.7% (11/17) | $0.0032 |

**Smoke cells at 24 cases (high variance, directional only):**

| Benchmark | N | Unweighted | Cost/correct | Notes |
|---|---:|---:|---:|---|
| LongMemEval-Oracle | 24 | 79.2% | $0.0027 | Pre-ctx retrieval smoke |
| LOCOMO | 30 | 60.0% (v5) / 63.3% (v8) / 53.3% (v9) | $0.0012–0.0016 | Known judge-inconsistency issue on adversarial (17%) |
| LME-S at K=10 fresh-cache (today) | 24 | 79.2% | $0.0037 | Confirms ±10pp N=24 variance |
| LME-S at K=15 (today smoke) | 24 | 83.3% | $0.0044 | K=15 on same sample, multi-session didn't move |

### The 95.8% number I was previously citing

**Retracted.** It was an N=24 lucky-variance outcome at an early v9+ctx smoke. Phase A at N=102 shows the real baseline is 85.3% unweighted / 87.1% weighted. At N=24 variance per category is ±10pp — a 4-of-4 sweep in 4-5 categories gave the lucky 95.8%. Today's fresh-cache K=10 re-run produced 79.2% at the same config — the unlucky end of the same variance window.

**Rule for future:** report Phase A numbers as the accuracy signal. Smoke results are directional at best.

---

## 5. Cost matrix — same architecture, variable reader

From measured token counts on the 24-case v9+ctx run: **175,283 reader-in + 2,947 reader-out tokens** across 24 cases.

Same architecture, same chunking, same prompt, same rerank — only the reader price changes:

| Reader | Input $/M | Output $/M | Reader cost / 24 cases | Reader cost / correct |
|---|---:|---:|---:|---:|
| **gpt-5-mini** (our actual cell) | $0.25 | $2.00 | $0.050 | **$0.00216** |
| claude-haiku-4-5 (projected) | $0.80 | $4.00 | $0.152 | $0.00661 |
| gpt-4o (projected) | $2.50 | $10.00 | $0.468 | $0.02033 |
| claude-sonnet-4-6 (projected) | $3.00 | $15.00 | $0.570 | $0.02478 |

All-in (reader + judge gpt-4o + embedding + rerank + summary, amortized warm-cache):

| Reader | All-in $/correct |
|---|---:|
| gpt-5-mini | **~$0.003** |
| claude-haiku-4-5 | ~$0.008 |
| gpt-4o | ~$0.022 |
| claude-sonnet-4-6 | ~$0.026 |

**Rule:** compare $/correct only at same reader. Cross-reader ratios are pricing artifacts.

---

## 6. Verified competitor numbers (Mastra OM as primary comparable)

**Mastra Observational Memory architecture** (verified from [docs](https://mastra.ai/docs/memory/observational-memory) + [workshop repo](https://github.com/mastra-ai/mastra-observational-memory-workshop)):

- Observer fires when **unprocessed messages hit 30,000 tokens** (threshold)
- Reflector fires when **observations hit 40,000 tokens** (threshold)
- For a 115k-token LongMemEval case, that's **~4 Observer calls + 1-2 Reflector calls = ~5-6 ingest LLM calls per case**
- Default summarizer/observer model: `google/gemini-2.5-flash`
- Reader context: ~30k tokens stable prefix + live messages, prompt-cached

**Mastra OM published LongMemEval-S results** (from [mastra.ai/research/observational-memory](https://mastra.ai/research/observational-memory)):

| Model | Overall | Multi-session | Temporal | Preference | Knowledge-update |
|---|---:|---:|---:|---:|---:|
| gpt-5-mini | **94.87%** | 87.2% | 95.5% | 100.0% | 96.2% |
| gemini-3-pro-preview | 93.27% | — | — | — | — |
| gpt-4o | 84.23% | 79.7% | 85.7% | 73.3% | 85.9% |

**Our AgentOS numbers at gpt-5-mini (Phase A v9+rerank+contextual retrieval):**

| Metric | AgentOS | Mastra OM | Gap |
|---|---:|---:|---:|
| Overall | 85.3% | 94.87% | −9.6pp |
| Weighted | 87.1% | — | — |
| Multi-session | **68.8%** | **87.2%** | **−18.4pp** ← dominant remaining gap |
| Temporal | 88.2% | 95.5% | −7.3 |
| Preference | 94.1% | 100% | −5.9 |
| Knowledge-update | 94.1% | 96.2% | −2.1 |

**Call-count comparison at matched reader (architectural, not pricing):** AgentOS amortizes ~4 ingest LLM calls per case across a 500-case sweep (one summary per unique session, content-addressed cache). Mastra OM: ~5-6 per case (no cross-case cache as far as we know). Ratio: **~1.5× fewer calls for AgentOS**, NOT an order of magnitude.

**LOCOMO public leaderboard** (from [dev.to compilation](https://dev.to/varun_pratapbhardwaj_b13/5-ai-agent-memory-systems-compared-mem0-zep-letta-supermemory-superlocalmemory-2026-benchmark-59p3)):

| System | Score | Reader required |
|---|---:|---|
| EverMemOS | 92.3% | cloud |
| MemMachine | 91.7% | cloud |
| Hindsight | 89.6% | cloud |
| Zep | ~85% | cloud |
| Letta/MemGPT | ~83.2% | cloud |
| Supermemory | ~70% | cloud |
| Mem0 (independent measurement) | ~58% | cloud |
| **AgentOS (our smoke N=30 @ gpt-5-mini, v9+ctx+rerank)** | **53.3%** | gpt-5-mini |

LOCOMO has a known adversarial-category judge-inconsistency problem (Mastra declines to publish LOCOMO because of it).

---

## 7. Complete file change inventory (this session)

### In `packages/agentos/` (core — gitignored specs + one real code change)

**New file (not yet committed to `framersai/agentos`):**
- `src/memory/ingest/SessionSummarizer.ts` — LLM-backed session-level contextual retrieval (Anthropic Sep 2024 variant, session-granularity). Content-addressed disk cache. Exported from `packages/agentos/src/memory/index.ts` as `SessionSummarizer`, `SessionSummarizerInvoker`, `SessionSummarizerOptions`, `SummarizerStats`.
- `src/memory/ingest/__tests__/SessionSummarizer.spec.ts` — 12 unit tests (cache hit/miss, disk persistence, cache invalidation on model/template change, content-addressed, concurrency safety).

**Gitignored under `docs/superpowers/` (local-only, not pushed):**
- `specs/2026-04-19-reader-topk-bump-design.md` — Option 1 design spec
- `plans/2026-04-19-reader-topk-bump.md` — Option 1 implementation plan

### In `packages/agentos-bench/` (tracked)

**Modified:**
- `src/core/IBenchmark.ts` — added `RunConfig.rerank`, `RunConfig.contextSummaryModel`, `RunConfig.readerTopK`. Matching `BenchContext['config']` Pick/Omit updates.
- `src/core/BenchmarkRunner.ts` — `redactSecretsFromConfig`, `computeCaseRunKeyParts` (extracted helper, exported for tests), `CaseKeyContext` interface, `CASE_RUN_SCHEMA_VERSION = 'v8'` (module-level).
- `src/cli.ts` — flags: `--rerank cohere`, `--rerank-model`, `--rerank-api-key`, `--rerank-candidate-multiplier`, `--context-summary <model>`, `--reader-top-k N`. `parsePositiveInteger` validator. Constructs `SessionSummarizer` from `@framers/agentos/memory` and passes to adapters.
- `src/cognitive/createCognitiveManager.ts` — accepts Cohere reranker config; constructs `RerankerService` + `CohereReranker` provider; passes to `CognitiveMemoryManager.initialize` via `rerankerService`.
- `src/benchmarks/longmemeval/LongMemEvalS.ts` — rerank wiring, candidate-pool expansion (3× multiplier when rerank active), RETRIEVAL_SCORE_MIN_RERANKED=0.1, session-summary prepend in `replayForCognitive` (both `observe` and `ingest` paths), v9 reader prompt with detailed failed-experiment log (v6, v7, Fix A, session-diverse top-K revert notes), `sessionSummarizer` adapter option, `readerTopK` resolution priority.
- `src/benchmarks/longmemeval/index.ts` — unchanged; `LongMemEvalM` / `LongMemEvalOracle` inherit all new behavior transparently.
- `src/benchmarks/locomo/Locomo.ts` — stratified sampling, dataset schema fix for `number` answer, `sessionSummarizer` option, `readerTopK` resolution priority.
- `src/benchmarks/locomo/dataset.ts` — accept `z.number()` in QA answer union.

**New files:**
- `tests/redactSecretsFromConfig.spec.ts` — 5 tests pinning API-key redaction invariants.
- `tests/readerTopK.spec.ts` — 3 tests pinning readerTopK propagation + conditional cache-key append + backwards-compat length pin.
- `docs/PHASE_A_FINDINGS_2026-04-19.md` — Phase A detailed findings (v9+rerank+ctx baseline + same-arch cost matrix).
- `docs/SOTA_RESEARCH_2026-04-19.md` — deep research on SOTA RAG techniques beyond HyDE.
- `docs/INDUSTRY_CONTEXTUAL_RETRIEVAL_RESEARCH_2026-04-19.md` — verified library adoption research.
- `docs/COMPREHENSIVE_HANDOFF_2026-04-19.md` — this file.

**Updated:**
- `docs/NEXT_SESSION_HANDOFF.md` — Quick-status section prepended with current numbers + honesty rules.
- `docs/PHASE_0_FINDINGS.md` — cost-language updates for same-reader honesty.

### Test state

**agentos-bench: 177/177 pass** (174 pre-existing + 3 readerTopK regression tests; redaction suite counts as 5 of the 174 existing after being added). Build clean (`pnpm build` → no errors).

**agentos core (memory/ingest/SessionSummarizer): 12/12 pass** via `npx vitest run src/memory/ingest` from `packages/agentos/`.

---

## 8. Failed experiments log (preserved in code comments)

Every failed experiment stays documented AT the revert site so the next person doesn't repeat it.

### Reader prompt experiments (v6, v7) — documented inline in `buildFullCognitivePrompt`

- **v6 (rigid `ROLE:` + `FORMAT:` headers + "memory-lookup function, not chat agent" framing):** regressed LongMemEval-S weighted −10pp. Over-constrained gpt-5-mini on synthesis questions. Some answers duplicated their `Answer:` line; multi-session crashed 50%→25%.
- **v7 (presupposition-gated abstention — two-branch rule):** regressed ALL THREE benchmarks. LME-S 83.3%→66.7%, LOCOMO 60%→53%, Oracle 75%→71%. Reader couldn't reliably classify topic-present vs topic-absent.

### Retrieval experiment (Fix A — session-diverse top-K with MAX_CHUNKS_PER_SESSION=3)

Documented inline in `runFullCognitiveCase`. Regressed 24-case smoke 95.8%→79.2%, multi-session 100%→25%. Root cause: Cohere rerank already orders the pool by genuine relevance; displacing rank 1-10 with rank 11-30 from other sessions added noise without adding gold coverage when the answer legitimately lived in 1-2 sessions.

**Cache pollution sub-issue:** When Fix A ran, it did NOT bump `CASE_RUN_SCHEMA_VERSION` so its regressed answers got cached under v7. When Fix A was reverted, the cache was stale. Today's v8 schema bump fixes this. Lesson: code reverts must come with schema bumps when the code path produces different cached outputs.

### Reader K experiment (Option 1 — `--reader-top-k 15` bump)

Just completed. Phase A at K=15: **89.2% unweighted (+3.9pp) BUT 85.9% weighted (−1.2pp vs K=10).** Multi-session target did NOT lift (68.8% → 64.7% at similar sample). Per spec's explicit success criteria, this is a FAILED experiment on the weighted axis and on the multi-session target. **The `--reader-top-k` CLI flag + plumbing stays** (zero cost when unused, enables future sweeps at K=20 etc.). **Default stays at K=10.** The 5 files touched by Option 1 stay wired — removing them would lose valuable infrastructure for Option 2.

---

## 9. Open experiments (what's NEXT)

User's direction: run Options 1 → 2 → 3a → 3b → 3c in sequence, speccing each via `superpowers:brainstorming` before implementation, testing each time to verify improvement.

### ✅ Option 1 — Reader top-K bump (COMPLETE — FAILED criterion)

Results above. Flag + plumbing retained; default unchanged.

### ⏭ Option 2 — Session-level retrieval (NEXT)

**Concept:** instead of retrieving top-K chunks, retrieve top-K **sessions** using the already-generated session summaries as the embedding target. Include top-M chunks from each retrieved session. Guarantees cross-session coverage by construction (can't have a single-session-dominates-the-pool problem like chunk-level retrieval).

**Implementation sketch:**
- New vector collection for session summaries (one embedding per unique session).
- At retrieve time: embed query → search summary collection → top-K=5 sessions → include top-M=3 chunks from each = 15 chunks from 5 distinct sessions.
- Can piggyback on the `--reader-top-k` infrastructure from Option 1.

**Expected payoff:** +8–15pp on multi-session (the 18.4pp gap vs Mastra OM is the target). Published contextual-retrieval literature supports this.

**Build effort:** ~4-6 hours, ~$0.50 smoke cost.

### ⏭ Option 3a — Observer-style in-context (Mastra-equivalent)

**Concept:** skip retrieval; dump all session summaries (or observations) into reader context on every query. Prompt-cached for stable prefix. This IS what Mastra does.

**Trade-off:** closes the architectural asymmetry but changes the cost profile — large stable context (~30k tokens). Cost claims would need to be rewritten.

**Build effort:** ~1 day.

### ⏭ Option 3b — Hybrid BM25 + semantic retrieval (`HybridSearcher` already in agentos)

**Concept:** add lexical BM25 alongside vector search, merge via reciprocal-rank-fusion. AgentOS RAG already has `packages/agentos/src/rag/search/HybridSearcher.ts` — just needs wiring to the bench.

**Why it might help:** catches exact term matches (names, dates, numbers) that pure semantic retrieval misses. Directly attacks LOCOMO adversarial fabrications + knowledge-update specific-value questions.

**Build effort:** ~4-6 hours.

### ⏭ Option 3c — Iterative / agentic retrieval (CRAG-style)

**Concept:** first retrieval + reader pass; if reader emits "need more info" low-confidence signal, generate a refined query and re-retrieve.

**Build effort:** ~6-8 hours.

### Not in the queue: Phase C (gpt-4o reader cell)

Separate concern. Would unlock "our architecture at gpt-4o = $0.022/correct vs agentmemory at gpt-4o = ~$0.03/correct" as a measured (not projected) claim. Cost: ~$60-120 for the full 500-case + 3-benchmark matrix. Run when the blog is close to shipping.

---

## 10. Running benchmarks — exact commands

All commands run from monorepo root: `/Users/johnn/Documents/git/voice-chat-assistant`

**Env setup (required for every command):**
```bash
set -a && source apps/wilds-ai/.env.local && set +a
```

Provides `OPENAI_API_KEY`, `COHERE_API_KEY`, `ANTHROPIC_API_KEY`, `SERPER_API_KEY`, `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`.

### Build + test (always do first)

```bash
cd packages/agentos-bench
pnpm build
pnpm test -- --run
# expected: 177/177 pass
```

### 24-case stratified smoke (LongMemEval-S, ~$0.10, ~5 min warm cache)

```bash
AGENTOS_BENCH_DATA_DIR=packages/agentos-bench/data \
AGENTOS_BENCH_RESULTS_DIR=/tmp/agentos-bench-smoke \
  node packages/agentos-bench/dist/cli.js run longmemeval-s \
  --reader gpt-5-mini --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --sample 24 --stratified --sample-per-type 4 \
  --embedder-model openai:text-embedding-3-small \
  --rerank cohere --rerank-model rerank-v3.5 \
  --context-summary gpt-5-mini \
  --max-usd 3 --concurrency 4
```

Replace `longmemeval-s` with `locomo` / `longmemeval-oracle` for the other two.

### Phase A (102-case stratified, ~$3, ~15-20 min warm cache)

Same command, change `--sample 102 --stratified --sample-per-type 17 --max-usd 10`.

### With `--reader-top-k` (Option 1 flag, available now)

Add `--reader-top-k 15` (or any K ≥ 1). Candidate pool scales as K × rerank.candidateMultiplier.

### Dry-run (no API calls, cheap sanity check)

Add `--dry-run`. Uses `MockReader`. Useful for CLI-plumbing verification.

### Scratch data that survives across runs

- **Session summary cache:** `packages/agentos-bench/data/.session-summary-cache/` (~4,000+ files after today's runs)
- **Embedding cache:** `packages/agentos-bench/data/.embedding-cache/`
- **Case-run cache:** `packages/agentos-bench/data/cache/case-run/` and `case-result/`

Summary + embedding caches are content-addressed by sha256 and survive schema bumps. Case-run cache is invalidated by `CASE_RUN_SCHEMA_VERSION`; current value `v8`.

---

## 11. Feedback memories saved this session

At `~/.claude/projects/-Users-johnn-Documents-git-voice-chat-assistant/memory/`:

- `feedback_use_deep_research_skill.md` — use `Skill` with `deep-research` for web research, not raw curl to Serper/Tavily.
- `feedback_honest_cost_comparisons.md` — never compare cost across different reader models; verify all specific competitor numbers.

Indexed in `memory/MEMORY.md` (always loaded at session start).

---

## 12. The current moment (what to do right now)

**State:** Option 1 failed its success criteria. Code + flag + tests retained. Defaults unchanged. Ready to move to Option 2.

**Pending decision (user's):**
- (A) Keep Option 1 flag infrastructure + default K=10 → move to Option 2 ✅ recommended
- (B) Hard-revert Tasks 5 & 6 (remove resolution lines) → move to Option 2
- (C) Full revert → move to Option 2
- (D) Try K=20 at Phase A before concluding — maybe the effect is non-monotonic

Plus: update docs with Phase A K=15 numbers + correct any lingering 95.8% citations regardless.

---

## 13. Prompt to paste into a new session

Copy-paste the block below into a fresh Claude Code session at the same working directory (`/Users/johnn/Documents/git/voice-chat-assistant/`).

```
Pick up the AgentOS memory benchmark work from packages/agentos-bench/docs/COMPREHENSIVE_HANDOFF_2026-04-19.md.

READ THESE FIRST in order:
1. ~/.claude/CLAUDE.md — global user rules (no em dashes, no AI in commits, no subagents, etc.)
2. ~/.claude/projects/-Users-johnn-Documents-git-voice-chat-assistant/memory/MEMORY.md — per-project memories
3. packages/agentos-bench/docs/COMPREHENSIVE_HANDOFF_2026-04-19.md — this session's complete state
4. packages/agentos-bench/docs/PHASE_A_FINDINGS_2026-04-19.md — Phase A measured numbers
5. packages/agentos-bench/docs/SOTA_RESEARCH_2026-04-19.md — technique research
6. packages/agentos-bench/docs/INDUSTRY_CONTEXTUAL_RETRIEVAL_RESEARCH_2026-04-19.md — library-adoption research
7. packages/agentos/docs/superpowers/specs/2026-04-19-reader-topk-bump-design.md — Option 1 spec (local, gitignored)

CURRENT STATE:
- Production stack: gpt-5-mini reader + gpt-4o judge + Cohere rerank-v3.5 + v9 prompt + contextual retrieval via SessionSummarizer + reader top-K default 10.
- Phase A 102-case LongMemEval-S verified: 85.3% unweighted / 87.1% weighted / $0.0024/correct at gpt-5-mini. Multi-session 68.8%.
- Tests: 177/177 pass (agentos-bench) + 12/12 pass (agentos core SessionSummarizer).
- Option 1 (--reader-top-k bump) complete and FAILED its success criteria (weighted regressed -1.2pp at Phase A K=15, multi-session target didn't move). Flag + plumbing retained; default K=10.
- Cache schema: v8 (bumped today to invalidate Fix-A-era stale cache pollution).

HARD RULES (repeatedly violated earlier — DO NOT violate again):
1. Never claim cost advantage across different reader models. gpt-5-mini cost vs gpt-4o cost is pricing, not architecture. Same-reader cost tables only.
2. Never invent specific competitor numbers. Verify from docs/source or explicitly mark "estimated — not verified." Previously invented "10-18x cheaper" and "15+ Observer calls per session"; both were wrong.
3. Use deep-research skill (not raw curl) for web research.
4. Never commit without explicit user approval.
5. No em dashes in prose. No AI/Claude/Opus in commit messages.
6. No subagents (Agent tool). Do all work directly.
7. Specs + plans in packages/agentos/docs/superpowers/ are gitignored (local-only). Findings in packages/agentos-bench/docs/ are tracked.

NEXT WORK:
The user wants to proceed with Option 2 (session-level retrieval using existing session summaries) using superpowers:brainstorming to spec, then superpowers:writing-plans, then superpowers:executing-plans. Target: multi-session 68.8% → 80%+ at Phase A. Expected build: ~4-6 hours + ~$3 Phase A smoke cost. Full details in COMPREHENSIVE_HANDOFF §9.

Start by: (1) confirming you've read the handoff + user rules, (2) verifying build + tests pass with `cd packages/agentos-bench && pnpm build && pnpm test -- --run` (expect 177/177), (3) invoking superpowers:brainstorming to spec Option 2.
```

---

## 14. Environment verification checklist (new session)

Run these before touching code:

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant

# 1. Check env file has keys
ls apps/wilds-ai/.env.local
grep -c "OPENAI_API_KEY\|COHERE_API_KEY" apps/wilds-ai/.env.local
# expected: 2

# 2. Check sql-storage-adapter dist is present (transient rebuild issue today)
ls packages/sql-storage-adapter/dist/index.js
# expected: file exists

# 3. Build + test agentos-bench
cd packages/agentos-bench
pnpm build 2>&1 | tail -3
pnpm test -- --run 2>&1 | tail -5
# expected: build clean, 177/177 tests pass

# 4. Build agentos core (optional but good hygiene)
cd ../agentos
pnpm build 2>&1 | tail -3
# expected: clean

# 5. Verify datasets downloaded
ls packages/agentos-bench/data/longmemeval/longmemeval_s.json
ls packages/agentos-bench/data/locomo/locomo10.json
# expected: both files present (dataset setup was done in earlier sessions)

# 6. Verify summary cache exists (warm cache saves ~$0.80 per smoke run)
ls packages/agentos-bench/data/.session-summary-cache/ | wc -l
# expected: >= 4000 (~4,191 as of this handoff)
```

If any of these fail, fix before proceeding.

---

## 15. Git hygiene snapshot (as of this handoff)

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git status --short
```

Expected output (roughly):

```
 M apps/wilds-discord-bot/src/knowledge.ts        (other session's work — leave alone)
 m packages/agentos                                (submodule has local commits not yet pushed)
 M packages/agentos-bench/docs/NEXT_SESSION_HANDOFF.md
 M packages/agentos-bench/docs/PHASE_0_FINDINGS.md
 M packages/agentos-bench/src/benchmarks/locomo/Locomo.ts
 M packages/agentos-bench/src/benchmarks/locomo/dataset.ts
 M packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts
 M packages/agentos-bench/src/cli.ts
 M packages/agentos-bench/src/cognitive/createCognitiveManager.ts
 M packages/agentos-bench/src/core/BenchmarkRunner.ts
 M packages/agentos-bench/src/core/IBenchmark.ts
 m packages/agentos-extensions                    (other session)
 M pnpm-lock.yaml                                  (other session)
?? packages/agentos-bench/docs/COMPREHENSIVE_HANDOFF_2026-04-19.md
?? packages/agentos-bench/docs/INDUSTRY_CONTEXTUAL_RETRIEVAL_RESEARCH_2026-04-19.md
?? packages/agentos-bench/docs/PHASE_A_FINDINGS_2026-04-19.md
?? packages/agentos-bench/docs/SOTA_RESEARCH_2026-04-19.md
?? packages/agentos-bench/tests/readerTopK.spec.ts
?? packages/agentos-bench/tests/redactSecretsFromConfig.spec.ts
```

**`packages/agentos/` submodule state (inside that dir):**

```
cd packages/agentos
git status --short
```

Shows:
- `?? src/memory/ingest/SessionSummarizer.ts` (new, gitignored path? no — `src/` is tracked, this is real untracked code)
- `?? src/memory/ingest/__tests__/SessionSummarizer.spec.ts`
- `?? docs/superpowers/specs/2026-04-19-reader-topk-bump-design.md` (gitignored)
- `?? docs/superpowers/plans/2026-04-19-reader-topk-bump.md` (gitignored)
- ` M src/memory/index.ts` (exported SessionSummarizer from the barrel)

**Nothing is committed yet.** When user says "commit X", follow global CLAUDE.md git-hygiene protocol. Submodule pushes go to `framersai/agentos` first, then bump monorepo pointer.

---

End of comprehensive handoff. Good luck to the next session.
Update Todos

Tasks 1-6 implementation complete (177/177 pass)

Task 7: K=10 baseline fresh-cache = 79.2% at N=24 (consistent with Phase A 85.3% given N=24 variance)

Task 8: K=15 on same 24 cases = 83.3% (+4.1pp overall, multi-session flat at N=4)

Task 9: Phase A 102-case at K=15 = 89.2% unweighted / 85.9% weighted. Multi-session 64.7% (target NOT lifted). FAILED spec's success criteria.

Comprehensive handoff doc written at packages/agentos-bench/docs/COMPREHENSIVE_HANDOFF_2026-04-19.md with verified numbers + all failed experiments + ready-to-paste prompt for new session

Awaiting user direction: A) keep flag+default K=10 → Option 2, B) hard-revert → Option 2, C) full revert → Option 2, D) try K=20 before concluding
