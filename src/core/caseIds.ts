/**
 * @file caseIds.ts
 * @description `--case-ids <file>`: run only the cases a JSON file lists.
 */
import { promises as fs } from 'node:fs';
import type { BenchCase } from './IBenchmark.js';

/** Reads a case-id list: a JSON array of ids, or an object whose `tuning` field is one. Duplicates are dropped. */
export async function readCaseIds(file: string): Promise<string[]> {
  const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
  const ids = Array.isArray(parsed) ? parsed : (parsed as { tuning?: unknown } | null)?.tuning;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string' && id.length > 0)) {
    throw new Error(`--case-ids ${file}: expected a non-empty array of ids, or an object with a "tuning" array`);
  }
  return [...new Set(ids as string[])];
}

/** The listed cases in the list's order. An id the dataset lacks is an error: a stale list must not shrink a run silently. */
export function pickCases(all: readonly BenchCase[], ids: readonly string[]): BenchCase[] {
  const byId = new Map(all.map((c) => [c.id, c]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(`--case-ids: ${missing.length} id(s) are not in the dataset: ${missing.slice(0, 5).join(', ')}`);
  }
  return ids.map((id) => byId.get(id)!);
}
