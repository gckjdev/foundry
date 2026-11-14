import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, HttpControlPlane, JobRevokedError, joinControlPlane } from "./api";

const heartbeat = {
  realtimeUrl: "ws://localhost:3001",
  realtimeToken: "rt",
  draining: false,
  revokedJobIds: [],
  keepJobIds: [],
  repos: [],
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("HttpControlPlane", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("joins and calls every runner endpoint", async () => {
    const seen: { url: string; method: string; body: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        seen.push({ url, method: init.method ?? "GET", body: init.body ? String(init.body) : null });
        if (url.endsWith("/join")) return json(200, { runnerId: "r1", runnerToken: "fdr_x", teamId: "t1" });
        if (url.endsWith("/heartbeat")) return json(200, heartbeat);
        if (url.endsWith("/claim")) return json(200, { job: null });
        if (url.endsWith("/readiness")) return json(200, { ok: true });
        if (url.endsWith("/git-token"))
          return json(200, { token: "ghs_x", expiresAt: "2099-01-01T00:00:00Z" });
        if (url.endsWith("/artifacts")) return json(200, { artifactId: "a1", url: "https://f/a1" });
        if (url.endsWith("/stage")) return json(200, { status: "investigating" });
        if (url.endsWith("/ask")) return json(200, { questionId: "q1" });
        if (url.endsWith("/evidence")) return json(200, { id: "e1" });
        if (url.endsWith("/pr")) return json(200, { prNumber: 3, url: "https://github.com/acme/app/pull/3" });
        if (url.endsWith("/inputs"))
          return json(200, { inputs: [{ kind: "message", text: "go", by: "alice" }] });
        return json(200, { ok: true });
      }),
    );

    const joined = await joinControlPlane("http://localhost:3000/", {
      joinToken: "fdj_x",
      name: "mbp",
      kind: "personal",
      os: "macos",
      arch: "arm64",
      osVersion: "15",
      cpu: 8,
      memMb: 16000,
      maxConcurrency: 1,
    });
    expect(joined.runnerToken).toBe("fdr_x");

    const api = new HttpControlPlane("http://localhost:3000/", "fdr_x");
    expect(
      (
        await api.heartbeat({
          cpu: 8,
          memMb: 16000,
          diskFreeMb: 1000,
          onAcPower: true,
          accepting: true,
          runningJobIds: [],
          harnesses: [],
          maxConcurrency: 1,
          version: "0",
        })
      ).draining,
    ).toBe(false);
    expect(await api.claim()).toBeNull();
    await api.readiness({ repoId: "repo", recipeSha: null, ready: true, reason: null });
    expect((await api.gitToken("repo")).token).toBe("ghs_x");
    expect((await api.uploadArtifact("job", "shot.png", "image/png", new Uint8Array([1]))).artifactId).toBe(
      "a1",
    );
    const events = Array.from({ length: 201 }, () => ({
      kind: "log" as const,
      level: "info" as const,
      message: "x",
    }));
    await api.events("job id", events);
    expect(seen.filter((s) => s.url.includes("/events"))).toHaveLength(2);
    expect(await api.stage("job", { to: "investigating" })).toEqual({ status: "investigating" });
    expect(await api.ask("job", "?", [])).toEqual({ questionId: "q1" });
    expect(await api.evidence("job", { kind: "note", name: "n", status: "passed" })).toEqual({ id: "e1" });
    await api.confidence("job", { level: "high", reasons: ["ok"], uncertainties: [] });
    await api.plan("job", "1. done");
    await api.checkpoint("job", { stage: "implementing", sessionId: null, briefRef: "b", headSha: null });
    expect(
      (
        await api.openPr("job", {
          title: "t",
          summary: "s",
          headSha: "abc",
          uiChanged: false,
          changedLines: 1,
        })
      ).prNumber,
    ).toBe(3);
    await api.onboarding("job", { ok: true, reason: null, headSha: "abc", summary: "s" });
    expect(await api.inputs("job")).toEqual([{ kind: "message", text: "go", by: "alice" }]);
    expect(seen.some((s) => s.url.includes("/jobs/job%20id/"))).toBe(true);
  });

  it("turns HTTP 409 into JobRevokedError and other failures into ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/claim")) return json(409, { error: "revoked" });
        if (String(url).endsWith("/heartbeat")) return json(500, {});
        return json(200, {});
      }),
    );
    const api = new HttpControlPlane("http://localhost:3000", "fdr_x");
    await expect(api.claim()).rejects.toBeInstanceOf(JobRevokedError);
    await expect(
      api.heartbeat({
        cpu: 1,
        memMb: 1,
        diskFreeMb: 1,
        onAcPower: null,
        accepting: true,
        runningJobIds: [],
        harnesses: [],
        maxConcurrency: 1,
        version: "0",
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("keeps the control plane's error text on ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(401, { error: "join token expired" })),
    );
    const err = await joinControlPlane("http://localhost:3000", {
      joinToken: "fdj_x",
      name: "mbp",
      kind: "personal",
      os: "macos",
      arch: "arm64",
      osVersion: "15",
      cpu: 8,
      memMb: 16000,
      maxConcurrency: 1,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, detail: "join token expired" });
  });
});
