/**
 * Every `@framers/agentos` specifier the sources import must resolve through the
 * installed package's export map. A path that agentos moved fails here by name.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const SPECIFIER = /(?:\bfrom\s+|\bimport\(\s*)['"](@framers\/agentos(?:\/[^'"]+)?)['"]/g;

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('the installed @framers/agentos', () => {
  it('resolves every specifier the sources import', async () => {
    const found = new Map<string, string>();
    for (const file of await sourceFiles(SRC)) {
      const text = await fs.readFile(file, 'utf8');
      for (const match of text.matchAll(SPECIFIER)) if (!found.has(match[1])) found.set(match[1], path.relative(SRC, file));
    }
    expect(found.size).toBeGreaterThanOrEqual(10);
    const unresolved: string[] = [];
    for (const [specifier, file] of [...found].sort()) {
      try { require.resolve(specifier); } catch { unresolved.push(`${specifier} (first seen in src/${file})`); }
    }
    expect(unresolved).toEqual([]);
  });
});
