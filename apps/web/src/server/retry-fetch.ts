import { applyHttpProxyEnv, resolveHttpProxy, shouldUseHttpProxy } from "@foundry/shared/proxy";
import { type Dispatcher, ProxyAgent, fetch as undiciFetch } from "undici";

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

let agent: Dispatcher | undefined;

function proxyDispatcher(): Dispatcher | undefined {
  const proxy = resolveHttpProxy();
  if (!proxy) return undefined;
  agent ??= new ProxyAgent(proxy);
  return agent;
}

/**
 * Outbound HTTP through `FOUNDRY_HTTP_PROXY` (or HTTPS_PROXY / macOS system proxy), with
 * retries on transient connect failures. Last attempt goes direct so a dead proxy is not fatal.
 */
export const proxiedFetch: typeof fetch = async (input, init) => {
  let last: unknown;
  const dispatcher = shouldUseHttpProxy(urlOf(input)) ? proxyDispatcher() : undefined;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const timeout = AbortSignal.timeout(12_000);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const useProxy = Boolean(dispatcher) && attempt < 5;
    try {
      return (await undiciFetch(input as Parameters<typeof undiciFetch>[0], {
        ...(init as object),
        signal,
        dispatcher: useProxy ? dispatcher : undefined,
      })) as unknown as Response;
    } catch (err) {
      last = err;
      if (attempt === 5 || init?.signal?.aborted) break;
      await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
    }
  }
  throw last;
};

/** Auth.js GitHub token exchange and any other GitHub.com call. */
export const githubFetch = proxiedFetch;

export function installProxiedFetch(): void {
  applyHttpProxyEnv();
  const original = globalThis.fetch;
  if ((original as { __foundryProxy?: boolean }).__foundryProxy) return;

  const wrapped: typeof fetch = async (input, init) => {
    const url = urlOf(input);
    if (!/^https?:/i.test(url) || !shouldUseHttpProxy(url)) return original(input, init);
    return proxiedFetch(input, init);
  };
  (wrapped as { __foundryProxy?: boolean }).__foundryProxy = true;
  globalThis.fetch = wrapped;
}

/** @deprecated use installProxiedFetch */
export const installGithubFetchRetry = installProxiedFetch;
