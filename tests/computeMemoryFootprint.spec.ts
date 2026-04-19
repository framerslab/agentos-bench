import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { computeMemoryFootprint } from '../src/core/metrics/computeMemoryFootprint.js';

describe('computeMemoryFootprint', () => {
  let tmpDir: string;
  let filePath: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bench-footprint-'));
    filePath = path.join(tmpDir, 'brain.sqlite');
    await fs.writeFile(filePath, Buffer.alloc(2048));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads brain bytes via fs.stat', async () => {
    const out = await computeMemoryFootprint({
      brainPath: filePath,
      traceCount: 12,
      peakWorkingMemorySlots: 7,
      encodeCalls: 200,
    });
    expect(out.brainBytes).toBe(2048);
    expect(out.traceCount).toBe(12);
    expect(out.peakWorkingMemorySlots).toBe(7);
    expect(out.encodeCalls).toBe(200);
  });

  it('returns brainBytes=0 when file does not exist', async () => {
    const out = await computeMemoryFootprint({
      brainPath: path.join(tmpDir, 'missing.sqlite'),
      traceCount: 0,
      peakWorkingMemorySlots: 0,
      encodeCalls: 0,
    });
    expect(out.brainBytes).toBe(0);
  });

  it('passes through zero-valued probe fields verbatim', async () => {
    const out = await computeMemoryFootprint({
      brainPath: filePath,
      traceCount: 0,
      peakWorkingMemorySlots: 0,
      encodeCalls: 0,
    });
    expect(out.traceCount).toBe(0);
    expect(out.peakWorkingMemorySlots).toBe(0);
    expect(out.encodeCalls).toBe(0);
  });
});
