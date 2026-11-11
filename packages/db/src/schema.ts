import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const teams = pgTable("teams", {
  id: id(),
  name: text("name").notNull(),
  ghOrg: text("gh_org"),
  dailySpendCapUsd: doublePrecision("daily_spend_cap_usd"),
  outgoingWebhookUrl: text("outgoing_webhook_url"),
  defaultHarness: text("default_harness").notNull().default("claude-code"),
  defaultModel: text("default_model"),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email"),
    ghLogin: text("gh_login").notNull(),
    ghId: integer("gh_id"),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    notifyPref: text("notify_pref").notNull().default("github"), // github | email | push | digest
    pushSubscription: jsonb("push_subscription"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_gh_login_idx").on(t.ghLogin)],
);

export const memberships = pgTable(
  "memberships",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // admin | member
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

export const invites = pgTable("invites", {
  id: id(),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  ghLogin: text("gh_login").notNull(),
  role: text("role").notNull().default("member"),
  createdAt: createdAt(),
});

export const repos = pgTable(
  "repos",
  {
    id: id(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    ghInstallationId: integer("gh_installation_id").notNull(),
    ghRepoId: integer("gh_repo_id").notNull(),
    fullName: text("full_name").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    ghProjectId: text("gh_project_id"),
    defaultHarness: text("default_harness"),
    defaultModel: text("default_model"),
    mergeMode: text("merge_mode").notNull().default("off"),
    acceptsJobs: boolean("accepts_jobs").notNull().default(false),
    recipeSha: text("recipe_sha"),
    /** Raw `.foundry/` files at recipeSha, cached for the gate and readiness. */
    recipeYaml: text("recipe_yaml"),
    policyYaml: text("policy_yaml"),
    onboardingStatus: text("onboarding_status").notNull().default("not_started"), // not_started | running | pr_open | done | failed
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("repos_gh_repo_idx").on(t.ghRepoId)],
);

export const runners = pgTable(
  "runners",
  {
    id: id(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(), // shared | personal
    os: text("os").notNull(), // macos | linux
    arch: text("arch").notNull(),
    osVersion: text("os_version").notNull(),
    tokenHash: text("token_hash").notNull(),
    version: text("version"),
    lastSeenAt: ts("last_seen_at"),
    cpu: integer("cpu"),
    memMb: integer("mem_mb"),
    diskFreeMb: integer("disk_free_mb"),
    onAcPower: boolean("on_ac_power"),
    accepting: boolean("accepting").notNull().default(true),
    notAcceptingReason: text("not_accepting_reason"),
    maxConcurrency: integer("max_concurrency").notNull().default(1),
    harnesses: jsonb("harnesses").notNull().default(sql`'[]'::jsonb`),
    status: text("status").notNull().default("active"), // active | draining | removed
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("runners_token_idx").on(t.tokenHash),
    uniqueIndex("runners_team_name_idx").on(t.teamId, t.name),
  ],
);

export const runnerRepoReadiness = pgTable(
  "runner_repo_readiness",
  {
    runnerId: uuid("runner_id")
      .notNull()
      .references(() => runners.id, { onDelete: "cascade" }),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    recipeSha: text("recipe_sha"),
    ready: boolean("ready").notNull(),
    reason: text("reason"),
    checkedAt: ts("checked_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.runnerId, t.repoId] })],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("ticket"), // ticket | onboarding
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    authorLogin: text("author_login"),
    source: text("source").notNull().default("github_issue"),
    issueNumber: integer("issue_number"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    playbook: text("playbook").notNull().default("default"),
    harness: text("harness").notNull(),
    model: text("model"),
    pinnedRunnerName: text("pinned_runner_name"),
    runnerId: uuid("runner_id").references(() => runners.id, { onDelete: "set null" }),
    originRunnerId: uuid("origin_runner_id").references(() => runners.id, { onDelete: "set null" }),
    stickyRunnerId: uuid("sticky_runner_id").references(() => runners.id, { onDelete: "set null" }),
    stickyUntil: ts("sticky_until"),
    worktreePath: text("worktree_path"),
    portBase: integer("port_base"),
    harnessSessionId: text("harness_session_id"),
    status: text("status").notNull().default("queued"),
    /** Stage a re-queued job restarts at. */
    resumeStage: text("resume_stage").notNull().default("triage"),
    lastCompletedStage: text("last_completed_stage"),
    briefRef: text("brief_ref"),
    resumeCount: integer("resume_count").notNull().default(0),
    loopCount: integer("loop_count").notNull().default(0),
    branch: text("branch").notNull(),
    headSha: text("head_sha"),
    prNumber: integer("pr_number"),
    prUrl: text("pr_url"),
    ciStatus: text("ci_status").notNull().default("none"), // none | pending | success | failure
    aiReviewStatus: text("ai_review_status").notNull().default("none"), // none | clean | blocking
    /** PR head SHA the automatic post-PR review already ran on; prevents re-reviewing a SHA. */
    prReviewSha: text("pr_review_sha"),
    /** Automatic post-PR review rounds that requested changes and were sent back to implementing. */
    prReviewCount: integer("pr_review_count").notNull().default(0),
    uiChanged: boolean("ui_changed").notNull().default(false),
    changedLines: integer("changed_lines").notNull().default(0),
    plan: text("plan"),
    /** Per-job wall-clock limit in minutes; null follows `.foundry/policy.yaml` (`max_job_minutes`). */
    maxJobMinutes: integer("max_job_minutes"),
    /** Per-job cost cap in USD; null follows `.foundry/policy.yaml` (`max_cost_per_job_usd`). */
    maxCostUsd: doublePrecision("max_cost_usd"),
    confidence: jsonb("confidence"),
    gateResult: jsonb("gate_result"),
    assignedReviewers: jsonb("assigned_reviewers").notNull().default(sql`'[]'::jsonb`),
    /** Last GitHub review handed to the agent, so a catch-up poll re-queues it only once. */
    lastReviewId: bigint("last_review_id", { mode: "number" }),
    statusCommentId: bigint("status_comment_id", { mode: "number" }),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    claimedAt: ts("claimed_at"),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    /** Set when a later merged PR reverts this job's PR (post-merge revert metric). */
    revertedAt: ts("reverted_at"),
    prTitle: text("pr_title"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("jobs_team_status_idx").on(t.teamId, t.status),
    // Board and inbox list a team's jobs newest-first.
    index("jobs_team_updated_idx").on(t.teamId, t.updatedAt),
    index("jobs_runner_idx").on(t.runnerId),
    uniqueIndex("jobs_issue_active_idx")
      .on(t.repoId, t.issueNumber)
      .where(sql`status not in ('merged','cancelled') and issue_number is not null`),
  ],
);

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull(),
    ts: ts("ts").notNull().defaultNow(),
    kind: text("kind").notNull(),
    stage: text("stage"),
    payload: jsonb("payload").notNull(),
  },
  (t) => [index("events_job_idx").on(t.jobId, t.id), index("events_team_ts_idx").on(t.teamId, t.ts)],
);

export const questions = pgTable("questions", {
  id: id(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").notNull(),
  askedUserId: uuid("asked_user_id").references(() => users.id, { onDelete: "set null" }),
  askedLogin: text("asked_login"),
  prompt: text("prompt").notNull(),
  options: jsonb("options").notNull().default(sql`'[]'::jsonb`),
  answer: text("answer"),
  answerOptionIndex: integer("answer_option_index"),
  answeredBy: text("answered_by"),
  answeredVia: text("answered_via"), // panel | gh_checkbox | gh_reply
  ghCommentId: bigint("gh_comment_id", { mode: "number" }),
  helpful: boolean("helpful"),
  createdAt: createdAt(),
  answeredAt: ts("answered_at"),
});

/** Human input waiting to be delivered to the agent when the job resumes. */
export const jobInputs = pgTable("job_inputs", {
  id: id(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // answer | message
  text: text("text").notNull(),
  by: text("by").notNull(),
  questionPrompt: text("question_prompt"),
  /** Images attached to a panel message, resolved to artifacts when the agent resumes. */
  attachments: jsonb("attachments").notNull().default(sql`'[]'::jsonb`),
  deliveredAt: ts("delivered_at"),
  createdAt: createdAt(),
});

export const evidence = pgTable("evidence", {
  id: id(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // check | screenshot | note | review
  name: text("name").notNull(),
  status: text("status").notNull(),
  command: text("command"),
  exitCode: integer("exit_code"),
  outputTail: text("output_tail"),
  durationMs: integer("duration_ms"),
  artifactId: uuid("artifact_id"),
  loop: integer("loop").notNull().default(0),
  createdAt: createdAt(),
});

export const artifacts = pgTable("artifacts", {
  id: id(),
  teamId: uuid("team_id").notNull(),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(),
  createdAt: createdAt(),
});

export const webhookInbox = pgTable(
  "webhook_inbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    provider: text("provider").notNull(),
    deliveryId: text("delivery_id").notNull(),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
  },
  (t) => [uniqueIndex("webhook_inbox_delivery_idx").on(t.provider, t.deliveryId)],
);

export const notifications = pgTable("notifications", {
  id: id(),
  teamId: uuid("team_id").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  detail: text("detail").notNull(),
  channel: text("channel").notNull(), // push | email | webhook | digest
  sentAt: ts("sent_at"),
  error: text("error"),
  createdAt: createdAt(),
});

export type Team = typeof teams.$inferSelect;
export type User = typeof users.$inferSelect;
export type Repo = typeof repos.$inferSelect;
export type Runner = typeof runners.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Evidence = typeof evidence.$inferSelect;
export type EventRow = typeof events.$inferSelect;
