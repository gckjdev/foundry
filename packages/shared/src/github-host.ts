/**
 * GitHub host URL derivation. Foundry talks to one GitHub host at a time:
 * github.com by default, or a GitHub Enterprise Server instance when `GITHUB_HOST` is set.
 *
 *   GITHUB_HOST unset            -> https://github.com + https://api.github.com
 *   GITHUB_HOST=https://gh.example -> REST https://gh.example/api/v3, GraphQL https://gh.example/api/graphql, …
 *
 * `GITHUB_API_URL` and `FOUNDRY_GIT_BASE` override the derived REST / git base when set.
 */

export const GITHUB_DOT_COM = "https://github.com";
export const GITHUB_DOT_COM_API = "https://api.github.com";

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** `GITHUB_HOST` with trailing slashes removed; empty / unset falls back to github.com. */
export function normalizeGitHubHost(raw: string | undefined): string {
  const host = raw?.trim().replace(/\/+$/, "");
  return host || GITHUB_DOT_COM;
}

/**
 * REST API base. github.com is special-cased to `https://api.github.com`; a GHES host uses
 * `<host>/api/v3`.
 */
export function githubApiUrl(host: string | undefined): string {
  const base = normalizeGitHubHost(host);
  return base === GITHUB_DOT_COM ? GITHUB_DOT_COM_API : `${base}/api/v3`;
}

/** GraphQL endpoint (Projects v2). github.com → api.github.com/graphql; GHES → <host>/api/graphql. */
export function githubGraphqlUrl(host: string | undefined): string {
  const base = normalizeGitHubHost(host);
  return base === GITHUB_DOT_COM ? `${GITHUB_DOT_COM_API}/graphql` : `${base}/api/graphql`;
}

export function githubOAuthAuthorizeUrl(host: string | undefined): string {
  return `${normalizeGitHubHost(host)}/login/oauth/authorize`;
}

export function githubOAuthTokenUrl(host: string | undefined): string {
  return `${normalizeGitHubHost(host)}/login/oauth/access_token`;
}

export function githubUserInfoUrl(host: string | undefined): string {
  return `${githubApiUrl(host)}/user`;
}

/** Git HTTPS base. This is the value `FOUNDRY_GIT_BASE` overrides. */
export function githubGitBase(host: string | undefined): string {
  return normalizeGitHubHost(host);
}

export function githubIssueUrl(host: string | undefined, fullName: string, number: number): string {
  return `${normalizeGitHubHost(host)}/${fullName}/issues/${number}`;
}

export function githubInstallUrl(host: string | undefined, slug: string): string {
  return `${normalizeGitHubHost(host)}/apps/${slug}/installations/new`;
}

export interface GitHubHostConfig {
  /** Web origin (`GITHUB_HOST`, or https://github.com). */
  host: string;
  /** REST API base (no trailing slash), `GITHUB_API_URL` override applied. */
  apiUrl: string;
  /** Git HTTPS base (no trailing slash), `FOUNDRY_GIT_BASE` override applied. */
  gitBase: string;
}

/** Resolve the active GitHub host and its derived URLs from the environment. */
export function resolveGitHubHostConfig(env: NodeJS.ProcessEnv = process.env): GitHubHostConfig {
  const host = normalizeGitHubHost(env.GITHUB_HOST);
  const apiUrl = trimTrailingSlash(env.GITHUB_API_URL || githubApiUrl(host));
  const gitBase = trimTrailingSlash(env.FOUNDRY_GIT_BASE || githubGitBase(host));
  return { host, apiUrl, gitBase };
}

const GITHUB_ENV_KEYS = ["GITHUB_HOST", "GITHUB_API_URL", "FOUNDRY_GIT_BASE"] as const;

/** Fill unset `GITHUB_HOST` / `GITHUB_API_URL` / `FOUNDRY_GIT_BASE` from a `.env` file body. */
export function loadGitHubEnvFromFile(contents: string, env: NodeJS.ProcessEnv = process.env): void {
  for (const line of contents.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    if (!(GITHUB_ENV_KEYS as readonly string[]).includes(key)) continue;
    if (env[key] !== undefined && env[key] !== "") continue;
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    env[key] = val;
  }
}
