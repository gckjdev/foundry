import { afterEach, describe, expect, it, vi } from "vitest";
import { elapsed, jobElapsed } from "./duration";

const at = (iso: string) => new Date(iso);

describe("elapsed", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders an em dash for a job that has not started", () => {
    expect(elapsed(null, null)).toBe("—");
  });

  it("formats seconds, minutes, hours, and days", () => {
    expect(elapsed(at("2026-11-12T10:00:00Z"), at("2026-11-12T10:00:45Z"))).toBe("45s");
    expect(elapsed(at("2026-11-12T10:00:00Z"), at("2026-11-12T10:12:30Z"))).toBe("12m");
    expect(elapsed(at("2026-11-12T10:00:00Z"), at("2026-11-12T13:12:00Z"))).toBe("3h 12m");
    expect(elapsed(at("2026-11-12T10:00:00Z"), at("2026-11-12T13:00:00Z"))).toBe("3h");
    expect(elapsed(at("2026-11-12T10:00:00Z"), at("2026-11-14T13:00:00Z"))).toBe("2d 3h");
    expect(elapsed(at("2026-11-12T10:00:00Z"), at("2026-11-14T10:00:00Z"))).toBe("2d");
  });

  it("clamps a clock skew between the runner and the panel to zero", () => {
    expect(elapsed(at("2026-11-12T10:05:00Z"), at("2026-11-12T10:00:00Z"))).toBe("0s");
  });
});

describe("jobElapsed", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("times a stopped job from its first claim to its finish", () => {
    const job = {
      status: "merged",
      startedAt: at("2026-11-12T10:00:00Z"),
      finishedAt: at("2026-11-12T11:30:00Z"),
      updatedAt: at("2026-11-12T11:35:00Z"),
    };
    expect(jobElapsed(job)).toBe("1h 30m");
  });

  it("ignores a previous attempt's finish time while a retried job is running again", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at("2026-11-12T12:00:00Z"));
    const job = {
      status: "investigating",
      startedAt: at("2026-11-12T10:00:00Z"),
      finishedAt: at("2026-11-12T10:30:00Z"),
      updatedAt: at("2026-11-12T11:59:00Z"),
    };
    expect(jobElapsed(job)).toBe("2h");
  });

  it("falls back to updatedAt when a stopped job has no finish time", () => {
    const job = {
      status: "failed",
      startedAt: at("2026-11-12T10:00:00Z"),
      finishedAt: null,
      updatedAt: at("2026-11-12T10:20:00Z"),
    };
    expect(jobElapsed(job)).toBe("20m");
  });

  it("renders an em dash for a queued job that never ran", () => {
    expect(
      jobElapsed({
        status: "queued",
        startedAt: null,
        finishedAt: null,
        updatedAt: at("2026-11-12T10:00:00Z"),
      }),
    ).toBe("—");
  });
});
