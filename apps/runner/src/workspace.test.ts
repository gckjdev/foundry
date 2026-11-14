import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitFixture } from "./testing";
import { remoteUrl, Workspace } from "./workspace";

const prev = {
  FOUNDRY_GIT_BASE: process.env.FOUNDRY_GIT_BASE,
  GITHUB_HOST: process.env.GITHUB_HOST,
};

afterEach(() => {
  if (prev.FOUNDRY_GIT_BASE === undefined) delete process.env.FOUNDRY_GIT_BASE;
  else process.env.FOUNDRY_GIT_BASE = prev.FOUNDRY_GIT_BASE;
  if (prev.GITHUB_HOST === undefined) delete process.env.GITHUB_HOST;
  else process.env.GITHUB_HOST = prev.GITHUB_HOST;
});

describe("remoteUrl", () => {
  it("defaults to github.com", () => {
    delete process.env.FOUNDRY_GIT_BASE;
    delete process.env.GITHUB_HOST;
    expect(remoteUrl("acme/app")).toBe("https://github.com/acme/app.git");
  });

  it("uses GITHUB_HOST when FOUNDRY_GIT_BASE is unset", () => {
    delete process.env.FOUNDRY_GIT_BASE;
    process.env.GITHUB_HOST = "https://github.example.com";
    expect(remoteUrl("acme/app")).toBe("https://github.example.com/acme/app.git");
  });

  it("lets FOUNDRY_GIT_BASE win over GITHUB_HOST", () => {
    process.env.FOUNDRY_GIT_BASE = "file:///tmp/repos";
    process.env.GITHUB_HOST = "https://github.example.com";
    expect(remoteUrl("acme/app")).toBe("file:///tmp/repos/acme/app.git");
  });
});

describe("ensureMirror", () => {
  it("shares one in-flight fetch between concurrent callers", async () => {
    const workspace = new Workspace(mkdtempSync(join(tmpdir(), "foundry-mirror-")));
    const mirror = workspace.mirrorPath("acme/app");
    let fetches = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi
      .spyOn(
        Workspace.prototype as unknown as {
          fetchMirror(fullName: string, mirror: string, token?: string): Promise<string>;
        },
        "fetchMirror",
      )
      .mockImplementation(async () => {
        fetches++;
        await gate;
        return mirror;
      });

    try {
      const first = workspace.ensureMirror("acme/app", "token");
      const second = workspace.ensureMirror("acme/app", "token");
      release();
      expect(await first).toBe(mirror);
      expect(await second).toBe(mirror);
      expect(fetches).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("createWorktree", () => {
  it("clears a leftover directory before checking out the branch", async () => {
    const fixture = createGitFixture();
    fixture.seedRepo("acme/app", { "README.md": "# app\n" });
    process.env.FOUNDRY_GIT_BASE = fixture.base;
    const workspace = new Workspace(mkdtempSync(join(tmpdir(), "foundry-ws-")));
    const jobId = "job-1";

    // Simulate a stale directory left by a prior run that git no longer tracks.
    const path = workspace.worktreePath(jobId);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "stale.txt"), "leftover\n");

    const cwd = await workspace.createWorktree({
      fullName: "acme/app",
      jobId,
      branch: "foundry/job-1",
      defaultBranch: "main",
    });

    expect(cwd).toBe(path);
    expect(readFileSync(join(path, "README.md"), "utf8")).toBe("# app\n");
    expect(() => readFileSync(join(path, "stale.txt"))).toThrow();
  });
});
