import { gitProxyArgs, httpProxyEnv } from "@foundry/shared/proxy";
import { describe, expect, it } from "vitest";
import { authArgs, GitError, git, gitRemoteUsesHttpProxy } from "./git";

describe("git proxy", () => {
  it("auth header does not put the token on the argv the user sees in errors", () => {
    const args = authArgs("ghs_testtoken");
    expect(args[0]).toBe("-c");
    expect(args[1]).toMatch(/^http\.extraheader=AUTHORIZATION: basic /);
    expect(args.join(" ")).not.toContain("ghs_testtoken");
  });

  it("passes FOUNDRY_HTTP_PROXY through to git env and -c flags", () => {
    const env = { FOUNDRY_HTTP_PROXY: "http://127.0.0.1:8118" };
    expect(httpProxyEnv({ env })).toMatchObject({
      HTTPS_PROXY: "http://127.0.0.1:8118",
      HTTP_PROXY: "http://127.0.0.1:8118",
    });
    expect(gitProxyArgs({ env })).toEqual([
      "-c",
      "http.proxy=http://127.0.0.1:8118",
      "-c",
      "https.proxy=http://127.0.0.1:8118",
      "-c",
      "http.version=HTTP/1.1",
    ]);
  });

  it("does not fail when git exits before consuming stdin", async () => {
    // `git version` reads no stdin, so a large write lands after the child closed the pipe.
    // Without a stdin error handler this surfaces as an uncaught EPIPE.
    const result = await git(["version"], { cwd: process.cwd(), input: "x".repeat(100_000) });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("git version");
  });

  it("does not proxy file:// git remotes used in tests", () => {
    expect(gitRemoteUsesHttpProxy("file:///tmp/foundry-git")).toBe(false);
    expect(gitRemoteUsesHttpProxy("https://github.com")).toBe(true);
    expect(gitRemoteUsesHttpProxy(undefined)).toBe(true);
  });
});

describe("GitError", () => {
  it("explains GitHub App workflow-file rejections", () => {
    const err = new GitError(["push", "--quiet", "origin", "HEAD:refs/heads/foundry/x"], {
      code: 1,
      stdout: "",
      stderr:
        "remote rejected HEAD -> foundry/x (refusing to allow a GitHub App to create or update workflow `.github/workflows/ci.yml` without `workflows` permission)",
    });
    expect(err.message).toContain("Workflows: Read and write");
    expect(err.message).toMatch(/accept the updated permissions on the installation/i);
  });
});
