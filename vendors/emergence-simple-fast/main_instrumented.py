"""
EmergenceMem Simple Fast — instrumented for apples-to-apples cost+latency comparison
against AgentOS bench runs.

Source algorithm: github.com/EmergenceAI/emergence_simple_fast (their main.py)
The retrieval, prompts, and LLM call structure are byte-for-byte identical to
their upstream. We add ONLY:
  - Per-case wall-clock latency capture (time.perf_counter)
  - Per-LLM-call usage capture (response.usage.prompt_tokens / completion_tokens)
  - Per-case cost computation (current OpenAI public pricing)
  - Structured JSON output in the same shape as agentos-bench native runs

Output JSON shape mirrors packages/agentos-bench/results/runs/*.json so the two
can be diffed directly in the LEADERBOARD/comparison-table:
  {
    "benchmarkId": "longmemeval-s",
    "vendor": "emergence-simple-fast",
    "totalCases": 500, "passedCases": <int>, "accuracy": <float>,
    "accuracyCI": {"value": <float>, "ciLo": <float>, "ciHi": <float>, "resamples": 10000, "ci": 0.95},
    "totalUsd": <float>, "costPerCorrect": <float>,
    "avgLatencyMs": <float>, "p50LatencyMs": <float>, "p95LatencyMs": <float>,
    "byType": {<category>: {"n": <int>, "accuracy": <float>}},
    "byTypeCI": {<category>: {"value": <float>, "ciLo": <float>, "ciHi": <float>}},
    "cases": [{"caseId", "actualOutput", "latencyMs", "tokensIn", "tokensOut", "usd", "passed"}]
  }
"""

from __future__ import annotations

import argparse
import json
import os
import textwrap
import time
from typing import Any, TypedDict

import numpy as np
import openai
from sentence_transformers import SentenceTransformer, util
from tqdm import tqdm


# ---------------------------------------------------------------------------
# OpenAI public pricing as of 2026-04-28. Update this dict if pricing changes
# in a future bench-cycle; the computed costPerCorrect numbers are derived
# from these constants. Values are USD per 1M tokens.
# ---------------------------------------------------------------------------
OPENAI_PRICING = {
    "gpt-4o-2024-08-06": {"input": 2.50, "output": 10.00},
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4o-mini-2024-07-18": {"input": 0.15, "output": 0.60},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "gpt-5-mini": {"input": 0.20, "output": 0.80},
}


def cost_for_call(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """USD cost for a single OpenAI chat completion at current public pricing."""
    pricing = OPENAI_PRICING.get(model)
    if pricing is None:
        # Conservative fallback — match gpt-4o pricing if model unknown so we
        # don't silently under-report cost for new models.
        pricing = OPENAI_PRICING["gpt-4o"]
    input_usd = (prompt_tokens / 1_000_000) * pricing["input"]
    output_usd = (completion_tokens / 1_000_000) * pricing["output"]
    return input_usd + output_usd


# ---------------------------------------------------------------------------
# Algorithm = unchanged EmergenceMem Simple Fast.
# Instrumentation = wrapper around callgpt that returns usage so we can sum
# per-case cost.
# ---------------------------------------------------------------------------

retrieval_model = SentenceTransformer("all-MiniLM-L6-v2")
client = openai.OpenAI()


class CallgptResult(TypedDict):
    """Wrapped LLM response with usage capture for cost tracking."""
    text: str
    prompt_tokens: int
    completion_tokens: int
    model: str
    cost_usd: float


def callgpt(messages: list[dict], model: str, max_tokens: int) -> CallgptResult:
    """Wrap OpenAI chat completion with usage capture.

    Behavioral parity with EmergenceMem upstream: temperature=0, max_tokens
    matches upstream call sites. Only difference vs upstream is we return
    a TypedDict that includes usage, not a bare string.
    """
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.0,
        max_tokens=max_tokens,
    )
    usage = response.usage
    text = response.choices[0].message.content or ""
    pt = usage.prompt_tokens if usage else 0
    ct = usage.completion_tokens if usage else 0
    return {
        "text": text,
        "prompt_tokens": pt,
        "completion_tokens": ct,
        "model": model,
        "cost_usd": cost_for_call(model, pt, ct),
    }


def process_haystack(haystack_sessions: list[list[dict]], haystack_dates: list[str]):
    """Preprocess and encode haystack turns with dates. Verbatim from upstream."""
    all_turns = []
    for session, date in zip(haystack_sessions, haystack_dates):
        for turn in session:
            if "role" in turn and "content" in turn:
                all_turns.append(f"[{date}] {turn['role']}: {turn['content']}")
    corpus_embeddings = retrieval_model.encode(all_turns, convert_to_tensor=True)
    return corpus_embeddings, all_turns


def process_question(memstruct, question: str, question_date: str, top_k: int = 42):
    """Run the EmergenceMem Simple Fast 2-call reader pipeline.

    Returns (answer_text, list_of_call_metadata) so the harness can sum
    per-case cost + token usage.
    """
    corpus_embeddings, all_turns = memstruct
    query_embedding = retrieval_model.encode(question, convert_to_tensor=True)
    hits = util.semantic_search(query_embedding, corpus_embeddings, top_k=top_k)[0]
    retrieved_turns = [all_turns[hit["corpus_id"]] for hit in hits]

    # Step 2 (extract): same prompt verbatim as upstream
    summary_prompt = f"""
    You are a memory summarization assistant. Extract relevant facts to answer the question. Follow this chain-of-thought:
    1. Identify key events, dates, quantities, or named entities.
    2. Extract only information relevant to the question.
    3. Write the facts in structured bullet points.
    \nQuestion: {question}
    \nMessages:
    {json.dumps(retrieved_turns, indent=2)}
    \nNow extract the structured facts:
    -
    """
    summary_prompt = textwrap.dedent(summary_prompt)
    extract = callgpt(
        [{"role": "system", "content": summary_prompt}],
        model="gpt-4o",
        max_tokens=512,
    )

    # Step 3 (answer): same prompt verbatim as upstream
    answer_prompt = f"""
    You are a helpful assistant. Using both the extracted facts and the original conversation turns below,
    answer the question as accurately and concisely as possible.
    \nExtracted Facts:
    {extract['text']}
    \nRetrieved Conversation Turns:
    {json.dumps(retrieved_turns, indent=2)}
    \nQuestion: {question}
    Question Date: {question_date}
    Answer:
    """
    answer_prompt = textwrap.dedent(answer_prompt)
    answer = callgpt(
        [{"role": "system", "content": answer_prompt}],
        model="gpt-4o",
        max_tokens=256,
    )
    return answer["text"].strip(), [extract, answer]


# ---------------------------------------------------------------------------
# Judge — same upstream prompts (LongMemEval reference), same model
# (gpt-4o-2024-08-06). We track judge cost separately so it can be excluded
# from the user-facing per-correct cost (judge is out-of-band, paid by the
# bench operator, not by the deployed-config consumer).
# ---------------------------------------------------------------------------

def get_anscheck_prompt(task: str, question: str, answer: str, response: str, abstention: bool = False) -> str:
    if not abstention:
        if task in ["single-session-user", "single-session-assistant", "multi-session"]:
            template = "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. \n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only."
        elif task == "temporal-reasoning":
            template = "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct. \n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only."
        elif task == "knowledge-update":
            template = "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.\n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only."
        elif task == "single-session-preference":
            template = "I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.\n\nQuestion: {}\n\nRubric: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only."
        else:
            raise NotImplementedError(f"Unknown task: {task}")
        return template.format(question, answer, response)
    else:
        template = "I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not.\n\nQuestion: {}\n\nExplanation: {}\n\nModel Response: {}\n\nDoes the model correctly identify the question as unanswerable? Answer yes or no only."
        return template.format(question, answer, response)


def judge_case(
    task: str,
    question: str,
    correct_answer: str,
    model_response: str,
    abstention: bool,
) -> tuple[bool, CallgptResult]:
    """Run the upstream LongMemEval judge prompt and return (passed, judge_call_meta)."""
    prompt = get_anscheck_prompt(task, question, correct_answer, model_response, abstention)
    judge = callgpt(
        messages=[{"role": "user", "content": prompt}],
        model="gpt-4o-2024-08-06",
        max_tokens=10,
    )
    label = "yes" in judge["text"].lower()
    return label, judge


# ---------------------------------------------------------------------------
# Bootstrap CI — same Mulberry32 + percentile method as agentos-bench so the
# resulting CIs are directly comparable across the two run JSONs.
# ---------------------------------------------------------------------------

def mulberry32(seed: int):
    state = [seed & 0xFFFFFFFF]
    def next_uint32() -> int:
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = state[0]
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= ((t + ((t ^ (t >> 7)) * (t | 61))) & 0xFFFFFFFF) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF)
    return next_uint32


def bootstrap_ci(values: list[float], resamples: int = 10000, seed: int = 42, ci: float = 0.95):
    """Percentile-method bootstrap with Mulberry32 RNG."""
    if not values:
        return {"value": 0.0, "ciLo": 0.0, "ciHi": 0.0, "resamples": resamples, "ci": ci}
    n = len(values)
    rng = mulberry32(seed)
    means = []
    for _ in range(resamples):
        s = 0.0
        for _ in range(n):
            idx = rng() % n
            s += values[idx]
        means.append(s / n)
    means.sort()
    lo_idx = int(((1.0 - ci) / 2.0) * resamples)
    hi_idx = int((1.0 - (1.0 - ci) / 2.0) * resamples) - 1
    point = sum(values) / n
    return {
        "value": point,
        "ciLo": means[max(0, lo_idx)],
        "ciHi": means[min(resamples - 1, hi_idx)],
        "resamples": resamples,
        "ci": ci,
    }


# ---------------------------------------------------------------------------
# Main: run vs LongMemEval-S, capture per-case + aggregate metrics, write
# run JSON in the agentos-bench-compatible shape.
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", required=True, help="Path to longmemeval_s.json")
    parser.add_argument("--top-k", type=int, default=42, help="Retrieved turns per question (upstream default 42; Simple Faster uses 20)")
    parser.add_argument("--output", required=True, help="Output run JSON path")
    parser.add_argument("--limit", type=int, default=None, help="Optional cap on cases for smoke testing")
    parser.add_argument("--bootstrap-resamples", type=int, default=10000)
    args = parser.parse_args()

    assert os.path.exists(args.dataset), f"Dataset not found at {args.dataset}"
    haystacks = json.load(open(args.dataset))
    if args.limit:
        haystacks = haystacks[: args.limit]

    started_at = time.time()
    cases_out: list[dict[str, Any]] = []
    by_type: dict[str, list[bool]] = {}

    for haystack in tqdm(haystacks, desc="EmergenceMem Simple Fast"):
        question_id = haystack["question_id"]
        question = haystack["question"]
        question_date = haystack["question_date"]
        haystack_dates = haystack["haystack_dates"]
        haystack_sessions = haystack["haystack_sessions"]
        question_type = haystack.get("question_type", "unknown")
        correct_answer = haystack["answer"]

        # Time the haystack pre-processing separately (matches upstream methodology
        # — they exclude haystack pre-processing from the per-question latency).
        t0 = time.perf_counter()
        memstruct = process_haystack(haystack_sessions, haystack_dates)
        haystack_ms = (time.perf_counter() - t0) * 1000.0

        # Per-case latency timer
        t1 = time.perf_counter()
        try:
            answer_text, calls = process_question(memstruct, question, question_date, top_k=args.top_k)
        except Exception as exc:
            # Match agentos-bench behavior on per-case error: record the case
            # with empty actualOutput, zero usage, propagate the error message.
            calls = []
            answer_text = f"[error: {exc}]"
        latency_ms = (time.perf_counter() - t1) * 1000.0

        # Sum reader cost (extract + answer LLM calls only — judge is out-of-band)
        reader_tokens_in = sum(c["prompt_tokens"] for c in calls)
        reader_tokens_out = sum(c["completion_tokens"] for c in calls)
        reader_usd = sum(c["cost_usd"] for c in calls)

        # Run the same LongMemEval judge as agentos-bench
        is_abstention = "_abs" in question_id
        passed, judge_call = judge_case(
            task=question_type,
            question=question,
            correct_answer=correct_answer,
            model_response=answer_text,
            abstention=is_abstention,
        )

        cases_out.append({
            "caseId": question_id,
            "type": question_type,
            "actualOutput": answer_text,
            "latencyMs": latency_ms,
            "haystackMs": haystack_ms,
            "tokensIn": reader_tokens_in,
            "tokensOut": reader_tokens_out,
            "usd": reader_usd,
            "judgeUsd": judge_call["cost_usd"],
            "judgeTokens": judge_call["prompt_tokens"] + judge_call["completion_tokens"],
            "passed": passed,
        })
        by_type.setdefault(question_type, []).append(passed)

    completed_at = time.time()

    # Aggregates — same shape as agentos-bench run JSONs
    total_cases = len(cases_out)
    passed_cases = sum(1 for c in cases_out if c["passed"])
    accuracy = passed_cases / total_cases if total_cases else 0.0

    # Bootstrap CI on the case-level pass/fail vector
    pass_vec = [1.0 if c["passed"] else 0.0 for c in cases_out]
    accuracy_ci = bootstrap_ci(pass_vec, resamples=args.bootstrap_resamples)

    # Latency stats — wall-clock per case (excluding haystack pre-processing,
    # matching upstream methodology)
    latencies = sorted([c["latencyMs"] for c in cases_out])
    p50 = latencies[len(latencies) // 2] if latencies else 0.0
    p95 = latencies[int(len(latencies) * 0.95)] if latencies else 0.0
    avg_lat = sum(latencies) / len(latencies) if latencies else 0.0

    total_usd = sum(c["usd"] for c in cases_out)
    total_judge_usd = sum(c["judgeUsd"] for c in cases_out)
    cost_per_correct = total_usd / passed_cases if passed_cases else 0.0

    by_type_summary = {}
    by_type_ci = {}
    for t, results in sorted(by_type.items()):
        n = len(results)
        accs = [1.0 if r else 0.0 for r in results]
        by_type_summary[t] = {"n": n, "accuracy": sum(accs) / n if n else 0.0}
        by_type_ci[t] = bootstrap_ci(accs, resamples=args.bootstrap_resamples)

    out = {
        "benchmarkId": "longmemeval-s",
        "vendor": "emergence-simple-fast",
        "vendorSource": "https://github.com/EmergenceAI/emergence_simple_fast",
        "config": {
            "embedder": "sentence-transformers/all-MiniLM-L6-v2 (local)",
            "topK": args.top_k,
            "reader": "gpt-4o (extract + answer, 2 calls per case)",
            "judge": "gpt-4o-2024-08-06",
            "rubric": "LongMemEval upstream (verbatim)",
            "bootstrapResamples": args.bootstrap_resamples,
            "bootstrapSeed": 42,
        },
        "totalCases": total_cases,
        "passedCases": passed_cases,
        "accuracy": accuracy,
        "accuracyCI": accuracy_ci,
        "totalUsd": total_usd,
        "totalJudgeUsd": total_judge_usd,
        "costPerCorrect": cost_per_correct,
        "avgLatencyMs": avg_lat,
        "p50LatencyMs": p50,
        "p95LatencyMs": p95,
        "byType": by_type_summary,
        "byTypeCI": by_type_ci,
        "cases": cases_out,
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(started_at)),
        "completedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(completed_at)),
    }
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, "w") as f:
        json.dump(out, f, indent=2)
    print(f"Wrote {args.output}")
    print(f"  accuracy={accuracy*100:.1f}% [{accuracy_ci['ciLo']*100:.1f}, {accuracy_ci['ciHi']*100:.1f}] passed={passed_cases}/{total_cases}")
    print(f"  totalUsd=${total_usd:.4f} costPerCorrect=${cost_per_correct:.4f} (excludes judge ${total_judge_usd:.4f})")
    print(f"  latency avg={avg_lat:.0f}ms p50={p50:.0f}ms p95={p95:.0f}ms")


if __name__ == "__main__":
    main()
