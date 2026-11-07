/**
 * Shared test kit for every layer. Prefer these helpers over ad-hoc Postgres/GitHub setup
 * so unit, API, and in-process e2e tests share the same fakes and fixtures.
 */
export {
  createTestEnv,
  issueLabeledPayload,
  seedRunner,
  seedTeam,
  TEST_RECIPE,
  type TestEnv,
} from "@foundry/control/testing";
export { createTestDatabase, TEST_DATABASE_URL } from "@foundry/db/testing";
export { FakeGitHub, signWebhookPayload } from "@foundry/github";
export { FakeHarness } from "@foundry/harness-core";
export { agentTools } from "@foundry/runner";

export async function readJson(res: Response): Promise<{ status: number; body: unknown }> {
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

export function jsonRequest(
  url: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers(opts.headers);
  if (opts.body !== undefined && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  return new Request(url, {
    method: opts.method ?? "POST",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}
