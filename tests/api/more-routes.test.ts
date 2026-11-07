import {
  artifactUrl,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  storeArtifact,
  UnauthorizedError,
} from "@foundry/control";
import { InvalidTransitionError, JoinRequestSchema } from "@foundry/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestEnv, jsonRequest, readJson, seedTeam, TEST_DATABASE_URL, type TestEnv } from "../helpers";

describe("errorResponse", () => {
  it("maps control-plane errors onto HTTP status codes", async () => {
    const { errorResponse } = await import("@/server/http");
    const parsed = JoinRequestSchema.safeParse({});
    if (parsed.success) throw new Error("expected an invalid join body");
    expect((await readJson(errorResponse(parsed.error))).status).toBe(400);
    expect((await readJson(errorResponse(new UnauthorizedError("no")))).status).toBe(401);
    expect((await readJson(errorResponse(new ForbiddenError("no")))).status).toBe(403);
    expect((await readJson(errorResponse(new NotFoundError("no")))).status).toBe(404);
    expect((await readJson(errorResponse(new ConflictError("moved")))).status).toBe(409);
    expect((await readJson(errorResponse(new InvalidTransitionError("queued", "merged")))).status).toBe(409);
    expect((await readJson(errorResponse(new Error("boom")))).status).toBe(500);
  });
});

describe("GET /install.sh", () => {
  it("returns a shell script that mentions the public URL", async () => {
    const prev = process.env.FOUNDRY_PUBLIC_URL;
    process.env.FOUNDRY_PUBLIC_URL = "http://localhost:3000";
    try {
      const { GET } = await import("@/app/install.sh/route");
      const res = await GET();
      expect(res.headers.get("content-type")).toContain("text/x-shellscript");
      expect(await res.text()).toContain("http://localhost:3000");
    } finally {
      if (prev === undefined) delete process.env.FOUNDRY_PUBLIC_URL;
      else process.env.FOUNDRY_PUBLIC_URL = prev;
    }
  });
});

describe.skipIf(!TEST_DATABASE_URL)("more HTTP routes", () => {
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

  it("serves a signed artifact and 404s otherwise", async () => {
    const { team } = await seedTeam(testEnv);
    const row = await storeArtifact(testEnv.ctx, {
      teamId: team.id,
      jobId: null,
      name: "note.txt",
      contentType: "text/plain",
      bytes: new TextEncoder().encode("hello"),
    });
    const token = new URL(artifactUrl(testEnv.ctx, row.id)).searchParams.get("t")!;
    const { GET } = await import("@/app/api/artifacts/[id]/route");
    const ok = await GET(new Request(`http://foundry.test/api/artifacts/${row.id}?t=${token}`), {
      params: Promise.resolve({ id: row.id }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("hello");
    const missing = await GET(new Request("http://foundry.test/api/artifacts/nope"), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(missing.status).toBe(404);
  });

  it("rejects an unknown runner job action", async () => {
    const { POST } = await import("@/app/api/runner/jobs/[id]/[action]/route");
    const res = await readJson(
      await POST(jsonRequest("http://foundry.test/api/runner/jobs/x/nope", { body: {} }), {
        params: Promise.resolve({ id: "x", action: "nope" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("rejects a runner job action without a bearer token", async () => {
    const { POST } = await import("@/app/api/runner/jobs/[id]/[action]/route");
    const res = await readJson(
      await POST(
        jsonRequest("http://foundry.test/api/runner/jobs/x/events", {
          body: { events: [{ kind: "log", level: "info", message: "hi" }] },
        }),
        { params: Promise.resolve({ id: "x", action: "events" }) },
      ),
    );
    expect(res.status).toBe(401);
  });
});
