import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReadinessReporter, type ReadinessResult } from "./readiness";
import { createGitFixture, RecordingControlPlane } from "./testing";
import { Workspace } from "./workspace";

const fixture = createGitFixture();
let prevBase: string | undefined;

beforeAll(() => {
  prevBase = process.env.FOUNDRY_GIT_BASE;
  process.env.FOUNDRY_GIT_BASE = fixture.base;
  fixture.seedRepo("acme/ok", {
    ".foundry/recipe.yaml": "checks: [{name: ok, run: 'true'}]\n",
  });
  fixture.seedRepo("acme/nope", {
    ".foundry/recipe.yaml": "checks: [{name: nope, run: 'false'}]\n",
  });
  fixture.seedRepo("acme/order", {
    ".foundry/recipe.yaml":
      "warm: ['echo warm >> order.txt']\n" +
      "install: echo install >> order.txt\n" +
      "checks: [{name: order, run: 'grep -q warm order.txt && grep -q install order.txt'}]\n",
  });
  fixture.seedRepo("acme/linux", {
    ".foundry/recipe.yaml": "os: [linux]\nchecks: [{name: ok, run: 'true'}]\n",
  });
  fixture.seedRepo("acme/missing", {
    ".foundry/recipe.yaml": "system_deps: [definitely-not-a-real-binary]\n",
  });
});

afterAll(() => {
  if (prevBase === undefined) delete process.env.FOUNDRY_GIT_BASE;
  else process.env.FOUNDRY_GIT_BASE = prevBase;
});

function makeReporter(api: RecordingControlPlane) {
  const root = mkdtempSync(join(tmpdir(), "foundry-readiness-"));
  return {
    root,
    reporter: new ReadinessReporter(api, new Workspace(root), "macos", { log: () => {} }),
  };
}

function repo(id: string, fullName: string, recipeSha = "sha-1") {
  return { id, fullName, defaultBranch: "main", recipeSha };
}

function lastReadiness(api: RecordingControlPlane): ReadinessResult & { repoId: string } {
  return api.named("readiness").at(-1)!.body as ReadinessResult & { repoId: string };
}

describe("ReadinessReporter", () => {
  it("reports ready after the recipe checks pass in a temporary worktree", async () => {
    const api = new RecordingControlPlane();
    const { root, reporter } = makeReporter(api);
    await reporter.sync([repo("repo-ok", "acme/ok")]);

    expect(lastReadiness(api)).toEqual({
      repoId: "repo-ok",
      recipeSha: "sha-1",
      ready: true,
      reason: null,
    });
    // The detached worktree is gone even on success.
    expect(readdirSync(join(root, "worktrees"))).toEqual([]);
  });

  it("runs warm, then install, then checks", async () => {
    const api = new RecordingControlPlane();
    const { reporter } = makeReporter(api);
    await reporter.sync([repo("repo-order", "acme/order")]);

    expect(lastReadiness(api)).toMatchObject({ ready: true, reason: null });
  });

  it("is not ready when a check fails, and names the check", async () => {
    const api = new RecordingControlPlane();
    const { root, reporter } = makeReporter(api);
    await reporter.sync([repo("repo-nope", "acme/nope")]);

    const result = lastReadiness(api);
    expect(result.ready).toBe(false);
    expect(result.reason).toContain("nope");
    expect(readdirSync(join(root, "worktrees"))).toEqual([]);
  });

  it("short-circuits on an os or PATH mismatch before creating a worktree", async () => {
    const api = new RecordingControlPlane();
    const { root, reporter } = makeReporter(api);
    await reporter.sync([repo("repo-linux", "acme/linux"), repo("repo-missing", "acme/missing")]);

    expect(api.named("readiness").map((c) => c.body)).toEqual([
      expect.objectContaining({ repoId: "repo-linux", ready: false, reason: "recipe is limited to linux" }),
      expect.objectContaining({
        repoId: "repo-missing",
        ready: false,
        reason: "missing: definitely-not-a-real-binary",
      }),
    ]);
    expect(existsSync(join(root, "worktrees"))).toBe(false);
  });

  it("only re-runs when the recipe sha changes", async () => {
    const api = new RecordingControlPlane();
    const { reporter } = makeReporter(api);
    const unchanged = repo("repo-cache", "acme/ok");

    await reporter.sync([unchanged]);
    await reporter.sync([unchanged]);
    expect(api.named("readiness")).toHaveLength(1);

    await reporter.sync([repo("repo-cache", "acme/ok", "sha-2")]);
    expect(api.named("readiness")).toHaveLength(2);
  });
});
