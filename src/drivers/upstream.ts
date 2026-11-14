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
 * Why the driver will not send to `baseUrl`, or null. A case's question, with its memory block, and every filed
 * line's embedding request go to this address: it is the provider the driver names (api.openai.com) or a stub on
 * this machine, and a dry run takes the stub alone. Any other host is refused, whatever protocol it speaks.
 */
export function gmiUpstreamProblem(baseUrl: string, dryRun: boolean): string | null {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return `OPENAI_BASE_URL '${baseUrl}' is not a URL`;
  }
  if (LOOPBACK.has(host)) return null;
  if (dryRun) return 'a dry run needs OPENAI_BASE_URL set to a stub on this machine; it never calls a provider';
  return host === 'api.openai.com'
    ? null
    : `OPENAI_BASE_URL points at ${host}: the driver sends only to api.openai.com or to a stub on this machine`;
}
