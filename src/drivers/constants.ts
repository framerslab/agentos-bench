/**
 * @file constants.ts
 * @description Constants of the GMI driver (`run --driver gmi`), kept apart from the driver so the
 * case-run cache key can read the version without loading the agent runtime.
 */

/** Bumped when the driver changes what a case's answer depends on; part of the case-run cache key. */
export const GMI_DRIVER_VERSION = 'gmi-driver/1';

/** The system instructions of the agent that answers each case. */
export const GMI_DRIVER_INSTRUCTIONS =
  'You are an assistant with a memory of earlier conversations with this user. Answer the question from what you remember of them, in one or two sentences. If your memory does not hold the answer, say that you do not know.';
