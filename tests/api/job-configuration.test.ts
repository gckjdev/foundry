import { jobDetail, repoPolicy } from "@foundry/control";
import { jobs } from "@foundry/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEnv, seedTeam, TEST_DATABASE_URL, type TestEnv } from "../helpers";

/**
 * The job configuration page is a Server Component whose forms post to the `app/actions.ts`
 * server actions. This exercises the real save path against a real database and then reads the
 * values the page displays, so a save that does not persist fails here.
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

async function submit(jobId: string, fields: Record<string, string>) {
  const form = new FormData();
  form.set("jobId", jobId);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const { maxMinutesAction, maxCostAction } = await import("@/app/actions");
  if (fields.maxMinutes !== undefined) await maxMinutesAction(form);
  else if (fields.maxCost !== undefined) await maxCostAction(form);
  else throw new Error("pick a limit form");
}

/** What the configuration page renders for this job. */
async function shownLimits(env: TestEnv, teamId: string, jobId: string) {
  const { jobLimitValues } = await import("@/app/(panel)/jobs/[id]/configuration/limits");
  const detail = await jobDetail(env.ctx, teamId, jobId);
  if (!detail) throw new Error("job disappeared");
  return jobLimitValues(detail.job, repoPolicy(detail.repo));
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
    await submit(jobId, { maxMinutes: "90" });

    const shown = await shownLimits(env, teamId, jobId);
    expect(shown.maxJobMinutes).toBe(90);
    expect(shown.minutesKey).toBe("minutes:90");
  });

  it("saves a custom max cost and shows it on the page", async () => {
    await submit(jobId, { maxCost: "18.5" });

    const shown = await shownLimits(env, teamId, jobId);
    expect(shown.maxCostUsd).toBe(18.5);
    expect(shown.costKey).toBe("cost:18.5");
  });

  it("clears the override when the field is emptied and falls back to the policy", async () => {
    const policyMaxMinutes = (await shownLimits(env, teamId, jobId)).maxJobMinutes;
    await submit(jobId, { maxMinutes: "90" });
    await submit(jobId, { maxMinutes: "" });

    const shown = await shownLimits(env, teamId, jobId);
    expect(shown.maxJobMinutes).toBe(policyMaxMinutes);
    expect(shown.minutesKey).toBe("minutes:policy");
  });

  it("keeps the saved value when an invalid value is submitted", async () => {
    await submit(jobId, { maxMinutes: "90" });
    await submit(jobId, { maxMinutes: "1.5" });
    await submit(jobId, { maxMinutes: "0" });

    expect((await shownLimits(env, teamId, jobId)).maxJobMinutes).toBe(90);
  });
});
