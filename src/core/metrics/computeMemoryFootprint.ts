/**
 * @file computeMemoryFootprint.ts
 * @description Per-case memory footprint probe. Reads the SQLite brain
 * file size from disk and passes through trace counts + peak working-
 * memory slots sampled during replay.
 *
 * @module agentos-bench/core/metrics/computeMemoryFootprint
 */

import { promises as fs } from 'node:fs';

/**
 * Probe inputs gathered during a case's replay. `brainPath` points at
 * the SQLite file; trace counts and peak slot counts are captured by
 * the replay loop and passed through.
 */
export interface MemoryFootprintProbe {
  brainPath: string;
  traceCount: number;
  peakWorkingMemorySlots: number;
  encodeCalls: number;
}

export interface MemoryFootprint {
  brainBytes: number;
  traceCount: number;
  peakWorkingMemorySlots: number;
  encodeCalls: number;
}

/**
 * Compute a per-case memory-footprint snapshot. Missing brain files
 * yield `brainBytes: 0` — this happens in `memoryMode: 'none'` runs
 * where no SQLite file is created.
 */
export async function computeMemoryFootprint(
  probe: MemoryFootprintProbe,
): Promise<MemoryFootprint> {
  let brainBytes = 0;
  try {
    const stat = await fs.stat(probe.brainPath);
    brainBytes = stat.size;
  } catch (err: unknown) {
    // Missing file is legitimate (mode=none leaves no brain behind).
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return {
    brainBytes,
    traceCount: probe.traceCount,
    peakWorkingMemorySlots: probe.peakWorkingMemorySlots,
    encodeCalls: probe.encodeCalls,
  };
}
