/**
 * @file recall.ts
 * @description The GMI driver's recall settings as the CLI takes them (`--recall`, and `--rerank` under the driver),
 * kept apart from the driver so the CLI can check a run before it loads the agent runtime.
 */

/** How the agent's memory finds a turn's memories: `memory.recall.retrieval`. */
export type GmiRecallMode = 'dense' | 'hybrid';

/**
 * The agent's memory reranker: `memory.recall.rerank`. `none`, or a cross-encoder that runs in this process, named by
 * its Hugging Face model id and pinned to a commit of the model's repository.
 */
export type GmiRerank = 'none' | { kind: 'local'; model: string; revision: string };

/**
 * A whole commit id in lower case, 40 hexadecimal characters (SHA-1) or 64 (SHA-256): the only revision AgentOS loads a
 * local reranker at. A branch, a tag or a shortened id can name other weights later, and Transformers.js keeps a pinned
 * revision's files under the id as written.
 */
const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** A Hugging Face model id: `name` or `namespace/name`, each part letters, digits, `_`, `.` and `-`, and no `..`. */
const MODEL_ID = /^(?:[A-Za-z0-9][\w.-]*\/)?[A-Za-z0-9][\w.-]*$/;

/** `--recall <mode>`: `dense` or `hybrid`. */
export function parseGmiRecallMode(value: string): GmiRecallMode {
  if (value !== 'dense' && value !== 'hybrid') throw new Error(`--recall must be 'dense' | 'hybrid', got '${value}'`);
  return value;
}

/**
 * `--rerank` under `--driver gmi`: `none`, or `local:<model>@<revision>`, a cross-encoder in this process at a pinned
 * commit of the model's repository. No remote provider and no LLM judge: either would send memory text out of the
 * process, and the driver measures what can become the library's default.
 */
export function parseGmiRerank(value: string): GmiRerank {
  if (value === 'none') return 'none';
  const match = /^local:([^@]+)@([^@]+)$/.exec(value);
  const model = match?.[1];
  const revision = match?.[2];
  if (!model || !revision || !MODEL_ID.test(model) || model.includes('..') || !COMMIT_ID.test(revision)) {
    throw new Error(
      `--rerank with --driver gmi must be 'none' or 'local:<model>@<revision>', where <model> is a Hugging Face model id and <revision> a whole commit id of its repository in lower case (40 or 64 hexadecimal characters); got '${value}'`
    );
  }
  return { kind: 'local', model, revision };
}
