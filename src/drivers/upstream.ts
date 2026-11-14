/**
 * @file upstream.ts
 * @description Where the GMI driver may send a case's question and memory block, and which embedder it can reach
 * there. Kept apart from the driver so the CLI and the runner can check a run before they load the agent runtime.
 */

const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Where the driver's forwarded requests go: the provider's own variable, else OpenAI. */
export function gmiUpstreamBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.OPENAI_BASE_URL?.trim() || OPENAI_BASE_URL).replace(/\/+$/, '');
}

/**
 * {@link gmiUpstreamBaseUrl} as a run records it and as the case-run cache keys it: scheme, host, port and base path,
 * without credentials, a query or a trailing slash (`http://127.0.0.1:4010/v1`, `https://api.openai.com/v1`). Two stubs
 * on one machine differ by port, so neither's answers serve a run against the other. `invalid` when the variable holds
 * no URL: {@link gmiUpstreamProblem} refuses such a run before it sends anything.
 */
export function gmiUpstreamEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  try {
    const url = new URL(gmiUpstreamBaseUrl(env));
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return 'invalid';
  }
}

/**
 * Why the driver will not answer a run that names `named` as its upstream, or null. The run file records that
 * endpoint and the case-run cache keys the run's answers by it, while the driver sends where `OPENAI_BASE_URL` points:
 * a run built on `BenchmarkRunner` that names one endpoint while the environment gives another would cache one
 * endpoint's answers under the other's. Unset (`undefined`) is no conflict: the runner fills it from the environment.
 */
export function gmiUpstreamMismatch(named: string | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  if (named === undefined) return null;
  const given = gmiUpstreamEndpoint(env);
  if (gmiUpstreamEndpoint({ OPENAI_BASE_URL: named }) === given) return null;
  return `the run names gmiUpstream '${named}', but OPENAI_BASE_URL gives '${given}': the driver sends where OPENAI_BASE_URL points, so set the two to the same endpoint`;
}

/**
 * Why the driver will not send to `baseUrl`, or null. A case's question, with its memory block, and every filed
 * line's embedding request go to this address: it is the provider the driver names (api.openai.com, over https) or
 * a stub on this machine, and a dry run takes the stub alone. Any other host is refused, whatever protocol it speaks.
 */
export function gmiUpstreamProblem(baseUrl: string, dryRun: boolean): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return `OPENAI_BASE_URL '${baseUrl}' is not a URL`;
  }
  // The run file and the cache key record scheme, host, port and path: two variables that differ only in a query or a
  // fragment would share one key while the proxy sent to each as written.
  if (url.search || url.hash) return `OPENAI_BASE_URL must not carry a query or a fragment, got '${baseUrl}'`;
  const host = url.hostname.toLowerCase();
  if (LOOPBACK.has(host)) return null;
  if (dryRun) return 'a dry run needs OPENAI_BASE_URL set to a stub on this machine; it never calls a provider';
  if (host !== 'api.openai.com') {
    return `OPENAI_BASE_URL points at ${host}: the driver sends only to api.openai.com or to a stub on this machine`;
  }
  // The key, the question and every filed line travel to the provider: never in the clear.
  return url.protocol === 'https:' ? null : `OPENAI_BASE_URL must reach api.openai.com over https, got '${baseUrl}'`;
}

/**
 * Why the driver cannot embed with `model`, or null. The agent's embedder is OpenAI's, at the same upstream as the
 * question, so the model is an OpenAI embedding model, bare or `openai:`-prefixed. Unset takes the driver's default.
 */
export function gmiEmbedderProblem(model: string | undefined): string | null {
  if (model === undefined || /^(openai:)?text-embedding-[\w.-]+$/.test(model)) return null;
  return `--embedder-model must be an OpenAI embedding model (text-embedding-*, bare or openai:-prefixed), got '${model}'`;
}
