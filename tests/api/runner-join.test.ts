import { createJoinToken, joinRunner } from "@foundry/control";
import { VERSION } from "@foundry/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestEnv, jsonRequest, readJson, seedTeam, TEST_DATABASE_URL, type TestEnv } from "../helpers";

describe.skipIf(!TEST_DATABASE_URL)("runner HTTP API", () => {
  let testEnv: TestEnv;

  beforeEach(async () => {
    testEnv = await createTestEnv();
    const { setContextForTests } = await import("@/server/context");
    setContextForTests(testEnv.ctx);
  });

  afterEach(async () => {
    const { setContextForTests } = await import("@/server/context");
    setContextForTests(undefined);
    await testEnv.drop();
  });

  it("joins with a signed token and heartbeats", async () => {
    const { team, alice } = await seedTeam(testEnv);
    const joinToken = createJoinToken(testEnv.ctx, team.id, alice.id);
    const { POST: join } = await import("@/app/api/runner/join/route");
    const joined = await readJson(
      await join(
        jsonRequest("http://foundry.test/api/runner/join", {
          body: {
            joinToken,
            name: "alice-mbp",
            kind: "personal",
            os: "macos",
            arch: "arm64",
            osVersion: "15.1",
            cpu: 10,
            memMb: 32_000,
            maxConcurrency: 1,
          },
        }),
      ),
    );
    expect(joined.status).toBe(200);
    const body = joined.body as { runnerId: string; runnerToken: string; teamId: string };
    expect(body.teamId).toBe(team.id);
    expect(body.runnerToken).toMatch(/^fdr_/);

    const { POST: heartbeat } = await import("@/app/api/runner/heartbeat/route");
    const hb = await readJson(
      await heartbeat(
        jsonRequest("http://foundry.test/api/runner/heartbeat", {
          body: {
            cpu: 10,
            memMb: 32_000,
            diskFreeMb: 80_000,
            onAcPower: true,
            accepting: true,
            runningJobIds: [],
            harnesses: [{ id: "claude-code", installed: true, authOk: true }],
            maxConcurrency: 1,
            version: VERSION,
          },
          headers: { authorization: `Bearer ${body.runnerToken}` },
        }),
        { params: Promise.resolve({}) },
      ),
    );
    expect(hb.status).toBe(200);
    expect(hb.body).toMatchObject({ draining: false, revokedJobIds: [] });
  });

  it("rejects an invalid join body", async () => {
    const { POST } = await import("@/app/api/runner/join/route");
    const res = await readJson(await POST(jsonRequest("http://foundry.test/api/runner/join", { body: {} })));
    expect(res.status).toBe(400);
  });

  it("rejects a heartbeat without a bearer token", async () => {
    await seedTeam(testEnv);
    const { POST } = await import("@/app/api/runner/heartbeat/route");
    const res = await readJson(
      await POST(
        jsonRequest("http://foundry.test/api/runner/heartbeat", {
          body: {
            cpu: 1,
            memMb: 1024,
            diskFreeMb: 1,
            onAcPower: null,
            accepting: true,
            runningJobIds: [],
            harnesses: [],
            maxConcurrency: 1,
            version: VERSION,
          },
        }),
        { params: Promise.resolve({}) },
      ),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a claim without a bearer token", async () => {
    const { POST } = await import("@/app/api/runner/claim/route");
    const res = await readJson(
      await POST(jsonRequest("http://foundry.test/api/runner/claim", { body: {} }), {
        params: Promise.resolve({}),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("joinRunner still works when called directly (control plane)", async () => {
    const { team, alice } = await seedTeam(testEnv);
    const joined = await joinRunner(testEnv.ctx, {
      joinToken: createJoinToken(testEnv.ctx, team.id, alice.id),
      name: "direct",
      kind: "personal",
      os: "linux",
      arch: "x64",
      osVersion: "24.04",
      cpu: 4,
      memMb: 8_000,
      maxConcurrency: 1,
    });
    expect(joined.runnerId).toBeTruthy();
  });
});
