/**
 * @file upstream.ts
 * @description Where the GMI driver may send a case's question and memory block. Kept apart from
 * the driver so the CLI can check a run before it loads the agent runtime.
 */

const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Where the driver's forwarded requests go: the provider's own variable, else OpenAI. */
export function gmiUpstreamBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.OPENAI_BASE_URL?.trim() || OPENAI_BASE_URL).replace(/\/+$/, '');
}

/**
 * The host of {@link gmiUpstreamBaseUrl}, as a run records it and as the case-run cache keys it. `invalid` when the
 * variable holds no URL: {@link gmiUpstreamProblem} refuses such a run before it sends anything.
 */
export function gmiUpstreamHostname(env: NodeJS.ProcessEnv = process.env): string {
  try {
    return new URL(gmiUpstreamBaseUrl(env)).hostname.toLowerCase();
  } catch {
    return 'invalid';
  }
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
  const host = url.hostname.toLowerCase();
  if (LOOPBACK.has(host)) return null;
  if (dryRun) return 'a dry run needs OPENAI_BASE_URL set to a stub on this machine; it never calls a provider';
  if (host !== 'api.openai.com') {
    return `OPENAI_BASE_URL points at ${host}: the driver sends only to api.openai.com or to a stub on this machine`;
  }
  // The key, the question and every filed line travel to the provider: never in the clear.
  return url.protocol === 'https:' ? null : `OPENAI_BASE_URL must reach api.openai.com over https, got '${baseUrl}'`;
}
