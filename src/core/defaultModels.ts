/**
 * @file defaultModels.ts
 * @description Default OpenAI model for the bench's small LLM roles: the
 * question classifier, the observer and reflector, the fact extractor, the
 * typed-network observer and the adversarial distractor synthesizer.
 *
 * `gpt-5-mini` held these roles and ends on 2026-12-11. `gpt-6-luna` replaces
 * it at $0.10 / $0.01 / $0.50 per 1M tokens (input / cached / output) against
 * $0.25 / $0.025 / $2.00, called at reasoning effort `none` so no reasoning
 * tokens bill.
 *
 * @module agentos-bench/core/defaultModels
 */

import type { ReaderModel } from './IBenchmark.js';

/** Model used by every small LLM role unless a flag names another. */
export const DEFAULT_SMALL_MODEL: ReaderModel = 'gpt-6-luna';

/**
 * Model behind the cache buckets that carry no model tag. Any other model
 * gets a tag in its cache key, so a run never replays answers written by a
 * different model.
 */
export const UNTAGGED_CACHE_MODEL: ReaderModel = 'gpt-5-mini';
