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
  setJobMaxCost,
  setJobMaxMinutes,
  setRunnerStatus,
  startOnboarding,
  storeArtifact,
  syncRepoSKills,
  syncUnlinkedInstallations,
  updateRepoSettings,
} from "@foundry/control";
import { questions, repos, runners, teams, users } from "@foundry/db";
import { errorFields, isRunnerStage } from "@foundry/shared";
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
    ctx.log.warn("github installation sync after create team failed", errorFields(err));
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

const MAX_MESSAGE_IMAGES = 5;
const MAX_MESSAGE_IMAGE_BYTES = 5 * 1024 * 1024;
const MESSAGE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Normalize a browser File to an allowed image MIME type; pasted files may arrive without one. */
function messageImageType(file: File): string | null {
  const type = file.type.toLowerCase();
  if (MESSAGE_IMAGE_TYPES.has(type)) return type;
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return null;
}

export type MessageResult = { ok: true } | { ok: false; error: string };

export async function messageAction(form: FormData): Promise<MessageResult> {
  const { ctx, user, job } = await teamJob(str(form, "jobId"));
  const text = str(form, "text");
  const files = form.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
  if (!text && files.length === 0) return { ok: false, error: "Write a message or attach an image." };
  if (files.length > MAX_MESSAGE_IMAGES)
    return { ok: false, error: `Attach at most ${MAX_MESSAGE_IMAGES} images.` };

  for (const file of files) {
    if (!messageImageType(file)) return { ok: false, error: "Images must be PNG, JPEG or WebP." };
    if (file.size > MAX_MESSAGE_IMAGE_BYTES)
      return { ok: false, error: "Each image must be 5 MB or smaller." };
  }

  const attachmentIds: string[] = [];
  for (const file of files) {
    const contentType = messageImageType(file)!;
    const row = await storeArtifact(ctx, {
      teamId: job.teamId,
      jobId: job.id,
      name: file.name || "pasted-image",
      contentType,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    attachmentIds.push(row.id);
  }
  await sendMessage(ctx, job.id, text, user.login, attachmentIds);
  revalidatePath(`/jobs/${job.id}`);
  return { ok: true };
}

/** The Job limits form saves both limits together; an empty field clears that override. */
export async function jobLimitsAction(form: FormData) {
  const { ctx, team, job } = await teamJob(str(form, "jobId"));
  const minutesRaw = str(form, "maxMinutes");
  const costRaw = str(form, "maxCost");
  const minutes = minutesRaw === "" ? null : Number(minutesRaw);
  const cost = costRaw === "" ? null : Number(costRaw);
  // All-or-nothing: an invalid field leaves both saved values untouched.
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1)) return;
  if (cost !== null && (!Number.isFinite(cost) || cost <= 0)) return;
  await setJobMaxMinutes(ctx, team.id, job.id, minutes);
  await setJobMaxCost(ctx, team.id, job.id, cost);
  revalidatePath(`/jobs/${job.id}`);
  revalidatePath(`/jobs/${job.id}/configuration`);
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

/** Install or update the built-in skills by opening a PR; the result shows on the Repos page. */
export async function syncSkillsAction(form: FormData) {
  const { ctx, repo } = await teamRepo(str(form, "repoId"), true);
  let target: string;
  try {
    const pr = await syncRepoSKills(ctx, repo.id);
    target = `/repos?skills=${encodeURIComponent(pr.url)}${pr.updated ? "&skillsUpdated=1" : ""}`;
  } catch (err) {
    ctx.log.warn("repo skills sync failed", { repo: repo.fullName, ...errorFields(err) });
    const message = err instanceof Error ? err.message : String(err);
    target = `/repos?skillsError=${encodeURIComponent(message)}`;
  }
  revalidatePath("/repos");
  redirect(target);
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
