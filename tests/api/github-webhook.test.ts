import { env } from "node:process";
import { createLogger } from "@foundry/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestEnv,
  issueLabeledPayload,
  jsonRequest,
  readJson,
  seedTeam,
  signWebhookPayload,
  TEST_DATABASE_URL,
  type TestEnv,
} from "../helpers";
import { flushAfter } from "../shims/next-server";

const SECRET = "webhook-test-secret";

describe.skipIf(!TEST_DATABASE_URL)("POST /api/webhooks/github", () => {
  let testEnv: TestEnv;
  let prevSecret: string | undefined;

  beforeEach(async () => {
    prevSecret = env.GITHUB_WEBHOOK_SECRET;
    env.GITHUB_WEBHOOK_SECRET = SECRET;
    testEnv = await createTestEnv();
    const { setContextForTests } = await import("@/server/context");
    setContextForTests(testEnv.ctx);
  });

  afterEach(async () => {
    const { setContextForTests } = await import("@/server/context");
    setContextForTests(undefined);
    if (prevSecret === undefined) delete env.GITHUB_WEBHOOK_SECRET;
    else env.GITHUB_WEBHOOK_SECRET = prevSecret;
    await testEnv.drop();
  });

  it("rejects a bad signature", async () => {
    const { POST } = await import("@/app/api/webhooks/github/route");
    const res = await POST(
      jsonRequest("http://foundry.test/api/webhooks/github", {
        body: { ok: true },
        headers: {
          "x-hub-signature-256": "sha256=deadbeef",
          "x-github-event": "ping",
          "x-github-delivery": "d0",
        },
      }),
    );
    expect((await readJson(res)).status).toBe(401);
  });

  it("stores a labeled issue and creates one job", async () => {
    const { repo } = await seedTeam(testEnv);
    const records: Record<string, unknown>[] = [];
    testEnv.ctx.log = createLogger({
      service: "control",
      level: "debug",
      sink: (line) => records.push(JSON.parse(line)),
    });
    testEnv.gh.addIssue("acme/app", { number: 18, title: "Cover testing layers", labels: ["foundry"] });
    const payload = issueLabeledPayload({ number: 18, title: "Cover testing layers" });
    const raw = JSON.stringify(payload);
    const { POST } = await import("@/app/api/webhooks/github/route");
    const res = await POST(
      jsonRequest("http://foundry.test/api/webhooks/github", {
        body: payload,
        headers: {
          "x-hub-signature-256": await signWebhookPayload(SECRET, raw),
          "x-github-event": "issues",
          "x-github-delivery": "delivery-18",
        },
      }),
    );
    const first = await readJson(res);
    expect(first).toMatchObject({ status: 202, body: { ok: true, duplicate: false } });
    await flushAfter();
    const jobs = await testEnv.ctx.db.query.jobs.findMany();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ repoId: repo.id, issueNumber: 18, status: "queued" });

    // The trial journey logs its DB reads/writes and GitHub calls, all under one correlation id.
    expect(new Set(records.map((record) => record.correlationId)).size).toBe(1);
    expect(records.every((record) => typeof record.correlationId === "string")).toBe(true);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "database write", table: "webhook_inbox", operation: "insert" }),
        expect.objectContaining({ message: "database read", table: "jobs", operation: "findByIssue" }),
        expect.objectContaining({
          message: "database write",
          table: "jobs",
          operation: "insert",
          jobId: jobs[0]!.id,
        }),
        expect.objectContaining({
          message: "github api call",
          provider: "github",
          operation: "createComment",
        }),
      ]),
    );

    const dup = await POST(
      jsonRequest("http://foundry.test/api/webhooks/github", {
        body: payload,
        headers: {
          "x-hub-signature-256": await signWebhookPayload(SECRET, raw),
          "x-github-event": "issues",
          "x-github-delivery": "delivery-18",
        },
      }),
    );
    expect((await readJson(dup)).body).toMatchObject({ duplicate: true });
  });
});
