import { repos } from "@foundry/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEnv, seedTeam, TEST_DATABASE_URL, type TestEnv } from "../helpers";

/**
 * The Repos page settings form posts to the `app/actions.ts` `repoSettingsAction` server action and
 * shows a toast from its result, so the action has to resolve only after the settings are written
 * and report `{ ok: true }`. These tests submit the form fields the way the client component does
 * and read the persisted row back, so a save that does not persist fails here.
 */

const state = vi.hoisted(() => ({
  env: null as unknown as TestEnv,
  team: null as unknown as { id: string },
}));

vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/server/context", () => ({ getContext: async () => state.env.ctx }));
vi.mock("@/server/session", () => {
  const session = async () => ({
    ctx: state.env.ctx,
    team: state.team,
    user: { id: "user-1", login: "alice" },
    role: "admin",
    teams: [],
  });
  return { requireTeam: session, requireUser: session, requireAdmin: session };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

type Settings = { mergeMode: string; defaultHarness: string; defaultModel: string; ghProjectId: string };

const DEFAULT_SETTINGS: Settings = {
  mergeMode: "off",
  defaultHarness: "",
  defaultModel: "",
  ghProjectId: "",
};

/** Submit the settings form with every field, as the client component does. */
async function submit(repoId: string, overrides: Partial<Settings> = {}) {
  const values = { ...DEFAULT_SETTINGS, ...overrides };
  const form = new FormData();
  form.set("repoId", repoId);
  form.set("mergeMode", values.mergeMode);
  form.set("defaultHarness", values.defaultHarness);
  form.set("defaultModel", values.defaultModel);
  form.set("ghProjectId", values.ghProjectId);
  const { repoSettingsAction } = await import("@/app/actions");
  return repoSettingsAction(form);
}

async function savedSettings(env: TestEnv, repoId: string) {
  const row = await env.ctx.db.query.repos.findFirst({ where: eq(repos.id, repoId) });
  if (!row) throw new Error("repo disappeared");
  return row;
}

describe.skipIf(!TEST_DATABASE_URL)("repo settings form", () => {
  let env: TestEnv;
  let repoId: string;

  beforeEach(async () => {
    env = await createTestEnv();
    const { team, repo } = await seedTeam(env);
    state.env = env;
    state.team = team;
    repoId = repo.id;
  });

  afterEach(async () => {
    await env.drop();
  });

  it("saves every field and reports ok", async () => {
    const result = await submit(repoId, {
      mergeMode: "merge_when_confident",
      defaultHarness: "claude-code",
      defaultModel: "deepseek/deepseek-chat",
      ghProjectId: "PVT_1",
    });
    expect(result).toEqual({ ok: true });

    const row = await savedSettings(env, repoId);
    expect(row.mergeMode).toBe("merge_when_confident");
    expect(row.defaultHarness).toBe("claude-code");
    expect(row.defaultModel).toBe("deepseek/deepseek-chat");
    expect(row.ghProjectId).toBe("PVT_1");
  });

  it("clears the optional fields when their inputs are emptied", async () => {
    await submit(repoId, {
      mergeMode: "merge_when_confident",
      defaultHarness: "claude-code",
      defaultModel: "deepseek/deepseek-chat",
      ghProjectId: "PVT_1",
    });
    const result = await submit(repoId);
    expect(result).toEqual({ ok: true });

    const row = await savedSettings(env, repoId);
    expect(row.mergeMode).toBe("off");
    expect(row.defaultHarness).toBeNull();
    expect(row.defaultModel).toBeNull();
    expect(row.ghProjectId).toBeNull();
  });

  it("falls back to handing over for an unknown merge mode", async () => {
    const result = await submit(repoId, { mergeMode: "auto" });
    expect(result).toEqual({ ok: true });
    expect((await savedSettings(env, repoId)).mergeMode).toBe("off");
  });
});
