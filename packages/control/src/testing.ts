import { repos, runnerRepoReadiness, runners, teams, users, memberships } from "@foundry/db";
import { createTestDatabase } from "@foundry/db/testing";
import { FakeGitHub } from "@foundry/github";
import { sha256 } from "@foundry/shared";
import { eq } from "drizzle-orm";
import type { ControlContext } from "./context";
import { MemoryNotifier } from "./notify";

export const TEST_RECIPE = `
install: pnpm install
checks:
  - name: test
    run: pnpm test
  - name: lint
    run: pnpm lint
`;

export interface TestEnv {
  ctx: ControlContext;
  gh: FakeGitHub;
  notifier: MemoryNotifier;
  clock: { now: Date; advance(ms: number): void };
  drop(): Promise<void>;
}

/** A migrated throwaway database plus FakeGitHub, a controllable clock and a memory notifier. */
export async function createTestEnv(): Promise<TestEnv> {
  const database = await createTestDatabase();
  const gh = new FakeGitHub();
  const notifier = new MemoryNotifier();
  const clock = {
    now: new Date("2026-03-02T10:00:00Z"),
    advance(ms: number) {
      clock.now = new Date(clock.now.getTime() + ms);
    },
  };
  const ctx: ControlContext = {
    db: database.db,
    sql: database.sql,
    gh,
    notifier,
    publicUrl: "https://foundry.test",
    realtimeUrl: "wss://foundry.test/realtime",
    secret: "test-secret",
    now: () => clock.now,
    log: () => {},
  };
  return { ctx, gh, notifier, clock, drop: database.drop };
}

/** Team "acme" with member alice, repo acme/app (onboarded with TEST_RECIPE) and no runners. */
export async function seedTeam(env: TestEnv, opts: { mergeMode?: string; policyYaml?: string } = {}) {
  const { ctx, gh } = env;
  const [team] = await ctx.db.insert(teams).values({ name: "acme" }).returning();
  const [alice] = await ctx.db.insert(users).values({ ghLogin: "alice", email: "alice@acme.test" }).returning();
  await ctx.db.insert(memberships).values({ teamId: team!.id, userId: alice!.id, role: "admin" });
  const [repo] = await ctx.db
    .insert(repos)
    .values({
      teamId: team!.id,
      ghInstallationId: 1,
      ghRepoId: 4242,
      fullName: "acme/app",
      acceptsJobs: true,
      recipeSha: "sha-recipe",
      recipeYaml: TEST_RECIPE,
      policyYaml: opts.policyYaml ?? null,
      mergeMode: opts.mergeMode ?? "off",
    })
    .returning();
  gh.repo("acme/app");
  return { team: team!, alice: alice!, repo: repo! };
}

export async function seedRunner(
  env: TestEnv,
  teamId: string,
  repoId: string,
  opts: { name: string; kind?: "shared" | "personal"; os?: "macos" | "linux"; ownerUserId?: string | null; harnesses?: string[] },
) {
  const { ctx } = env;
  const [runner] = await ctx.db
    .insert(runners)
    .values({
      teamId,
      name: opts.name,
      kind: opts.kind ?? "personal",
      os: opts.os ?? "macos",
      arch: "arm64",
      osVersion: "15.0",
      tokenHash: sha256(`token-${opts.name}`),
      lastSeenAt: ctx.now(),
      ownerUserId: opts.ownerUserId ?? null,
      harnesses: (opts.harnesses ?? ["claude-code", "opencode"]).map((id) => ({ id, installed: true, authOk: true })),
    })
    .returning();
  await ctx.db.insert(runnerRepoReadiness).values({ runnerId: runner!.id, repoId, recipeSha: "sha-recipe", ready: true });
  return runner!;
}

export async function touchRunner(env: TestEnv, runnerId: string) {
  await env.ctx.db.update(runners).set({ lastSeenAt: env.ctx.now() }).where(eq(runners.id, runnerId));
}

/** A recorded-shape `issues.labeled` webhook payload. */
export function issueLabeledPayload(opts: { number: number; title: string; body?: string; author?: string; labels?: string[] }) {
  const labels = opts.labels ?? ["foundry"];
  return {
    action: "labeled",
    label: { name: "foundry" },
    installation: { id: 1 },
    repository: { id: 4242, full_name: "acme/app", default_branch: "main" },
    sender: { login: opts.author ?? "alice", type: "User" },
    issue: {
      number: opts.number,
      title: opts.title,
      body: opts.body ?? "### Goal\n\nFix it\n\n### Acceptance criteria\n\nIt works",
      user: { login: opts.author ?? "alice" },
      labels: labels.map((name) => ({ name })),
    },
  };
}
