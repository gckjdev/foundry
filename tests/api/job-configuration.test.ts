import { jobDetail, repoPolicy } from "@foundry/control";
import { jobs } from "@foundry/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEnv, seedTeam, TEST_DATABASE_URL, type TestEnv } from "../helpers";

/**
 * The job configuration page is a Server Component whose Job limits form posts to the
 * `app/actions.ts` `jobLimitsAction` server action. This exercises the real save path against a
 * real database and then reads the values the page displays, so a save that does not persist fails
 * here. The form always submits both fields; each test overrides only the ones it cares about.
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

/** What the configuration page renders for this job. */
async function shownLimits(env: TestEnv, teamId: string, jobId: string) {
  const { jobLimitValues } = await import("@/app/(panel)/jobs/[id]/configuration/limits");
  const detail = await jobDetail(env.ctx, teamId, jobId);
  if (!detail) throw new Error("job disappeared");
  return jobLimitValues(detail.job, repoPolicy(detail.repo));
}

/** Submit the merged Job limits form, leaving untouched fields at their displayed values. */
async function submit(
  env: TestEnv,
  teamId: string,
  jobId: string,
  overrides: { maxMinutes?: string; maxCost?: string } = {},
) {
  const shown = await shownLimits(env, teamId, jobId);
  const form = new FormData();
  form.set("jobId", jobId);
  form.set("maxMinutes", overrides.maxMinutes ?? String(shown.maxJobMinutes));
  form.set("maxCost", overrides.maxCost ?? String(shown.maxCostUsd));
  const { jobLimitsAction } = await import("@/app/actions");
  await jobLimitsAction(form);
}

describe.skipIf(!TEST_DATABASE_URL)("job configuration page", () => {
  let env: TestEnv;
  let teamId: string;
  let jobId: string;

  beforeEach(async () => {
    env = await createTestEnv();
    const { team, repo } = await seedTeam(env);
    state.env = env;
    state.team = team;
    teamId = team.id;
    const [job] = await env.ctx.db
      .insert(jobs)
      .values({
        teamId: team.id,
        repoId: repo.id,
        title: "Job limits",
        harness: "claude-code",
        branch: `foundry/${crypto.randomUUID()}`,
        status: "queued",
      })
      .returning();
    jobId = job!.id;
  });

  afterEach(async () => {
    await env.drop();
  });

  it("saves a custom max execution time and shows it on the page", async () => {
    const before = await shownLimits(env, teamId, jobId);
    await submit(env, teamId, jobId, { maxMinutes: "90" });

    const shown = await shownLimits(env, teamId, jobId);
    expect(shown.maxJobMinutes).toBe(90);
    expect(shown.maxCostUsd).toBe(before.maxCostUsd);
    expect(shown.limitsKey).toBe(`limits:90:${before.maxCostUsd}`);
  });

  it("saves a custom max cost and shows it on the page", async () => {
    const before = await shownLimits(env, teamId, jobId);
    await submit(env, teamId, jobId, { maxCost: "18.5" });

    const shown = await shownLimits(env, teamId, jobId);
    expect(shown.maxCostUsd).toBe(18.5);
    expect(shown.maxJobMinutes).toBe(before.maxJobMinutes);
    expect(shown.limitsKey).toBe(`limits:${before.maxJobMinutes}:18.5`);
  });

  it("saves both limits with the single Save button", async () => {
    await submit(env, teamId, jobId, { maxMinutes: "90", maxCost: "18.5" });

    const shown = await shownLimits(env, teamId, jobId);
    expect(shown.maxJobMinutes).toBe(90);
    expect(shown.maxCostUsd).toBe(18.5);
    expect(shown.limitsKey).toBe("limits:90:18.5");
  });

  it("clears an override when its field is emptied and keeps the other saved limit", async () => {
    const before = await shownLimits(env, teamId, jobId);
    await submit(env, teamId, jobId, { maxMinutes: "90", maxCost: "18.5" });
    await submit(env, teamId, jobId, { maxMinutes: "" });

    const shown = await shownLimits(env, teamId, jobId);
    expect(shown.maxJobMinutes).toBe(before.maxJobMinutes);
    expect(shown.maxCostUsd).toBe(18.5);
    expect(shown.limitsKey).toBe("limits:policy:18.5");
  });

  it("keeps both saved values when an invalid value is submitted", async () => {
    await submit(env, teamId, jobId, { maxMinutes: "90", maxCost: "18.5" });
    await submit(env, teamId, jobId, { maxMinutes: "1.5", maxCost: "25" });
    await submit(env, teamId, jobId, { maxMinutes: "0" });

    const shown = await shownLimits(env, teamId, jobId);
    expect(shown.maxJobMinutes).toBe(90);
    expect(shown.maxCostUsd).toBe(18.5);
  });
});
