import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// SQLite mirror of schema.ts. Column names are identical so @foundry/control queries stay
// dialect-agnostic. Types are chosen so `$inferSelect` matches the Postgres schema exactly:
//   uuid/text              -> text
//   timestamp with tz      -> integer({ mode: "timestamp_ms" })   (both read back as Date)
//   jsonb                  -> text({ mode: "json" })              (both read back as unknown)
//   boolean                -> integer({ mode: "boolean" })
//   double precision       -> real
//   bigint / bigserial     -> integer
// DDL lives in migrations-sqlite/0000_init.sql; these columns are only used for query building.
const id = () => text("id").primaryKey().default(sql`(lower(hex(randomblob(16))))`);
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);
const ts = (name: string) => integer(name, { mode: "timestamp_ms" });
const json = (name: string) => text(name, { mode: "json" });

export const teams = sqliteTable("teams", {
  id: id(),
  name: text("name").notNull(),
  ghOrg: text("gh_org"),
  dailySpendCapUsd: real("daily_spend_cap_usd"),
  outgoingWebhookUrl: text("outgoing_webhook_url"),
  defaultHarness: text("default_harness").notNull().default("claude-code"),
  defaultModel: text("default_model"),
  createdAt: createdAt(),
});

export const users = sqliteTable(
  "users",
  {
    id: id(),
    email: text("email"),
    ghLogin: text("gh_login").notNull(),
    ghId: integer("gh_id"),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    notifyPref: text("notify_pref").notNull().default("github"),
    pushSubscription: json("push_subscription"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_gh_login_idx").on(t.ghLogin)],
);

export const memberships = sqliteTable(
  "memberships",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

export const invites = sqliteTable("invites", {
  id: id(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  ghLogin: text("gh_login").notNull(),
  role: text("role").notNull().default("member"),
  createdAt: createdAt(),
});

export const repos = sqliteTable(
  "repos",
  {
    id: id(),
    teamId: text("team_id")
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
    acceptsJobs: integer("accepts_jobs", { mode: "boolean" }).notNull().default(false),
    recipeSha: text("recipe_sha"),
    recipeYaml: text("recipe_yaml"),
    policyYaml: text("policy_yaml"),
    onboardingStatus: text("onboarding_status").notNull().default("not_started"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("repos_gh_repo_idx").on(t.ghRepoId)],
);

export const runners = sqliteTable(
  "runners",
  {
    id: id(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    os: text("os").notNull(),
    arch: text("arch").notNull(),
    osVersion: text("os_version").notNull(),
    tokenHash: text("token_hash").notNull(),
    version: text("version"),
    lastSeenAt: ts("last_seen_at"),
    cpu: integer("cpu"),
    memMb: integer("mem_mb"),
    diskFreeMb: integer("disk_free_mb"),
    onAcPower: integer("on_ac_power", { mode: "boolean" }),
    accepting: integer("accepting", { mode: "boolean" }).notNull().default(true),
    notAcceptingReason: text("not_accepting_reason"),
    maxConcurrency: integer("max_concurrency").notNull().default(1),
    harnesses: json("harnesses").notNull().default(sql`'[]'`),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("runners_token_idx").on(t.tokenHash),
    uniqueIndex("runners_team_name_idx").on(t.teamId, t.name),
  ],
);

export const runnerRepoReadiness = sqliteTable(
  "runner_repo_readiness",
  {
    runnerId: text("runner_id")
      .notNull()
      .references(() => runners.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    recipeSha: text("recipe_sha"),
    ready: integer("ready", { mode: "boolean" }).notNull(),
    reason: text("reason"),
    checkedAt: ts("checked_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [primaryKey({ columns: [t.runnerId, t.repoId] })],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: id(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("ticket"),
    authorUserId: text("author_user_id").references(() => users.id, { onDelete: "set null" }),
    authorLogin: text("author_login"),
    source: text("source").notNull().default("github_issue"),
    issueNumber: integer("issue_number"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    playbook: text("playbook").notNull().default("default"),
    harness: text("harness").notNull(),
    model: text("model"),
    pinnedRunnerName: text("pinned_runner_name"),
    runnerId: text("runner_id").references(() => runners.id, { onDelete: "set null" }),
    originRunnerId: text("origin_runner_id").references(() => runners.id, { onDelete: "set null" }),
    stickyRunnerId: text("sticky_runner_id").references(() => runners.id, { onDelete: "set null" }),
    stickyUntil: ts("sticky_until"),
    worktreePath: text("worktree_path"),
    portBase: integer("port_base"),
    harnessSessionId: text("harness_session_id"),
    status: text("status").notNull().default("queued"),
    resumeStage: text("resume_stage").notNull().default("triage"),
    lastCompletedStage: text("last_completed_stage"),
    briefRef: text("brief_ref"),
    resumeCount: integer("resume_count").notNull().default(0),
    loopCount: integer("loop_count").notNull().default(0),
    branch: text("branch").notNull(),
    headSha: text("head_sha"),
    prNumber: integer("pr_number"),
    prUrl: text("pr_url"),
    ciStatus: text("ci_status").notNull().default("none"),
    aiReviewStatus: text("ai_review_status").notNull().default("none"),
    uiChanged: integer("ui_changed", { mode: "boolean" }).notNull().default(false),
    changedLines: integer("changed_lines").notNull().default(0),
    plan: text("plan"),
    confidence: json("confidence"),
    gateResult: json("gate_result"),
    assignedReviewers: json("assigned_reviewers").notNull().default(sql`'[]'`),
    statusCommentId: integer("status_comment_id"),
    costUsd: real("cost_usd").notNull().default(0),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    claimedAt: ts("claimed_at"),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    revertedAt: ts("reverted_at"),
    prTitle: text("pr_title"),
    updatedAt: ts("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("jobs_team_status_idx").on(t.teamId, t.status),
    index("jobs_runner_idx").on(t.runnerId),
    uniqueIndex("jobs_issue_active_idx")
      .on(t.repoId, t.issueNumber)
      .where(sql`status not in ('merged','cancelled') and issue_number is not null`),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    teamId: text("team_id").notNull(),
    ts: ts("ts").notNull().default(sql`(unixepoch() * 1000)`),
    kind: text("kind").notNull(),
    stage: text("stage"),
    payload: json("payload").notNull(),
  },
  (t) => [index("events_job_idx").on(t.jobId, t.id), index("events_team_ts_idx").on(t.teamId, t.ts)],
);

export const questions = sqliteTable("questions", {
  id: id(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  teamId: text("team_id").notNull(),
  askedUserId: text("asked_user_id").references(() => users.id, { onDelete: "set null" }),
  askedLogin: text("asked_login"),
  prompt: text("prompt").notNull(),
  options: json("options").notNull().default(sql`'[]'`),
  answer: text("answer"),
  answerOptionIndex: integer("answer_option_index"),
  answeredBy: text("answered_by"),
  answeredVia: text("answered_via"),
  ghCommentId: integer("gh_comment_id"),
  helpful: integer("helpful", { mode: "boolean" }),
  createdAt: createdAt(),
  answeredAt: ts("answered_at"),
});

export const jobInputs = sqliteTable("job_inputs", {
  id: id(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  text: text("text").notNull(),
  by: text("by").notNull(),
  questionPrompt: text("question_prompt"),
  deliveredAt: ts("delivered_at"),
  createdAt: createdAt(),
});

export const evidence = sqliteTable("evidence", {
  id: id(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  command: text("command"),
  exitCode: integer("exit_code"),
  outputTail: text("output_tail"),
  durationMs: integer("duration_ms"),
  artifactId: text("artifact_id"),
  loop: integer("loop").notNull().default(0),
  createdAt: createdAt(),
});

export const artifacts = sqliteTable("artifacts", {
  id: id(),
  teamId: text("team_id").notNull(),
  jobId: text("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(),
  createdAt: createdAt(),
});

export const webhookInbox = sqliteTable(
  "webhook_inbox",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    deliveryId: text("delivery_id").notNull(),
    event: text("event").notNull(),
    payload: json("payload").notNull(),
    receivedAt: ts("received_at").notNull().default(sql`(unixepoch() * 1000)`),
    processedAt: ts("processed_at"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
  },
  (t) => [uniqueIndex("webhook_inbox_delivery_idx").on(t.provider, t.deliveryId)],
);

export const notifications = sqliteTable("notifications", {
  id: id(),
  teamId: text("team_id").notNull(),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  jobId: text("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  detail: text("detail").notNull(),
  channel: text("channel").notNull(),
  sentAt: ts("sent_at"),
  error: text("error"),
  createdAt: createdAt(),
});
