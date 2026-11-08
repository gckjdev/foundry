import { z } from "zod";
import { EvidenceStatusSchema, FoundryEventSchema } from "./events";
import { OsSchema } from "./recipe";
import { JobKindSchema, JobStatusSchema, RunnerStageSchema } from "./states";

export const HarnessInfoSchema = z.object({
  id: z.string(),
  installed: z.boolean(),
  version: z.string().optional(),
  authOk: z.boolean(),
});
export type HarnessInfo = z.infer<typeof HarnessInfoSchema>;

export const JoinRequestSchema = z.object({
  joinToken: z.string(),
  name: z.string().min(1),
  kind: z.enum(["shared", "personal"]),
  os: OsSchema,
  arch: z.string(),
  osVersion: z.string(),
  cpu: z.number().int().positive(),
  memMb: z.number().int().positive(),
  maxConcurrency: z.number().int().positive(),
});
export type JoinRequest = z.infer<typeof JoinRequestSchema>;

export const JoinResponseSchema = z.object({
  runnerId: z.string(),
  runnerToken: z.string(),
  teamId: z.string(),
});

export const HeartbeatRequestSchema = z.object({
  cpu: z.number().int().positive(),
  memMb: z.number().int().positive(),
  diskFreeMb: z.number().int().nonnegative(),
  onAcPower: z.boolean().nullable(),
  accepting: z.boolean(),
  notAcceptingReason: z.string().nullable().optional(),
  runningJobIds: z.array(z.string()),
  harnesses: z.array(HarnessInfoSchema),
  maxConcurrency: z.number().int().positive(),
  version: z.string(),
});
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;

export const HeartbeatResponseSchema = z.object({
  realtimeUrl: z.string(),
  realtimeToken: z.string(),
  draining: z.boolean(),
  /** Jobs the runner reported as running that the control plane no longer assigns to it. */
  revokedJobIds: z.array(z.string()),
  /** Jobs this runner should keep parked locally: `needs_input` and in-progress (`RUNNING_STATUSES`). */
  keepJobIds: z.array(z.string()),
  /** Per-job limits, so a change reaches a job that is already running. */
  jobLimits: z
    .array(
      z.object({
        jobId: z.string(),
        maxJobMinutes: z.number().int().positive().nullable(),
        maxCostUsd: z.number().positive().nullable().default(null),
      }),
    )
    .default([]),
  repos: z.array(
    z.object({
      id: z.string(),
      fullName: z.string(),
      defaultBranch: z.string(),
      recipeSha: z.string().nullable(),
      acceptsJobs: z.boolean(),
    }),
  ),
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;

export const PendingInputSchema = z.object({
  kind: z.enum(["answer", "message"]),
  text: z.string(),
  by: z.string(),
  questionPrompt: z.string().optional(),
});
export type PendingInput = z.infer<typeof PendingInputSchema>;

export const ClaimedJobSchema = z.object({
  id: z.string(),
  kind: JobKindSchema,
  repo: z.object({ id: z.string(), fullName: z.string(), defaultBranch: z.string() }),
  issueNumber: z.number().int().nullable(),
  title: z.string(),
  body: z.string(),
  author: z.string().nullable(),
  harness: z.string(),
  model: z.string().nullable(),
  playbook: z.string(),
  branch: z.string(),
  /** Stage to (re)start at. */
  resumeStage: RunnerStageSchema,
  /** Native harness session id when this runner can resume in place. */
  sessionId: z.string().nullable(),
  resumeMode: z.enum(["fresh", "sticky", "portable"]),
  loopCount: z.number().int(),
  costUsd: z.number(),
  /** Per-job max execution time override in minutes; null follows the repo policy. */
  maxJobMinutes: z.number().int().positive().nullable().default(null),
  /** Per-job max cost override in USD; null follows the repo policy. */
  maxCostUsd: z.number().positive().nullable().default(null),
  pendingInputs: z.array(PendingInputSchema),
  mergeMode: z.enum(["off", "merge_when_confident"]),
});
export type ClaimedJob = z.infer<typeof ClaimedJobSchema>;

export const ClaimResponseSchema = z.object({ job: ClaimedJobSchema.nullable() });

export const EventsRequestSchema = z.object({ events: z.array(FoundryEventSchema).min(1).max(200) });

export const StageRequestSchema = z.object({
  to: JobStatusSchema,
  reason: z.string().optional(),
  lastCompletedStage: RunnerStageSchema.nullable().optional(),
  loopCount: z.number().int().optional(),
  sessionId: z.string().nullable().optional(),
  worktreePath: z.string().nullable().optional(),
  portBase: z.number().int().nullable().optional(),
});
export type StageRequest = z.infer<typeof StageRequestSchema>;

export const AskRequestSchema = z.object({
  prompt: z.string().min(1),
  options: z.array(z.string()).max(6).default([]),
});
export const AskResponseSchema = z.object({ questionId: z.string() });

export const EvidenceRequestSchema = z.object({
  kind: z.enum(["check", "screenshot", "note"]),
  name: z.string(),
  status: EvidenceStatusSchema,
  command: z.string().nullable().optional(),
  exitCode: z.number().int().nullable().optional(),
  outputTail: z.string().max(20_000).nullable().optional(),
  durationMs: z.number().int().nullable().optional(),
  artifactId: z.string().nullable().optional(),
});
export type EvidenceRequest = z.infer<typeof EvidenceRequestSchema>;

export const ConfidenceRequestSchema = z.object({
  level: z.enum(["high", "medium", "low"]),
  reasons: z.array(z.string()).default([]),
  uncertainties: z.array(z.string()).default([]),
});
export type ConfidenceRequest = z.infer<typeof ConfidenceRequestSchema>;

export const PlanRequestSchema = z.object({ plan: z.string().min(1) });

export const CheckpointRequestSchema = z.object({
  /** Last completed stage; null when saving the session before any stage finished. */
  stage: RunnerStageSchema.nullable(),
  sessionId: z.string().nullable(),
  briefRef: z.string(),
  headSha: z.string().nullable(),
});

export const OpenPrRequestSchema = z.object({
  title: z.string().min(1),
  summary: z.string(),
  headSha: z.string(),
  uiChanged: z.boolean(),
  changedLines: z.number().int().nonnegative(),
});
export const OpenPrResponseSchema = z.object({ prNumber: z.number().int(), url: z.string() });

export const GitTokenResponseSchema = z.object({ token: z.string(), expiresAt: z.string() });

export const ReadinessRequestSchema = z.object({
  repoId: z.string(),
  recipeSha: z.string().nullable(),
  ready: z.boolean(),
  reason: z.string().nullable(),
});

export const OnboardingResultSchema = z.object({
  ok: z.boolean(),
  reason: z.string().nullable(),
  headSha: z.string().nullable(),
  summary: z.string(),
});
