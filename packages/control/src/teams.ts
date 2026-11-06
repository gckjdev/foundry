import { invites, memberships, type Repo, repos, teams, type User, users } from "@foundry/db";
import { TRIGGER_LABEL } from "@foundry/shared";
import { and, eq, inArray } from "drizzle-orm";
import { bestEffort, type ControlContext } from "./context";
import { repoRef } from "./github-sync";
import { refreshRepoConfig } from "./repos";

export class ForbiddenError extends Error {}

export interface GitHubProfile {
  ghLogin: string;
  ghId?: number | null;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
}

/** Create or update the user on sign-in and accept any pending invites for their login. */
export async function upsertUser(ctx: ControlContext, profile: GitHubProfile): Promise<User> {
  const values = {
    ghLogin: profile.ghLogin.toLowerCase(),
    ghId: profile.ghId ?? null,
    email: profile.email ?? null,
    name: profile.name ?? null,
    avatarUrl: profile.avatarUrl ?? null,
  };
  const [user] = await ctx.db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({ target: users.ghLogin, set: { ghId: values.ghId, name: values.name, avatarUrl: values.avatarUrl } })
    .returning();
  const pending = await ctx.db.select().from(invites).where(eq(invites.ghLogin, profile.ghLogin.toLowerCase()));
  for (const invite of pending) {
    await ctx.db
      .insert(memberships)
      .values({ teamId: invite.teamId, userId: user!.id, role: invite.role })
      .onConflictDoNothing();
    await ctx.db.delete(invites).where(eq(invites.id, invite.id));
  }
  return user!;
}

export async function createTeam(ctx: ControlContext, userId: string, name: string) {
  const [team] = await ctx.db.insert(teams).values({ name }).returning();
  await ctx.db.insert(memberships).values({ teamId: team!.id, userId, role: "admin" });
  return team!;
}

export async function teamsForUser(ctx: ControlContext, userId: string) {
  const rows = await ctx.db
    .select({ team: teams, role: memberships.role })
    .from(memberships)
    .innerJoin(teams, eq(teams.id, memberships.teamId))
    .where(eq(memberships.userId, userId));
  return rows;
}

export async function membership(ctx: ControlContext, userId: string, teamId: string) {
  return ctx.db.query.memberships.findFirst({
    where: and(eq(memberships.userId, userId), eq(memberships.teamId, teamId)),
  });
}

export async function requireMember(ctx: ControlContext, userId: string, teamId: string, role?: "admin") {
  const m = await membership(ctx, userId, teamId);
  if (!m || (role === "admin" && m.role !== "admin")) throw new ForbiddenError("not allowed");
  return m;
}

export async function inviteMember(ctx: ControlContext, teamId: string, ghLogin: string, role = "member") {
  const login = ghLogin.replace(/^@/, "").trim().toLowerCase();
  const existing = await ctx.db.query.users.findFirst({ where: eq(users.ghLogin, login) });
  if (existing) {
    await ctx.db.insert(memberships).values({ teamId, userId: existing.id, role }).onConflictDoNothing();
    return { added: true as const };
  }
  await ctx.db.insert(invites).values({ teamId, ghLogin: login, role });
  return { added: false as const };
}

export async function teamMembers(ctx: ControlContext, teamId: string) {
  return ctx.db
    .select({ user: users, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.teamId, teamId));
}

/** GitHub App install callback: attach every repo the installation can see to the team. */
export async function linkInstallation(ctx: ControlContext, teamId: string, installationId: number): Promise<Repo[]> {
  const list = await ctx.gh.listInstallationRepos(installationId);
  const out: Repo[] = [];
  for (const r of list) {
    const [row] = await ctx.db
      .insert(repos)
      .values({ teamId, ghInstallationId: installationId, ghRepoId: r.id, fullName: r.fullName, defaultBranch: r.defaultBranch })
      .onConflictDoUpdate({
        target: repos.ghRepoId,
        set: { teamId, ghInstallationId: installationId, fullName: r.fullName, defaultBranch: r.defaultBranch },
      })
      .returning();
    out.push(row!);
    await bestEffort(ctx, "ensure label", () =>
      ctx.gh.ensureLabel(repoRef(row!), TRIGGER_LABEL, "6f42c1", "Hand this issue to Foundry"),
    );
    await bestEffort(ctx, "refresh repo config", () => refreshRepoConfig(ctx, row!));
  }
  return out;
}

/** Drop repos an installation no longer covers (installation_repositories.removed). */
export async function unlinkRepos(ctx: ControlContext, ghRepoIds: number[]) {
  if (ghRepoIds.length === 0) return;
  await ctx.db.delete(repos).where(inArray(repos.ghRepoId, ghRepoIds));
}
