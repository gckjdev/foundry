import { type Job, jobs, type Question, questions, repos, users } from "@foundry/db";
import {
  isRunnerStage,
  parseCheckedOption,
  parseReplyAnswer,
  renderAnsweredQuestion,
  renderQuestionComment,
  STICKY_WINDOW_MS,
} from "@foundry/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import { bestEffort, type ControlContext } from "./context";
import { repoRef } from "./github-sync";
import { addInput, getJob, recordEvents, transitionJob } from "./jobs";

/**
 * The agent asks instead of guessing (spec 5.7). The job parks in needs_input, the runner keeps
 * its worktree and session, and the question is posted on the issue with one checkbox per option.
 */
export async function askQuestion(
  ctx: ControlContext,
  job: Job,
  input: { prompt: string; options: string[] },
): Promise<Question> {
  const repo = await ctx.db.query.repos.findFirst({ where: eq(repos.id, job.repoId) });
  const [question] = await ctx.db
    .insert(questions)
    .values({
      jobId: job.id,
      teamId: job.teamId,
      askedUserId: job.authorUserId,
      askedLogin: job.authorLogin?.toLowerCase() ?? null,
      prompt: input.prompt,
      options: input.options,
    })
    .returning();
  const q = question!;
  await recordEvents(ctx, job, [{ kind: "question", questionId: q.id, prompt: q.prompt }]);
  if (repo && job.issueNumber !== null) {
    const issueNumber = job.issueNumber;
    await bestEffort(ctx, "post question", async () => {
      const body = renderQuestionComment({
        id: q.id,
        mention: job.authorLogin,
        prompt: q.prompt,
        options: input.options,
      });
      const comment = await ctx.gh.createComment(repoRef(repo), issueNumber, body);
      await ctx.db.update(questions).set({ ghCommentId: comment.id }).where(eq(questions.id, q.id));
    });
  }
  const stage = isRunnerStage(job.status) ? job.status : job.resumeStage;
  await transitionJob(ctx, job.id, "needs_input", {
    reason: "agent asked a question",
    patch: {
      resumeStage: stage,
      stickyRunnerId: job.runnerId,
      stickyUntil: new Date(ctx.now().getTime() + STICKY_WINDOW_MS),
    },
  });
  await ctx.notifier.notify(ctx, { event: "question_asked", job, detail: q.prompt });
  ctx.log.info("question posted", { jobId: job.id, questionId: q.id });
  return q;
}

export interface AnswerInput {
  text: string;
  optionIndex: number | null;
  by: string;
  via: "panel" | "gh_checkbox" | "gh_reply";
}

/** Store the answer, hand it to the agent as input and put the job back in the queue. */
export async function answerQuestion(
  ctx: ControlContext,
  questionId: string,
  a: AnswerInput,
): Promise<Job | null> {
  const [q] = await ctx.db
    .update(questions)
    .set({
      answer: a.text,
      answerOptionIndex: a.optionIndex,
      answeredBy: a.by,
      answeredVia: a.via,
      answeredAt: ctx.now(),
    })
    .where(and(eq(questions.id, questionId), isNull(questions.answeredAt)))
    .returning();
  if (!q) return null; // already answered
  const job = await getJob(ctx, q.jobId);
  ctx.log.info("question answered", { jobId: job.id, questionId: q.id, by: a.by, via: a.via });
  await addInput(ctx, job, { kind: "answer", text: a.text, by: a.by, questionPrompt: q.prompt });
  await recordEvents(ctx, job, [{ kind: "answer", questionId: q.id, text: a.text, by: a.by }]);

  const repo = await ctx.db.query.repos.findFirst({ where: eq(repos.id, job.repoId) });
  if (repo && q.ghCommentId) {
    const commentId = q.ghCommentId;
    await bestEffort(ctx, "update question comment", () =>
      ctx.gh.updateComment(
        repoRef(repo),
        commentId,
        renderAnsweredQuestion(
          { id: q.id, prompt: q.prompt, options: q.options as string[] },
          { text: a.text, optionIndex: a.optionIndex, by: a.by },
        ),
      ),
    );
  }
  // Only re-queue once every open question on the job has an answer.
  const open = await ctx.db.query.questions.findFirst({
    where: and(eq(questions.jobId, job.id), isNull(questions.answeredAt)),
  });
  if (open) return job;
  return transitionJob(ctx, job.id, "queued", {
    reason: `answered by @${a.by}`,
    from: ["needs_input"],
    patch: { stickyUntil: new Date(ctx.now().getTime() + STICKY_WINDOW_MS) },
  });
}

export async function openQuestionForJob(ctx: ControlContext, jobId: string) {
  return ctx.db.query.questions.findFirst({
    where: and(eq(questions.jobId, jobId), isNull(questions.answeredAt)),
    orderBy: desc(questions.createdAt),
  });
}

/** `issue_comment.edited` on a question comment: a ticked box is the answer. */
export async function answerFromCheckbox(ctx: ControlContext, questionId: string, body: string, by: string) {
  const q = await ctx.db.query.questions.findFirst({ where: eq(questions.id, questionId) });
  if (!q || q.answeredAt) return null;
  const idx = parseCheckedOption(body);
  const options = q.options as string[];
  if (idx === null || idx >= options.length) return null;
  return answerQuestion(ctx, q.id, { text: options[idx]!, optionIndex: idx, by, via: "gh_checkbox" });
}

/** A plain reply on the issue while the job waits: "B" picks an option, anything else is free text. */
export async function answerFromReply(ctx: ControlContext, jobId: string, body: string, by: string) {
  const q = await openQuestionForJob(ctx, jobId);
  if (!q) return null;
  const parsed = parseReplyAnswer(body, q.options as string[]);
  return answerQuestion(ctx, q.id, { ...parsed, by, via: "gh_reply" });
}

export async function markQuestionHelpful(ctx: ControlContext, questionId: string, helpful: boolean) {
  await ctx.db.update(questions).set({ helpful }).where(eq(questions.id, questionId));
}

export async function questionsForUser(ctx: ControlContext, teamId: string, userId: string) {
  const user = await ctx.db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return [];
  return ctx.db
    .select({ question: questions, job: jobs })
    .from(questions)
    .innerJoin(jobs, eq(jobs.id, questions.jobId))
    .where(
      and(eq(questions.teamId, teamId), isNull(questions.answeredAt), eq(questions.askedLogin, user.ghLogin)),
    );
}
