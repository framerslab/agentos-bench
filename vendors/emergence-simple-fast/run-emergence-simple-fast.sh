#!/usr/bin/env bash
# Wrapper around the EmergenceMem Simple Fast vendor reproduction adapter.
# Sets up Python venv on first run, runs the instrumented script against
# the LongMemEval-S dataset, writes a run JSON in the same directory layout
# as agentos-bench native runs so the LEADERBOARD/comparison-table can pick
# them up.
#
# Usage:
#   ./run-emergence-simple-fast.sh [TOP_K] [LIMIT]
#
# TOP_K defaults to 42 (upstream Simple Fast). Use 20 for Simple Faster.
# LIMIT defaults to no cap (full N=500). Use a smaller value for smoke tests.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BENCH_ROOT="$(cd "$HERE/../.." && pwd)"

TOP_K="${1:-42}"
LIMIT_FLAG=""
if [[ -n "${2:-}" ]]; then
  LIMIT_FLAG="--limit $2"
fi

DATASET="$BENCH_ROOT/data/longmemeval-s/longmemeval_s.json"
if [[ ! -f "$DATASET" ]]; then
  echo "ERROR: LongMemEval-S dataset not found at $DATASET"
  echo "Download from https://github.com/xiaowu0162/LongMemEval per agentos-bench docs."
  exit 1
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "ERROR: OPENAI_API_KEY not set in environment."
  exit 1
fi

# Python venv setup (idempotent)
if [[ ! -d "$HERE/.venv" ]]; then
  echo "Creating Python venv..."
  python3 -m venv "$HERE/.venv"
  "$HERE/.venv/bin/pip" install --upgrade pip
  "$HERE/.venv/bin/pip" install -r "$HERE/requirements.txt"
fi

TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%3N)"
OUTPUT="$BENCH_ROOT/results/runs/${TIMESTAMP}--longmemeval-s--emergence-simple-fast--topk${TOP_K}.json"

echo "Running EmergenceMem Simple Fast vendor reproduction..."
echo "  dataset: $DATASET"
echo "  top-k:   $TOP_K"
echo "  output:  $OUTPUT"
echo

"$HERE/.venv/bin/python" "$HERE/main_instrumented.py" \
  --dataset "$DATASET" \
  --top-k "$TOP_K" \
  --output "$OUTPUT" \
  --bootstrap-resamples 10000 \
  $LIMIT_FLAG
