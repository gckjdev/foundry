import { z } from "zod";

export const JOB_STATUSES = [
  "queued",
  "triage",
  "needs_input",
  "investigating",
  "implementing",
  "reviewing",
  "verifying",
  "pr_ci",
  "waiting_on_you",
  "merged",
  "failed",
  "cancelled",
] as const;

export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

/** Stages a runner drives, in playbook order. A re-queued job resumes at one of these. */
export const RUNNER_STAGES = ["triage", "investigating", "implementing", "reviewing", "verifying"] as const;
export type RunnerStage = (typeof RUNNER_STAGES)[number];
export const RunnerStageSchema = z.enum(RUNNER_STAGES);

export const TERMINAL_STATUSES: readonly JobStatus[] = ["merged", "cancelled"];
/** Statuses in which a runner is actively holding the job. */
export const RUNNING_STATUSES: readonly JobStatus[] = RUNNER_STAGES;

const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["triage", "investigating", "implementing", "reviewing", "verifying", "cancelled"],
  triage: ["needs_input", "investigating", "failed", "queued", "cancelled"],
  needs_input: ["queued", "cancelled"],
  investigating: ["implementing", "needs_input", "failed", "queued", "cancelled"],
  implementing: ["reviewing", "needs_input", "failed", "queued", "cancelled"],
  reviewing: ["implementing", "verifying", "needs_input", "failed", "queued", "cancelled"],
  verifying: ["implementing", "pr_ci", "failed", "queued", "cancelled"],
  pr_ci: ["queued", "merged", "waiting_on_you", "failed", "cancelled"],
  waiting_on_you: ["queued", "merged", "cancelled"],
  merged: [],
  failed: ["queued", "waiting_on_you", "cancelled"],
  cancelled: ["queued"],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: JobStatus,
    readonly to: JobStatus,
  ) {
    super(`Invalid job transition ${from} -> ${to}`);
  }
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function isRunnerStage(s: string): s is RunnerStage {
  return (RUNNER_STAGES as readonly string[]).includes(s);
}

export function nextRunnerStage(stage: RunnerStage): RunnerStage | "pr_ci" {
  const i = RUNNER_STAGES.indexOf(stage);
  return RUNNER_STAGES[i + 1] ?? "pr_ci";
}

/** `foundry:<stage>` label kept on the source issue; one at a time. */
export function stageLabel(status: JobStatus): string {
  return `foundry:${status.replaceAll("_", "-")}`;
}

export const ALL_STAGE_LABELS = JOB_STATUSES.map(stageLabel);

export const STATUS_TITLES: Record<JobStatus, string> = {
  queued: "Queued",
  triage: "Triage",
  needs_input: "Needs input",
  investigating: "Investigating",
  implementing: "Implementing",
  reviewing: "Reviewing",
  verifying: "Verifying",
  pr_ci: "PR / CI",
  waiting_on_you: "Waiting on you",
  merged: "Merged",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const JobKindSchema = z.enum(["ticket", "onboarding"]);
export type JobKind = z.infer<typeof JobKindSchema>;
