/**
 * @file constants.ts
 * @description Constants of the GMI driver (`run --driver gmi`), kept apart from the driver so the
 * case-run cache key can read them without loading the agent runtime.
 */
import { createRequire } from 'node:module';

/** Bumped when the driver changes what a case's answer depends on; part of the case-run cache key. */
export const GMI_DRIVER_VERSION = 'gmi-driver/1';

/**
 * The installed `@framers/agentos` release, `unknown` when its manifest cannot be read. The agent answers every
 * driver case and the library's defaults move between releases, so this is part of the driver's cache key and of each
 * case's metadata: an answer cached under one release never serves a run on another.
 */
export const AGENTOS_VERSION: string = (() => {
  try {
    const manifest = createRequire(import.meta.url)('@framers/agentos/package.json') as { version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : 'unknown';
  } catch {
    return 'unknown';
  }
})();

/** The system instructions of the agent that answers each case. */
export const GMI_DRIVER_INSTRUCTIONS =
  'You are an assistant with a memory of earlier conversations with this user. Answer the question from what you remember of them, in one or two sentences. If your memory does not hold the answer, say that you do not know.';
