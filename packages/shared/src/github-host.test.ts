import { describe, expect, it } from "vitest";
import {
  githubApiUrl,
  githubGitBase,
  githubGraphqlUrl,
  githubInstallUrl,
  githubIssueUrl,
  githubOAuthAuthorizeUrl,
  githubOAuthTokenUrl,
  githubUserInfoUrl,
  loadGitHubEnvFromFile,
  normalizeGitHubHost,
  resolveGitHubHostConfig,
} from "./github-host";

describe("github host URLs", () => {
  it("special-cases github.com (api.github.com, not github.com/api/v3)", () => {
    expect(normalizeGitHubHost(undefined)).toBe("https://github.com");
    expect(normalizeGitHubHost("")).toBe("https://github.com");
    expect(normalizeGitHubHost("https://github.com/")).toBe("https://github.com");
    expect(githubApiUrl(undefined)).toBe("https://api.github.com");
    expect(githubApiUrl("https://github.com")).toBe("https://api.github.com");
    expect(githubGraphqlUrl(undefined)).toBe("https://api.github.com/graphql");
    expect(githubUserInfoUrl(undefined)).toBe("https://api.github.com/user");
    expect(githubOAuthAuthorizeUrl(undefined)).toBe("https://github.com/login/oauth/authorize");
    expect(githubOAuthTokenUrl(undefined)).toBe("https://github.com/login/oauth/access_token");
    expect(githubGitBase(undefined)).toBe("https://github.com");
    expect(githubIssueUrl(undefined, "acme/app", 7)).toBe("https://github.com/acme/app/issues/7");
    expect(githubInstallUrl(undefined, "foundry-app")).toBe(
      "https://github.com/apps/foundry-app/installations/new",
    );
  });

  it("derives GHES URLs from the host", () => {
    const host = "https://github.example.com";
    expect(normalizeGitHubHost(`${host}/`)).toBe(host);
    expect(githubApiUrl(host)).toBe(`${host}/api/v3`);
    expect(githubGraphqlUrl(host)).toBe(`${host}/api/graphql`);
    expect(githubUserInfoUrl(host)).toBe(`${host}/api/v3/user`);
    expect(githubOAuthAuthorizeUrl(host)).toBe(`${host}/login/oauth/authorize`);
    expect(githubOAuthTokenUrl(host)).toBe(`${host}/login/oauth/access_token`);
    expect(githubGitBase(host)).toBe(host);
    expect(githubIssueUrl(host, "acme/app", 7)).toBe(`${host}/acme/app/issues/7`);
    expect(githubInstallUrl(host, "foundry-app")).toBe(`${host}/apps/foundry-app/installations/new`);
  });

  it("applies GITHUB_API_URL and FOUNDRY_GIT_BASE overrides", () => {
    expect(
      resolveGitHubHostConfig({
        GITHUB_HOST: "https://github.example.com",
      }),
    ).toEqual({
      host: "https://github.example.com",
      apiUrl: "https://github.example.com/api/v3",
      gitBase: "https://github.example.com",
    });

    expect(
      resolveGitHubHostConfig({
        GITHUB_HOST: "https://github.example.com",
        GITHUB_API_URL: "https://api.example.com/v3",
        FOUNDRY_GIT_BASE: "file:///tmp/repos",
      }),
    ).toEqual({
      host: "https://github.example.com",
      apiUrl: "https://api.example.com/v3",
      gitBase: "file:///tmp/repos",
    });

    // github.com default remains api.github.com when no overrides are present.
    expect(resolveGitHubHostConfig({})).toEqual({
      host: "https://github.com",
      apiUrl: "https://api.github.com",
      gitBase: "https://github.com",
    });
  });

  it("loads only GitHub host keys from a .env body without overriding", () => {
    const env: NodeJS.ProcessEnv = { GITHUB_HOST: "https://already.set", AUTH_SECRET: "keep" };
    loadGitHubEnvFromFile(
      [
        "# comment",
        "GITHUB_HOST=https://github.example.com",
        "GITHUB_API_URL=https://api.example.com/v3",
        "FOUNDRY_GIT_BASE=file:///tmp/repos",
        "AUTH_SECRET=nope",
      ].join("\n"),
      env,
    );
    expect(env.GITHUB_HOST).toBe("https://already.set");
    expect(env.GITHUB_API_URL).toBe("https://api.example.com/v3");
    expect(env.FOUNDRY_GIT_BASE).toBe("file:///tmp/repos");
    expect(env.AUTH_SECRET).toBe("keep");
  });
});
