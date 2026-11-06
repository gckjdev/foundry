import { readFileSync } from "node:fs";
import { OctokitGitHubClient } from "./octokit";
import type { GitHubClient } from "./types";

export * from "./fake";
export * from "./octokit";
export * from "./types";
export * from "./webhooks";

const globalForGh = globalThis as unknown as { __foundryGitHub?: GitHubClient };

/** Process-wide GitHub App client built from GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY(_PATH). */
export function getGitHub(): GitHubClient {
  if (!globalForGh.__foundryGitHub) {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey =
      process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n") ??
      (process.env.GITHUB_APP_PRIVATE_KEY_PATH ? readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_PATH, "utf8") : "");
    if (!appId || !privateKey) throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY(_PATH) must be set");
    globalForGh.__foundryGitHub = new OctokitGitHubClient({ appId, privateKey });
  }
  return globalForGh.__foundryGitHub;
}

/** Tests and the e2e harness swap in a FakeGitHub here. */
export function setGitHub(client: GitHubClient): void {
  globalForGh.__foundryGitHub = client;
}
