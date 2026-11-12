import { jobs, repos, users, webhookInbox } from "@foundry/db";
import {
  errorFields,
  findMarker,
  logged,
  newCorrelationId,
  parseFoundryCommand,
  TRIGGER_LABEL,
} from "@foundry/shared";
import { and, asc, eq, isNull, lt, notInArray, or } from "drizzle-orm";
import { type ControlContext, withLogFields } from "./context";
import { cancelJob, createJobFromIssue, retryJob, sendMessage } from "./jobs";
import { evaluateJobGate, handleChangesRequestedReview, jobsForSha, markJobMerged } from "./merge-gate";
import { answerFromCheckbox, answerFromReply } from "./questions";
import { refreshRepoConfig } from "./repos";
import { linkInstallation, membership, unlinkRepos } from "./teams";

const MAX_ATTEMPTS = 5;

/** Store a verified delivery. Returns null when GitHub re-sent a delivery we already have. */
export async function storeWebhook(ctx: ControlContext, deliveryId: string, event: string, payload: unknown) {
  const rows = await logged(
    ctx.log,
    "database write",
    () =>
      ctx.db
        .insert(webhookInbox)
        .values({ provider: "github", deliveryId, event, payload })
        .onConflictDoNothing()
        .returning({ id: webhookInbox.id }),
    {
      fields: { table: "webhook_inbox", operation: "insert", deliveryId, event },
      result: (rows) => ({ inserted: rows.length > 0 }),
    },
  );
  return rows[0]?.id ?? null;
}

export async function processWebhook(ctx: ControlContext, id: number): Promise<void> {
  const row = await logged(
    ctx.log,
    "database read",
    () => ctx.db.query.webhookInbox.findFirst({ where: eq(webhookInbox.id, id) }),
    {
      fields: { table: "webhook_inbox", operation: "findFirst", id },
      result: (row) => ({ found: !!row, alreadyProcessed: !!row?.processedAt }),
    },
  );
  if (!row || row.processedAt) return;
  try {
    await dispatch(ctx, row.event, row.payload as Payload);
    await logged(
      ctx.log,
      "database write",
      () =>
        ctx.db
          .update(webhookInbox)
          .set({ processedAt: ctx.now(), error: null, attempts: row.attempts + 1 })
          .where(eq(webhookInbox.id, id)),
      { fields: { table: "webhook_inbox", operation: "update", id } },
    );
    ctx.log.debug("webhook processed", { id, event: row.event, attempts: row.attempts + 1 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log.error("webhook processing failed", {
      id,
      event: row.event,
      attempts: row.attempts + 1,
      ...errorFields(err),
    });
    await ctx.db
      .update(webhookInbox)
      .set({ error: message, attempts: row.attempts + 1 })
      .where(eq(webhookInbox.id, id));
  }
}

/** Retry anything not yet processed (crash between store and process, or a transient error). */
export async function processPendingWebhooks(ctx: ControlContext, limit = 50): Promise<number> {
  const rows = await logged(
    ctx.log,
    "database read",
    () =>
      ctx.db
        .select({ id: webhookInbox.id })
        .from(webhookInbox)
        .where(and(isNull(webhookInbox.processedAt), lt(webhookInbox.attempts, MAX_ATTEMPTS)))
        .orderBy(asc(webhookInbox.id))
        .limit(limit),
    {
      fields: { table: "webhook_inbox", operation: "selectPending", limit },
      result: (rows) => ({ rows: rows.length }),
    },
  );
  // Each retried delivery is its own execution; give it a correlation id to follow its logs.
  for (const r of rows) await processWebhook(withLogFields(ctx, { correlationId: newCorrelationId() }), r.id);
  if (rows.length) ctx.log.debug("processed pending webhooks", { count: rows.length });
  return rows.length;
}

// Only the fields Foundry reads from GitHub webhook payloads.
interface Payload {
  action?: string;
  installation?: { id: number };
  repository?: { id: number; full_name: string; default_branch: string };
  sender?: { login: string; type: string };
  label?: { name: string };
  issue?: {
    number: number;
    title: string;
    body: string | null;
    user: { login: string };
    labels: { name: string }[];
    pull_request?: unknown;
  };
  comment?: { id: number; body: string; user: { login: string; type: string } };
  pull_request?: { number: number; title?: string; merged: boolean; head: { sha: string; ref: string } };
  review?: { id: number; state: string; body: string | null; user: { login: string; type: string } };
  check_suite?: { head_sha: string };
  check_run?: { head_sha: string };
  sha?: string;
  ref?: string;
  commits?: { added: string[]; modified: string[]; removed: string[] }[];
  repositories_removed?: { id: number }[];
}

function isBot(user?: { type: string; login: string }): boolean {
  return !user || user.type === "Bot" || user.login.endsWith("[bot]");
}

async function repoFor(ctx: ControlContext, p: Payload) {
  if (!p.repository) return null;
  return ctx.db.query.repos.findFirst({ where: eq(repos.ghRepoId, p.repository.id) }) ?? null;
}

async function jobForIssueOrPr(ctx: ControlContext, repoId: string, number: number) {
  return ctx.db.query.jobs.findFirst({
    where: and(
      eq(jobs.repoId, repoId),
      or(eq(jobs.issueNumber, number), eq(jobs.prNumber, number)),
      notInArray(jobs.status, ["merged", "cancelled"]),
    ),
  });
}

async function isTeamMember(ctx: ControlContext, teamId: string, login: string) {
  const user = await ctx.db.query.users.findFirst({ where: eq(users.ghLogin, login.toLowerCase()) });
  return !!user && !!(await membership(ctx, user.id, teamId));
}

async function dispatch(ctx: ControlContext, event: string, p: Payload): Promise<void> {
  switch (event) {
    case "installation_repositories": {
      if (p.repositories_removed?.length)
        await unlinkRepos(
          ctx,
          p.repositories_removed.map((r) => r.id),
        );
      if (p.action === "added" && p.installation) {
        const known = await ctx.db.query.repos.findFirst({
          where: eq(repos.ghInstallationId, p.installation.id),
        });
        if (known) await linkInstallation(ctx, known.teamId, p.installation.id);
      }
      return;
    }
    case "installation": {
      if (p.action === "deleted" && p.installation) {
        await ctx.db.delete(repos).where(eq(repos.ghInstallationId, p.installation.id));
      }
      return;
    }
    case "push": {
      const repo = await repoFor(ctx, p);
      if (!repo || p.ref !== `refs/heads/${repo.defaultBranch}`) return;
      const touched = (p.commits ?? []).flatMap((c) => [...c.added, ...c.modified, ...c.removed]);
      if (touched.some((f) => f.startsWith(".foundry/")) || !repo.recipeSha)
        await refreshRepoConfig(ctx, repo);
      return;
    }
    case "issues": {
      const repo = await repoFor(ctx, p);
      if (!repo || !p.issue) return;
      if (p.action === "labeled" && p.label?.name === TRIGGER_LABEL) {
        await createJobFromIssue(ctx, repo.id, {
          number: p.issue.number,
          title: p.issue.title,
          body: p.issue.body ?? "",
          author: p.issue.user.login,
          labels: p.issue.labels.map((l) => l.name),
        });
      } else if (p.action === "closed") {
        const job = await jobForIssueOrPr(ctx, repo.id, p.issue.number);
        if (job && job.issueNumber === p.issue.number && job.status !== "pr_ci") {
          await cancelJob(ctx, job.id, p.sender?.login ?? "github");
        }
      }
      return;
    }
    case "issue_comment": {
      const repo = await repoFor(ctx, p);
      if (!repo || !p.issue || !p.comment) return;
      if (p.action === "edited") {
        // Ticking a box edits our own bot comment, so the sender (not the comment author) answered.
        const questionId = findMarker(p.comment.body, "question");
        if (questionId && p.sender && !isBot(p.sender))
          await answerFromCheckbox(ctx, questionId, p.comment.body, p.sender.login);
        return;
      }
      if (p.action !== "created" || isBot(p.comment.user)) return;
      const job = await jobForIssueOrPr(ctx, repo.id, p.issue.number);
      if (!job) return;
      const by = p.comment.user.login;
      const command = parseFoundryCommand(p.comment.body);
      if (command !== null) {
        if (!(await isTeamMember(ctx, repo.teamId, by))) return;
        if (command === "cancel") await cancelJob(ctx, job.id, by);
        else if (command === "retry") await retryJob(ctx, job.id, "triage", by);
        else await sendMessage(ctx, job.id, command, by);
        return;
      }
      if (job.status === "needs_input") await answerFromReply(ctx, job.id, p.comment.body, by);
      return;
    }
    case "pull_request": {
      const repo = await repoFor(ctx, p);
      if (!repo || !p.pull_request || p.action !== "closed") return;
      const job = await ctx.db.query.jobs.findFirst({
        where: and(eq(jobs.repoId, repo.id), eq(jobs.prNumber, p.pull_request.number)),
      });
      if (!job) {
        const reverted = p.pull_request.merged ? /^Revert "(.+)"$/.exec(p.pull_request.title ?? "") : null;
        if (reverted) {
          await ctx.db
            .update(jobs)
            .set({ revertedAt: ctx.now() })
            .where(and(eq(jobs.repoId, repo.id), eq(jobs.prTitle, reverted[1]!), eq(jobs.status, "merged")));
        }
        return;
      }
      if (["merged", "cancelled"].includes(job.status)) return;
      if (p.pull_request.merged) {
        await markJobMerged(ctx, job, "pull request merged");
      } else {
        await cancelJob(ctx, job.id, p.sender?.login ?? "github");
      }
      return;
    }
    case "pull_request_review": {
      const repo = await repoFor(ctx, p);
      if (!repo || !p.pull_request || !p.review || p.action !== "submitted") return;
      const job = await ctx.db.query.jobs.findFirst({
        where: and(eq(jobs.repoId, repo.id), eq(jobs.prNumber, p.pull_request.number)),
      });
      if (!job) return;
      if (!isBot(p.review.user) && p.review.state.toLowerCase() === "changes_requested") {
        await handleChangesRequestedReview(ctx, job, {
          id: p.review.id,
          author: p.review.user.login,
          body: p.review.body,
        });
      } else if (job.status === "pr_ci") {
        await evaluateJobGate(ctx, job.id);
      }
      return;
    }
    case "check_suite":
    case "check_run":
    case "status": {
      if (p.action && p.action !== "completed" && event !== "status") return;
      const sha = p.check_suite?.head_sha ?? p.check_run?.head_sha ?? p.sha;
      if (!sha) return;
      for (const job of await jobsForSha(ctx, sha))
        if (job.status === "pr_ci") await evaluateJobGate(ctx, job.id);
      return;
    }
  }
}
