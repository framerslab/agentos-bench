# Mastra Observational Memory — vendor reproduction adapter

This directory wraps Mastra's open-source [`@mastra/memory` `ObservationalMemory` processor](https://github.com/mastra-ai/mastra/tree/main/packages/memory/src/processors/observational-memory) with per-case cost + latency instrumentation, runs it against the same `data/longmemeval-s/longmemeval_s.json` dataset agentos-bench uses, scores it with the same `gpt-4o-2024-08-06` LongMemEval upstream judge, and outputs run JSON in the agentos-bench shape so the LEADERBOARD/comparison-table can pick it up.

## Why this exists

The v1 LongMemEval-S publication claims that AgentOS canonical-hybrid + reader router (85.6% [82.4%, 88.6%]) beats Mastra OM's published 84.2% gpt-4o number by +1.4 pp at the same gpt-4o-class reader. The Mastra 84.2% number is published in [their research blog](https://mastra.ai/research/observational-memory) (Tyler Barnes, Feb 2026) but they do not publish a confidence interval, $/correct, or per-case latency. To make the comparison fully apples-to-apples we re-run their pipeline ourselves on the same dataset, with the same judge, capturing the cost + latency proxies they don't publish.

This is the second vendor reproduction adapter in agentos-bench. The first is `vendors/emergence-simple-fast/` for EmergenceMem; this one is for Mastra Observational Memory.

## What's apples-to-apples

When this adapter runs alongside the AgentOS canonical+RR run:

- **Same dataset.** `data/longmemeval-s/longmemeval_s.json`, 500 cases. Mastra's bench downloads the same upstream HuggingFace dataset; we point the adapter at our local copy so dataset divergence is impossible.
- **Same judge model + rubric.** `gpt-4o-2024-08-06` with the LongMemEval upstream rubric. agentos-bench's `LongMemEvalJudge` consumes the verbatim upstream prompt template; Mastra's bench produces a `hypothesis` per case which we feed into our judge.
- **Same cost tracking.** Both the OM ingest and the answer-call capture `prompt_tokens` + `completion_tokens` from the OpenAI `response.usage` field (no estimates, no token-counter approximations). Per-token pricing matches the agentos-bench `MODEL_PRICES` table (OpenAI public pricing as of 2026-04-28).
- **Same wall-clock latency capture.** Per-case `Date.now()` deltas around each LLM call.

## What's NOT apples-to-apples

Inline caveats; documented in the run JSON `config` block too.

- **Observer / Reflector model deviation.** Mastra's published 84.2% gpt-4o headline used `gemini-2.5-flash` for the Observer/Reflector subagents (per their research page: *"In each configuration, gemini-2.5-flash ingested the data into OM as it's the default model for observation/reflection currently."*). agentos-bench is single-provider OpenAI by design (Cohere allowed only at the rerank stage); our adapter overrides Mastra's default to use `gpt-5-mini` for Observer + Reflector instead. This produces a number that's NOT directly comparable to Mastra's 84.2% — it's "Mastra OM with the observer also moved to OpenAI." Documented as such on the run JSON metadata.
- **Storage / vector backend deviation.** Mastra's bench uses `@mastra/libsql` for storage and `imvectordb` for vectors. Our adapter mirrors that. (Same as their bench, not a deviation.)
- **No retrieval comparison.** Mastra's OM is a pure-context architecture: full observation log goes into every reader call, no per-query retrieval. The retrieval/recall metrics agentos-bench captures (`recall@K`, `NDCG@K`, etc.) don't apply on this side.

## Files

- `package.json` — declares deps on `@mastra/core`, `@mastra/memory`, `@mastra/libsql`, `@ai-sdk/openai`, plus the Vercel AI SDK runtime.
- `bench-mastra-om.ts` — the adapter. Loads the LongMemEval-S dataset, replays each case's haystack sessions through `ObservationalMemory`, asks the question with the observation log in context, captures cost + latency per case, writes run JSON in agentos-bench shape.
- `run-mastra-om.sh` — wrapper: installs deps on first run, sets env, dispatches `tsx bench-mastra-om.ts`, writes run JSON to `results/runs/<timestamp>--longmemeval-s--mastra-om--gpt-4o.json`.

## Reproducing

```bash
cd packages/agentos-bench/vendors/mastra-om

# Install deps (~30s)
pnpm install

# Set OPENAI_API_KEY in env (Cohere not used on this side; gemini also not used in our config)
export OPENAI_API_KEY=sk-...

# Run Phase A (54 cases stratified)
./run-mastra-om.sh --sample-per-type 9

# Run Phase B (full N=500)
./run-mastra-om.sh
```

## Comparison context

| Configuration | Aggregate | Reader | Observer/Reflector | Source |
|---|---:|---|---|---|
| **AgentOS canonical+RR (Phase B N=500)** | **85.6% [82.4%, 88.6%]** | gpt-4o (TR/SSU) + gpt-5-mini (else) via reader-router | n/a (pure retrieval) | results/runs/2026-04-28T19-06-42-271 |
| Mastra OM (their published) | 84.2% (no CI published) | gpt-4o | gemini-2.5-flash | mastra.ai/research/observational-memory |
| Mastra OM (their published) | 94.9% (no CI published) | gpt-5-mini | gemini-2.5-flash | mastra.ai/research/observational-memory |
| Mastra OM (this adapter, OpenAI single-provider) | TBD Phase B | gpt-4o | gpt-5-mini | this adapter |

The cost/latency comparison vs Mastra's published numbers is unmeasurable because Mastra does not publish $/correct or per-case latency.
