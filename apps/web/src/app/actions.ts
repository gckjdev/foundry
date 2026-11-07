"use server";

import {
  answerQuestion,
  cancelJob,
  createJoinToken,
  createTeam,
  getJob,
  inviteMember,
  linkInstallation,
  markQuestionHelpful,
  requireMember,
  retryJob,
  sendMessage,
  setRunnerStatus,
  startOnboarding,
  syncUnlinkedInstallations,
  updateRepoSettings,
} from "@foundry/control";
import { questions, repos, runners, teams, users } from "@foundry/db";
import { isRunnerStage } from "@foundry/shared";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { getContext } from "@/server/context";
import { INSTALL_COOKIE, requireAdmin, requireTeam, requireUser, TEAM_COOKIE } from "@/server/session";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function signInAction() {
  await signIn("github", { redirectTo: "/api/github/setup" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}

export async function createTeamAction(form: FormData) {
  const user = await requireUser();
  const name = str(form, "name");
  if (!name) return;
  const team = await createTeam(await getContext(), user.id, name);
  const jar = await cookies();
  jar.set(TEAM_COOKIE, team.id, { httpOnly: true, sameSite: "lax", path: "/" });
  const ctx = await getContext();
  const installationId = Number(jar.get(INSTALL_COOKIE)?.value);
  try {
    if (Number.isInteger(installationId) && installationId > 0) {
      await linkInstallation(ctx, team.id, installationId);
      jar.delete(INSTALL_COOKIE);
    }
    await syncUnlinkedInstallations(ctx, team.id);
  } catch (err) {
    console.error("[foundry] GitHub installation sync after create team failed", err);
  }
  redirect("/repos");
}

export async function syncReposAction() {
  const { ctx, team } = await requireAdmin();
  await syncUnlinkedInstallations(ctx, team.id);
  revalidatePath("/repos");
  redirect("/repos?installed=1");
}

export async function switchTeamAction(form: FormData) {
  const { ctx, user } = await requireTeam();
  const teamId = str(form, "teamId");
  await requireMember(ctx, user.id, teamId);
  (await cookies()).set(TEAM_COOKIE, teamId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/board");
}

async function teamJob(jobId: string) {
  const s = await requireTeam();
  const job = await getJob(s.ctx, jobId);
  if (job.teamId !== s.team.id) throw new Error("not found");
  return { ...s, job };
}

export async function answerAction(form: FormData) {
  const { ctx, user, job } = await teamJob(str(form, "jobId"));
  const questionId = str(form, "questionId");
  const q = await ctx.db.query.questions.findFirst({
    where: and(eq(questions.id, questionId), eq(questions.jobId, job.id)),
  });
  if (!q) return;
  const choice = str(form, "option");
  const free = str(form, "text");
  const options = q.options as string[];
  const idx = choice === "" ? null : Number(choice);
  const text = idx !== null && options[idx] ? options[idx]! : free;
  if (!text) return;
  await answerQuestion(ctx, q.id, {
    text,
    optionIndex: idx !== null && options[idx] ? idx : null,
    by: user.login,
    via: "panel",
  });
  revalidatePath(`/jobs/${job.id}`);
}

export async function helpfulAction(form: FormData) {
  const { ctx, job } = await teamJob(str(form, "jobId"));
  await markQuestionHelpful(ctx, str(form, "questionId"), str(form, "helpful") === "yes");
  revalidatePath(`/jobs/${job.id}`);
}

export async function messageAction(form: FormData) {
  const { ctx, user, job } = await teamJob(str(form, "jobId"));
  const text = str(form, "text");
  if (text) await sendMessage(ctx, job.id, text, user.login);
  revalidatePath(`/jobs/${job.id}`);
}

export async function retryAction(form: FormData) {
  const { ctx, user, job } = await teamJob(str(form, "jobId"));
  const stage = str(form, "stage");
  await retryJob(ctx, job.id, isRunnerStage(stage) ? stage : "triage", user.login);
  revalidatePath(`/jobs/${job.id}`);
}

export async function cancelAction(form: FormData) {
  const { ctx, user, job } = await teamJob(str(form, "jobId"));
  await cancelJob(ctx, job.id, user.login);
  revalidatePath(`/jobs/${job.id}`);
}

export async function createJoinTokenAction(): Promise<string> {
  const { ctx, user, team } = await requireTeam();
  return createJoinToken(ctx, team.id, user.id);
}

export async function runnerStatusAction(form: FormData) {
  const { ctx, team } = await requireAdmin();
  const runnerId = str(form, "runnerId");
  const status = str(form, "status") as "active" | "draining" | "removed";
  const runner = await ctx.db.query.runners.findFirst({
    where: and(eq(runners.id, runnerId), eq(runners.teamId, team.id)),
  });
  if (runner && ["active", "draining", "removed"].includes(status))
    await setRunnerStatus(ctx, runner.id, status);
  revalidatePath("/runners");
}

async function teamRepo(repoId: string, admin = false) {
  const s = admin ? await requireAdmin() : await requireTeam();
  const repo = await s.ctx.db.query.repos.findFirst({
    where: and(eq(repos.id, repoId), eq(repos.teamId, s.team.id)),
  });
  if (!repo) throw new Error("not found");
  return { ...s, repo };
}

export async function onboardAction(form: FormData) {
  const { ctx, user, repo } = await teamRepo(str(form, "repoId"));
  const restart = str(form, "restart") === "1";
  const job = await startOnboarding(ctx, repo.id, user.login, { restart });
  redirect(`/jobs/${job.id}`);
}

export async function repoSettingsAction(form: FormData) {
  const { ctx, repo } = await teamRepo(str(form, "repoId"), true);
  await updateRepoSettings(ctx, repo.id, {
    mergeMode: str(form, "mergeMode") === "merge_when_confident" ? "merge_when_confident" : "off",
    defaultHarness: str(form, "defaultHarness") || null,
    defaultModel: str(form, "defaultModel") || null,
    ghProjectId: str(form, "ghProjectId") || null,
  });
  revalidatePath("/repos");
}

export async function inviteAction(form: FormData) {
  const { ctx, team } = await requireAdmin();
  const login = str(form, "login");
  if (login) await inviteMember(ctx, team.id, login, str(form, "role") === "admin" ? "admin" : "member");
  revalidatePath("/team");
}

export async function teamSettingsAction(form: FormData) {
  const { ctx, team } = await requireAdmin();
  const cap = Number(str(form, "dailySpendCapUsd"));
  await ctx.db
    .update(teams)
    .set({
      name: str(form, "name") || team.name,
      dailySpendCapUsd: Number.isFinite(cap) && cap > 0 ? cap : null,
      outgoingWebhookUrl: str(form, "outgoingWebhookUrl") || null,
      defaultHarness: str(form, "defaultHarness") || "claude-code",
      defaultModel: str(form, "defaultModel") || null,
    })
    .where(eq(teams.id, team.id));
  revalidatePath("/settings");
}

export async function notifyPrefAction(form: FormData) {
  const { ctx, user } = await requireTeam();
  const pref = str(form, "notifyPref");
  if (!["github", "email", "push", "digest"].includes(pref)) return;
  await ctx.db
    .update(users)
    .set({ notifyPref: pref, email: str(form, "email") || undefined })
    .where(eq(users.id, user.id));
  revalidatePath("/settings");
}
