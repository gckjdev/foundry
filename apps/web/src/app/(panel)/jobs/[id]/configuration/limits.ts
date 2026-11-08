import type { Job } from "@foundry/db";
import type { Policy } from "@foundry/shared";

export interface JobLimitValues {
  maxJobMinutes: number;
  maxCostUsd: number;
  /** Keys change when a save persists a new value, remounting the forms with fresh defaults. */
  minutesKey: string;
  costKey: string;
}

/**
 * The values the Job limits form shows: the job's own override, else the repo policy default.
 *
 * The forms are uncontrolled (`defaultValue`), so React keeps whatever the fields held when the
 * page was first rendered. Keying each form by the persisted value makes it remount after a save
 * and show exactly what the action wrote, instead of a stale in-browser value.
 */
export function jobLimitValues(
  job: Pick<Job, "maxJobMinutes" | "maxCostUsd">,
  policy: Pick<Policy, "max_job_minutes" | "max_cost_per_job_usd">,
): JobLimitValues {
  return {
    maxJobMinutes: job.maxJobMinutes ?? policy.max_job_minutes,
    maxCostUsd: job.maxCostUsd ?? policy.max_cost_per_job_usd,
    minutesKey: `minutes:${job.maxJobMinutes ?? "policy"}`,
    costKey: `cost:${job.maxCostUsd ?? "policy"}`,
  };
}
