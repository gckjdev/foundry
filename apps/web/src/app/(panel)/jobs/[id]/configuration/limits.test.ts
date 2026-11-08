import { describe, expect, it } from "vitest";
import { jobLimitValues } from "./limits";

const policy = { max_job_minutes: 60, max_cost_per_job_usd: 10 };

describe("job limit values", () => {
  it("shows a per-job override instead of the repo default", () => {
    const values = jobLimitValues({ maxJobMinutes: 90, maxCostUsd: 12.5 }, policy);
    expect(values.maxJobMinutes).toBe(90);
    expect(values.maxCostUsd).toBe(12.5);
  });

  it("falls back to the repo policy when the job has no override", () => {
    const values = jobLimitValues({ maxJobMinutes: null, maxCostUsd: null }, policy);
    expect(values.maxJobMinutes).toBe(60);
    expect(values.maxCostUsd).toBe(10);
  });

  it("changes the form key when a saved limit changes", () => {
    // The key remounts the uncontrolled form so the fields adopt the values the action persisted.
    const before = jobLimitValues({ maxJobMinutes: null, maxCostUsd: null }, policy);
    const afterMinutes = jobLimitValues({ maxJobMinutes: 120, maxCostUsd: null }, policy);
    const afterCost = jobLimitValues({ maxJobMinutes: null, maxCostUsd: 15 }, policy);
    expect(afterMinutes.limitsKey).not.toBe(before.limitsKey);
    expect(afterCost.limitsKey).not.toBe(before.limitsKey);
  });

  it("keeps the key stable when the saved limits did not change", () => {
    const before = jobLimitValues({ maxJobMinutes: 120, maxCostUsd: 8 }, policy);
    const after = jobLimitValues({ maxJobMinutes: 120, maxCostUsd: 8 }, policy);
    expect(after.limitsKey).toBe(before.limitsKey);
  });
});
