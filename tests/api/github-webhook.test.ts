import { env } from "node:process";
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
