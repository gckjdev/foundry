import { execSync } from "node:child_process";
import { type Dispatcher, ProxyAgent, fetch as undiciFetch } from "undici";

const GITHUB = /^https:\/\/(?:www\.)?(?:api\.)?github\.com(?:\/|$)/i;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Env first, then macOS system HTTP(S) proxy. Node/fetch ignore that proxy; browsers do not. */
function detectHttpsProxy(): string | undefined {
  const fromEnv = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (fromEnv) return fromEnv;
  if (process.platform !== "darwin") return undefined;
  try {
    const out = execSync("scutil --proxy", { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] });
    const enabled = /HTTPSEnable\s*:\s*1/.test(out) || /HTTPEnable\s*:\s*1/.test(out);
    if (!enabled) return undefined;
    const host = (/HTTPSProxy\s*:\s*(\S+)/.exec(out) ?? /HTTPProxy\s*:\s*(\S+)/.exec(out))?.[1];
    const port = (/HTTPSPort\s*:\s*(\d+)/.exec(out) ?? /HTTPPort\s*:\s*(\d+)/.exec(out))?.[1];
    if (host && port) return `http://${host}:${port}`;
  } catch {
    return undefined;
  }
  return undefined;
}

let memoProxy: string | undefined | false;
let agent: Dispatcher | undefined;
let loggedProxy = false;

function githubDispatcher(): Dispatcher | undefined {
  if (memoProxy === undefined) memoProxy = detectHttpsProxy() ?? false;
  if (memoProxy === false) return undefined;
  if (!loggedProxy) {
    loggedProxy = true;
    console.info(`[foundry] GitHub requests via ${memoProxy}`);
  }
  agent ??= new ProxyAgent(memoProxy);
  return agent;
}

/**
 * github.com from this network is often unreachable by Node's direct fetch (the browser
 * still works because it uses the macOS system proxy). Send GitHub OAuth/API calls
 * through that proxy when present, and retry transient connect failures.
 */
export const githubFetch: typeof fetch = async (input, init) => {
  let last: unknown;
  const dispatcher = githubDispatcher();
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

export function installGithubFetchRetry(): void {
  const original = globalThis.fetch;
  if ((original as { __foundryRetry?: boolean }).__foundryRetry) return;

  const wrapped: typeof fetch = async (input, init) => {
    if (!GITHUB.test(urlOf(input))) return original(input, init);
    return githubFetch(input, init);
  };
  (wrapped as { __foundryRetry?: boolean }).__foundryRetry = true;
  globalThis.fetch = wrapped;
}
