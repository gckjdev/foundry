import { jobs, type Runner, repos, runnerRepoReadiness, runners } from "@foundry/db";
import {
  type HeartbeatRequest,
  type HeartbeatResponse,
  type JoinRequest,
  RUNNING_STATUSES,
  randomToken,
  type RealtimeClaims,
  sha256,
  signToken,
  verifyToken,
} from "@foundry/shared";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { ControlContext } from "./context";

interface JoinClaims {
  kind: "join";
  teamId: string;
  /** The member who created the token; owner of personal runners. */
  sub: string;
  exp: number;
}

const JOIN_TOKEN_TTL_S = 7 * 24 * 3600;
const REALTIME_TOKEN_TTL_S = 3600;

export class UnauthorizedError extends Error {}

/** Token shown in the panel for `foundry runner join <token>`. */
export function createJoinToken(ctx: ControlContext, teamId: string, userId: string): string {
  const claims: JoinClaims = {
    kind: "join",
    teamId,
    sub: userId,
    exp: Math.floor(ctx.now().getTime() / 1000) + JOIN_TOKEN_TTL_S,
  };
  return `fdj_${signToken(claims, ctx.secret)}`;
}

export async function joinRunner(ctx: ControlContext, req: JoinRequest) {
  const claims = verifyToken<JoinClaims>(req.joinToken.replace(/^fdj_/, ""), ctx.secret, ctx.now().getTime());
  if (!claims || claims.kind !== "join") throw new UnauthorizedError("invalid or expired join token");
  const runnerToken = randomToken("fdr");
  const values = {
    teamId: claims.teamId,
    ownerUserId: req.kind === "personal" ? claims.sub : null,
    name: req.name,
    kind: req.kind,
    os: req.os,
    arch: req.arch,
    osVersion: req.osVersion,
    cpu: req.cpu,
    memMb: req.memMb,
    maxConcurrency: req.maxConcurrency,
    tokenHash: sha256(runnerToken),
    status: "active",
    lastSeenAt: ctx.now(),
  };
  // Re-joining with the same name replaces the old registration (e.g. after a reinstall).
  const [runner] = await ctx.db
    .insert(runners)
    .values(values)
    .onConflictDoUpdate({ target: [runners.teamId, runners.name], set: values })
    .returning();
  return { runnerId: runner!.id, runnerToken, teamId: claims.teamId };
}

export async function authenticateRunner(ctx: ControlContext, authorization: string | null): Promise<Runner> {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new UnauthorizedError("missing runner token");
  const runner = await ctx.db.query.runners.findFirst({ where: eq(runners.tokenHash, sha256(token)) });
  if (!runner || runner.status === "removed") throw new UnauthorizedError("unknown runner token");
  return runner;
}

export function realtimeToken(ctx: ControlContext, claims: Omit<RealtimeClaims, "exp">): string {
  return signToken(
    { ...claims, exp: Math.floor(ctx.now().getTime() / 1000) + REALTIME_TOKEN_TTL_S } satisfies RealtimeClaims,
    ctx.secret,
  );
}

export async function heartbeat(ctx: ControlContext, runner: Runner, req: HeartbeatRequest): Promise<HeartbeatResponse> {
  await ctx.db
    .update(runners)
    .set({
      lastSeenAt: ctx.now(),
      cpu: req.cpu,
      memMb: req.memMb,
      diskFreeMb: req.diskFreeMb,
      onAcPower: req.onAcPower,
      accepting: req.accepting,
      notAcceptingReason: req.notAcceptingReason ?? null,
      harnesses: req.harnesses,
      maxConcurrency: req.maxConcurrency,
      version: req.version,
    })
    .where(eq(runners.id, runner.id));

  let revokedJobIds: string[] = [];
  if (req.runningJobIds.length > 0) {
    const mine = await ctx.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          inArray(jobs.id, req.runningJobIds),
          eq(jobs.runnerId, runner.id),
          inArray(jobs.status, [...RUNNING_STATUSES]),
        ),
      );
    const keep = new Set(mine.map((j) => j.id));
    revokedJobIds = req.runningJobIds.filter((id) => !keep.has(id));
  }

  const teamRepos = await ctx.db.select().from(repos).where(eq(repos.teamId, runner.teamId));
  return {
    realtimeUrl: ctx.realtimeUrl,
    realtimeToken: realtimeToken(ctx, { teamId: runner.teamId, sub: runner.id, kind: "runner" }),
    draining: runner.status === "draining",
    revokedJobIds,
    repos: teamRepos.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      defaultBranch: r.defaultBranch,
      recipeSha: r.recipeSha,
      acceptsJobs: r.acceptsJobs,
    })),
  };
}

export async function reportReadiness(
  ctx: ControlContext,
  runner: Runner,
  r: { repoId: string; recipeSha: string | null; ready: boolean; reason: string | null },
) {
  const repo = await ctx.db.query.repos.findFirst({ where: and(eq(repos.id, r.repoId), eq(repos.teamId, runner.teamId)) });
  if (!repo) throw new UnauthorizedError("repo not in runner's team");
  const values = { runnerId: runner.id, repoId: r.repoId, recipeSha: r.recipeSha, ready: r.ready, reason: r.reason, checkedAt: ctx.now() };
  await ctx.db
    .insert(runnerRepoReadiness)
    .values(values)
    .onConflictDoUpdate({ target: [runnerRepoReadiness.runnerId, runnerRepoReadiness.repoId], set: values });
}

export async function setRunnerStatus(ctx: ControlContext, runnerId: string, status: "active" | "draining" | "removed") {
  const [row] = await ctx.db.update(runners).set({ status }).where(eq(runners.id, runnerId)).returning();
  return row;
}

export async function teamRunners(ctx: ControlContext, teamId: string) {
  return ctx.db
    .select()
    .from(runners)
    .where(and(eq(runners.teamId, teamId), ne(runners.status, "removed")));
}
