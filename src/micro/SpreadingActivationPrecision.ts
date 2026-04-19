/**
 * @file SpreadingActivationPrecision.ts
 * @description Micro-benchmark for Anderson's spreading activation.
 *
 * Build a synthetic associative graph with known cluster structure, run
 * spreading activation from a seed in one cluster, and measure what
 * fraction of the returned activated nodes belong to the seed's own
 * cluster. A healthy implementation keeps activation mostly contained
 * within the seed cluster (precision ≥ 0.80); a broken one leaks
 * activation indiscriminately across the graph.
 *
 * Graph construction is deterministic (seeded PRNG) so runs are exactly
 * reproducible. Cluster count, intra-/inter-cluster edge density, and
 * the precision threshold live at the top of this file so the test can
 * tighten over time without touching the benchmark contract.
 *
 * @module agentos-bench/micro/SpreadingActivationPrecision
 */

import { spreadActivation } from '@framers/agentos';
import type {
  BenchCase,
  BenchContext,
  BenchResult,
  CaseResult,
  CaseRun,
  IBenchmark,
} from '../core/IBenchmark.js';
import { percentile, stdDev } from '../core/statsUtil.js';

/** Number of clusters in the synthetic graph. */
const CLUSTER_COUNT = 3;
/** Nodes per cluster. */
const NODES_PER_CLUSTER = 50;
/** Probability of intra-cluster edge between two distinct nodes. */
const INTRA_CLUSTER_EDGE_PROB = 0.35;
/** Edge weight for intra-cluster edges. */
const INTRA_CLUSTER_WEIGHT = 0.8;
/** Number of cross-cluster bridge edges between every pair of clusters. */
const INTER_CLUSTER_BRIDGES = 1;
/** Edge weight for cross-cluster bridges. */
const INTER_CLUSTER_WEIGHT = 0.2;
/** Max activated nodes to return (matches DEFAULT_CONFIG but explicit here). */
const MAX_RESULTS = 25;
/** Required share of activated nodes that belong to the seed's own cluster. */
const REQUIRED_PRECISION = 0.8;

/**
 * SpreadingActivationPrecision — asserts spreading activation is
 * well-contained within a seed's associative cluster.
 */
export class SpreadingActivationPrecision implements IBenchmark {
  readonly id = 'spreading-activation-precision';
  readonly version = '1.0.0';
  readonly family = 'micro' as const;
  readonly passThreshold = 1.0;

  async setup(_ctx: BenchContext): Promise<void> {}

  async loadTestCases(_ctx: BenchContext): Promise<BenchCase[]> {
    return Array.from({ length: CLUSTER_COUNT }, (_, clusterIdx) => ({
      id: `spreading-precision-cluster-${clusterIdx}`,
      type: 'assertion',
      question: `Seed inside cluster ${clusterIdx} — at least ${(REQUIRED_PRECISION * 100).toFixed(0)}% of activated nodes should belong to cluster ${clusterIdx}.`,
      haystack: [],
      expected: `precision >= ${REQUIRED_PRECISION}`,
      metadata: { clusterIdx },
    }));
  }

  async runCase(c: BenchCase, _ctx: BenchContext): Promise<CaseRun> {
    const start = Date.now();
    const clusterIdx = c.metadata?.clusterIdx as number;
    const seed = Math.floor(99_991 + clusterIdx * 13); // deterministic per-case PRNG seed

    const { getNeighbors, clusterOf } = buildSyntheticGraph({
      clusters: CLUSTER_COUNT,
      perCluster: NODES_PER_CLUSTER,
      intraProb: INTRA_CLUSTER_EDGE_PROB,
      intraWeight: INTRA_CLUSTER_WEIGHT,
      interBridges: INTER_CLUSTER_BRIDGES,
      interWeight: INTER_CLUSTER_WEIGHT,
      seed,
    });

    const seedId = nodeIdFor(clusterIdx, 0);
    const activated = await spreadActivation({
      seedIds: [seedId],
      getNeighbors,
      config: { maxDepth: 3, decayPerHop: 0.5, activationThreshold: 0.05, maxResults: MAX_RESULTS },
    });

    const inCluster = activated.filter((n) => clusterOf(n.memoryId) === clusterIdx).length;
    const precision = activated.length === 0 ? 0 : inCluster / activated.length;

    return {
      caseId: c.id,
      actualOutput: `precision=${precision.toFixed(3)} (${inCluster}/${activated.length})`,
      latencyMs: Date.now() - start,
      tokensIn: 0,
      tokensOut: 0,
      usd: 0,
      metadata: {
        clusterIdx,
        seedId,
        activatedCount: activated.length,
        inClusterCount: inCluster,
        precision,
        requiredPrecision: REQUIRED_PRECISION,
      },
    };
  }

  async scoreCase(_c: BenchCase, run: CaseRun, _ctx: BenchContext): Promise<CaseResult> {
    const precision = (run.metadata?.precision as number) ?? 0;
    const passed = precision >= REQUIRED_PRECISION;
    return {
      ...run,
      score: passed ? 1 : 0,
      passed,
      scoreMetadata: {
        precision,
        requiredPrecision: REQUIRED_PRECISION,
        note: passed
          ? `Activation stayed within the seed cluster at ${(precision * 100).toFixed(1)}%.`
          : `Activation leaked across clusters: ${(precision * 100).toFixed(1)}% in-cluster (required ${(REQUIRED_PRECISION * 100).toFixed(0)}%).`,
      },
    };
  }

  aggregate(results: CaseResult[], ctx: BenchContext): BenchResult {
    const scores = results.map((r) => r.score);
    const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const passed = results.filter((r) => r.passed).length;
    const avgScore = scores.reduce((s, v) => s + v, 0) / Math.max(1, scores.length);

    return {
      benchmarkId: this.id,
      benchmarkVersion: this.version,
      config: ctx.config,
      totalCases: results.length,
      passedCases: passed,
      accuracy: passed / Math.max(1, results.length),
      avgScore,
      scoreStdDev: stdDev(scores),
      byType: {
        assertion: {
          n: results.length,
          accuracy: passed / Math.max(1, results.length),
          avgScore,
        },
      },
      avgLatencyMs: latencies.reduce((s, v) => s + v, 0) / Math.max(1, latencies.length),
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      totalReaderTokens: 0,
      totalUsd: 0,
      costPerCorrect: 0,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      cases: results,
    };
  }
}

// ---------------------------------------------------------------------------
// Synthetic graph helpers
// ---------------------------------------------------------------------------

function nodeIdFor(cluster: number, idx: number): string {
  return `c${cluster}-n${idx}`;
}

function parseClusterFromId(id: string): number {
  const match = id.match(/^c(\d+)-n\d+$/);
  if (!match) return -1;
  return Number.parseInt(match[1]!, 10);
}

interface GraphSpec {
  clusters: number;
  perCluster: number;
  intraProb: number;
  intraWeight: number;
  interBridges: number;
  interWeight: number;
  seed: number;
}

interface SyntheticGraph {
  getNeighbors: (nodeId: string) => Array<{ id: string; weight: number }>;
  clusterOf: (nodeId: string) => number;
}

/**
 * Build a deterministic synthetic graph with cluster structure.
 * Returns a `getNeighbors` callback suitable for {@link spreadActivation}
 * and a `clusterOf(id)` helper for scoring.
 */
export function buildSyntheticGraph(spec: GraphSpec): SyntheticGraph {
  const rand = seededRand(spec.seed);
  const adjacency = new Map<string, Array<{ id: string; weight: number }>>();

  const addEdge = (a: string, b: string, weight: number): void => {
    const pushUnique = (from: string, to: string): void => {
      const list = adjacency.get(from) ?? [];
      if (!list.find((e) => e.id === to)) {
        list.push({ id: to, weight });
        adjacency.set(from, list);
      }
    };
    pushUnique(a, b);
    pushUnique(b, a);
  };

  // Intra-cluster edges: Bernoulli per pair
  for (let c = 0; c < spec.clusters; c++) {
    for (let i = 0; i < spec.perCluster; i++) {
      const from = nodeIdFor(c, i);
      // Ensure node exists even if it draws no edges from this pass.
      if (!adjacency.has(from)) adjacency.set(from, []);
      for (let j = i + 1; j < spec.perCluster; j++) {
        if (rand() < spec.intraProb) {
          addEdge(from, nodeIdFor(c, j), spec.intraWeight);
        }
      }
    }
  }

  // Inter-cluster bridges: `interBridges` random edges between each cluster pair
  for (let a = 0; a < spec.clusters; a++) {
    for (let b = a + 1; b < spec.clusters; b++) {
      for (let k = 0; k < spec.interBridges; k++) {
        const ia = Math.floor(rand() * spec.perCluster);
        const ib = Math.floor(rand() * spec.perCluster);
        addEdge(nodeIdFor(a, ia), nodeIdFor(b, ib), spec.interWeight);
      }
    }
  }

  return {
    getNeighbors: (nodeId) => adjacency.get(nodeId) ?? [],
    clusterOf: (nodeId) => parseClusterFromId(nodeId),
  };
}

/** Mulberry32 PRNG — small, deterministic, and plenty for graph sampling. */
function seededRand(seedValue: number): () => number {
  let state = seedValue >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
