import { execSync } from "node:child_process";

export const DEFAULT_NO_PROXY = "localhost,127.0.0.1,::1";

const PROXY_ENV_KEYS = [
  "FOUNDRY_HTTP_PROXY",
  "FOUNDRY_NO_PROXY",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "all_proxy",
  "no_proxy",
  "NODE_USE_ENV_PROXY",
] as const;

export interface ResolveHttpProxyOpts {
  env?: NodeJS.ProcessEnv;
  /** Used when no proxy env var is set (runner `config.json` `httpProxy`). */
  fallback?: string;
  detectSystemProxy?: () => string | undefined;
}

export function normalizeHttpProxy(value: string): string {
  const v = value.trim();
  if (!v) return v;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;
  return `http://${v}`;
}

/** Hide userinfo so proxy URLs are safe to log. */
export function redactProxyUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.username) u.username = "***";
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return url;
  }
}

/** macOS System Settings proxy. Node, Bun, and git ignore it; browsers do not. */
export function detectMacosSystemProxy(): string | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    const out = execSync("scutil --proxy", {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    });
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

/**
 * Proxy URL for outbound HTTP: `FOUNDRY_HTTP_PROXY`, then standard `HTTPS_PROXY`/`HTTP_PROXY`,
 * then `fallback` (runner config), then the macOS system proxy.
 */
export function resolveHttpProxy(opts: ResolveHttpProxyOpts = {}): string | undefined {
  const env = opts.env ?? process.env;
  const fromEnv =
    env.FOUNDRY_HTTP_PROXY || env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (fromEnv?.trim()) return normalizeHttpProxy(fromEnv);
  if (opts.fallback?.trim()) return normalizeHttpProxy(opts.fallback);
  const detect =
    opts.detectSystemProxy ??
    (opts.env && opts.env !== process.env ? () => undefined : detectMacosSystemProxy);
  const system = detect()?.trim();
  return system ? normalizeHttpProxy(system) : undefined;
}

export function resolveNoProxy(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.FOUNDRY_NO_PROXY || env.NO_PROXY || env.no_proxy;
  return fromEnv?.trim() || DEFAULT_NO_PROXY;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return undefined;
  }
}

/** True when this host is loopback or listed in `NO_PROXY`. */
export function hostMatchesNoProxy(hostname: string, noProxy = DEFAULT_NO_PROXY): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0:0:0:0:0:0:0:1")
    return true;
  for (const raw of noProxy.split(",")) {
    const item = raw.trim().toLowerCase();
    if (!item) continue;
    if (item === "*") return true;
    const n = item.replace(/^\./, "");
    if (host === n || host.endsWith(`.${n}`)) return true;
  }
  return false;
}

export function shouldUseHttpProxy(url: string, opts: ResolveHttpProxyOpts = {}): boolean {
  if (!resolveHttpProxy(opts)) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  const host = hostOf(url);
  if (!host) return false;
  return !hostMatchesNoProxy(host, resolveNoProxy(opts.env ?? process.env));
}

/** Env vars child processes (git, OpenCode, Claude) need to use the same proxy. */
export function httpProxyEnv(opts: ResolveHttpProxyOpts = {}): Record<string, string> {
  const env = opts.env ?? process.env;
  const proxy = resolveHttpProxy(opts);
  if (!proxy) return {};
  const noProxy = resolveNoProxy(env);
  return {
    FOUNDRY_HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    HTTP_PROXY: proxy,
    https_proxy: proxy,
    http_proxy: proxy,
    ALL_PROXY: proxy,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
    NODE_USE_ENV_PROXY: "1",
  };
}

/** `git -c` flags so fetch/push use the proxy and HTTP/1.1 (avoids empty replies). */
export function gitProxyArgs(opts: ResolveHttpProxyOpts = {}): string[] {
  const proxy = resolveHttpProxy(opts);
  if (!proxy) return [];
  return ["-c", `http.proxy=${proxy}`, "-c", `https.proxy=${proxy}`, "-c", "http.version=HTTP/1.1"];
}

let appliedToProcess = false;

/**
 * Copy the resolved proxy onto standard env vars so fetch, child processes, and git agree.
 * Returns the proxy URL, or undefined if none is configured.
 */
export function applyHttpProxyEnv(opts: ResolveHttpProxyOpts = {}): string | undefined {
  const env = opts.env ?? process.env;
  const proxy = resolveHttpProxy(opts);
  if (!proxy) return undefined;
  for (const [key, value] of Object.entries(httpProxyEnv({ ...opts, env }))) env[key] = value;
  if (env === process.env && !appliedToProcess) {
    appliedToProcess = true;
    console.info(`[foundry] HTTP proxy ${redactProxyUrl(proxy)}`);
  }
  return proxy;
}

export function isProxyEnvKey(key: string): boolean {
  return (PROXY_ENV_KEYS as readonly string[]).includes(key);
}

/** Fill unset proxy keys from a `.env` file body (does not override the process environment). */
export function loadHttpProxyFromEnvFile(contents: string, env: NodeJS.ProcessEnv = process.env): void {
  for (const line of contents.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    if (!isProxyEnvKey(key)) continue;
    if (env[key] !== undefined && env[key] !== "") continue;
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    env[key] = val;
  }
}
