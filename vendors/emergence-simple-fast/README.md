# EmergenceMem Simple Fast — vendor reproduction adapter

This directory wraps the open-source [`EmergenceAI/emergence_simple_fast`](https://github.com/EmergenceAI/emergence_simple_fast) reference implementation with per-case cost + latency instrumentation, and outputs run JSON in the same shape as `agentos-bench`'s own runs so the two can be directly compared in the LEADERBOARD.

## Why this exists

The v1 LongMemEval-S publication claimed that AgentOS canonical-hybrid + reader router (85.6% [82.4%, 88.6%]) is roughly 2-3× cheaper per correct than EmergenceMem Internal (86.0%). That claim was *inferred* from three measurable proxies (1.6× faster median latency, 53% gpt-5-mini reader dispatch, 2 vs 2-3 LLM calls per case) but **not directly measured**. EmergenceMem's Internal model is closed-source so cost-per-correct on the 86% number cannot be measured directly — but their **Simple Fast** open-source variant (79% accuracy at 3.59 s/item median) is fully measurable. Wiring their reference implementation into our cost/latency harness gives us at least one apples-to-apples vendor reproduction in the matrix.

## What's apples-to-apples

When this adapter runs alongside the AgentOS bench:

- **Same dataset** — `data/longmemeval_s.json`, 500 cases.
- **Same judge model + rubric** — `gpt-4o-2024-08-06`. (EmergenceMem's reference repo uses the same upstream judge; the prompt template in their repo is byte-identical to the LongMemEval upstream judge prompts and is the same one our `LongMemEvalJudge` consumes.)
- **Same cost-tracking instrumentation** — both runs capture `prompt_tokens` + `completion_tokens` per LLM call from `response.usage` and apply the same per-token pricing (OpenAI public pricing as of 2026-04-28, `gpt-4o = $2.50/$10` per 1M input/output, `gpt-5-mini = $0.20/$0.80`).
- **Same wall-clock latency measurement** — both runs use `time.perf_counter()` per case for the question-processing phase (haystack pre-processing time excluded, matching EmergenceMem's published methodology).

What's NOT apples-to-apples (caveats inline):

- **Different embedder**. EmergenceMem uses `sentence-transformers/all-MiniLM-L6-v2` (local, GPU-accelerated when available); AgentOS uses `text-embedding-3-small` (OpenAI API, billable). EmergenceMem's local-embedding latency depends on local GPU; ours doesn't. We report both: latency tagged with `(local-embed)` for EmergenceMem and `(OpenAI-embed)` for AgentOS.
- **Different retrieval grain**. EmergenceMem retrieves turn-level (top-K=42 turns); AgentOS retrieves chunk-level (top-K=20 chunks via Cohere rerank + BM25 + dense RRF). Both produce a context window for the reader — different routes to the same end.
- **No reranker on EmergenceMem Simple Fast**. AgentOS uses Cohere rerank-v3.5 ($1/1M tokens, billed). The `$/correct` comparison includes the Cohere fee on the AgentOS side; EmergenceMem has no equivalent.
- **EmergenceMem Simple Fast accuracy is 79%** (or 76.75% at top-K=20). It's NOT the same model as their Internal 86% claim. The 86% Internal number is closed-source; this adapter cannot reproduce it.

## Files

- `main_instrumented.py` — fork of EmergenceMem's `main.py` with per-case cost + latency capture, structured JSON output. **Their algorithm is unchanged** — we only add instrumentation around their LLM calls.
- `requirements.txt` — Python deps (sentence-transformers, openai, numpy, tqdm). Mirrors their upstream.
- `run-emergence-simple-fast.sh` — wrapper that activates a Python venv, runs the instrumented script against `data/longmemeval_s.json`, and writes a run JSON to `results/runs/<timestamp>--longmemeval-s--emergence-simple-fast.json`.

## Reproducing

```bash
# Set up Python venv
cd packages/agentos-bench/vendors/emergence-simple-fast
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Set OPENAI_API_KEY in env
export OPENAI_API_KEY=sk-...

# Drop the LongMemEval-S dataset into the bench's data dir (same path agentos-bench uses)
ls ../../data/longmemeval-s/longmemeval_s.json

# Run
python main_instrumented.py \
  --dataset ../../data/longmemeval-s/longmemeval_s.json \
  --top-k 42 \
  --output ../../results/runs/$(date -u +%Y-%m-%dT%H-%M-%S-%3N)--longmemeval-s--emergence-simple-fast.json

# Output run JSON has the same shape as agentos-bench native runs:
#   { totalCases, passedCases, accuracy, accuracyCI, totalUsd, costPerCorrect,
#     avgLatencyMs, p50LatencyMs, p95LatencyMs, byType, byTypeCI, cases: [...] }
```

## Status

- 2026-04-28: adapter scaffolded, pending first run after the in-flight LongMemEval-M Phase B finishes (FD pool cleared).
