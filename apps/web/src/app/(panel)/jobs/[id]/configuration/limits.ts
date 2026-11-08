import type { Job } from "@foundry/db";
import type { Policy } from "@foundry/shared";

export interface JobLimitValues {
  maxJobMinutes: number;
  maxCostUsd: number;
  /** Changes when a save persists a new value, remounting the form with fresh defaults. */
  limitsKey: string;
}

/**
 * The values the Job limits form shows: the job's own override, else the repo policy default.
 *
 * The form is uncontrolled (`defaultValue`), so React keeps whatever the fields held when the page
 * was first rendered. Keying the form by the persisted values makes it remount after a save and show
 * exactly what the action wrote, instead of stale in-browser values.
 */
export function jobLimitValues(
  job: Pick<Job, "maxJobMinutes" | "maxCostUsd">,
  policy: Pick<Policy, "max_job_minutes" | "max_cost_per_job_usd">,
): JobLimitValues {
  return {
    maxJobMinutes: job.maxJobMinutes ?? policy.max_job_minutes,
    maxCostUsd: job.maxCostUsd ?? policy.max_cost_per_job_usd,
    limitsKey: `limits:${job.maxJobMinutes ?? "policy"}:${job.maxCostUsd ?? "policy"}`,
  };
}
