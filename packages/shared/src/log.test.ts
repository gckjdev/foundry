import { describe, expect, it } from "vitest";
import { createLogger, errorFields, parseLogLevel } from "./log";

function capture() {
  const lines: string[] = [];
  const logger = createLogger({
    service: "test",
    sink: (line) => lines.push(line),
    now: () => new Date("2026-11-10T12:00:00.000Z"),
  });
  return { lines, logger };
}

describe("createLogger", () => {
  it("writes one JSON record with timestamp, level, service, message and fields", () => {
    const { lines, logger } = capture();
    logger.info("job claimed", { jobId: "abc", runner: "alice-laptop" });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      ts: "2026-11-10T12:00:00.000Z",
      level: "info",
      service: "test",
      message: "job claimed",
      jobId: "abc",
      runner: "alice-laptop",
    });
  });

  it("drops records below the configured level", () => {
    const lines: string[] = [];
    const logger = createLogger({ service: "test", level: "warn", sink: (l) => lines.push(l) });

    logger.debug("noise");
    logger.info("noise");
    logger.warn("kept");
    logger.error("kept too");

    expect(lines.map((l) => JSON.parse(l).message)).toEqual(["kept", "kept too"]);
  });

  it("reads FOUNDRY_LOG_LEVEL and FOUNDRY_LOG_FORMAT from the environment", () => {
    const lines: string[] = [];
    const logger = createLogger({
      service: "runner",
      env: { FOUNDRY_LOG_LEVEL: "warn", FOUNDRY_LOG_FORMAT: "pretty" },
      sink: (l) => lines.push(l),
      now: () => new Date("2026-11-10T12:00:00.000Z"),
    });

    logger.info("dropped");
    logger.error("heartbeat failed", { runner: "alice-laptop" });

    expect(lines).toEqual(["2026-11-10T12:00:00.000Z ERROR runner heartbeat failed runner=alice-laptop"]);
  });

  it("binds child fields and lets children override them", () => {
    const lines: string[] = [];
    const root = createLogger({ service: "test", fields: { runner: "a" }, sink: (l) => lines.push(l) });
    const job = root.child({ jobId: "j1" });
    job.child({ stage: "verifying" }).warn("checks failed", { runner: "b" });

    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: "warn",
      message: "checks failed",
      runner: "b",
      jobId: "j1",
      stage: "verifying",
    });
  });

  it("does not let fields spoof reserved keys", () => {
    const { lines, logger } = capture();
    logger.info("real message", { level: "debug", service: "evil", ts: "x", message: "fake" });

    const record = JSON.parse(lines[0]!);
    expect(record).toMatchObject({ level: "info", service: "test", message: "real message" });
    expect(record.ts).toBe("2026-11-10T12:00:00.000Z");
  });

  it("serializes pretty lines with single-line messages", () => {
    const lines: string[] = [];
    const logger = createLogger({
      service: "test",
      format: "pretty",
      sink: (l) => lines.push(l),
      now: () => new Date("2026-11-10T12:00:00.000Z"),
    });

    logger.info("first\nsecond", { count: 2, detail: "two words" });

    expect(lines).toEqual(['2026-11-10T12:00:00.000Z INFO  test first\\nsecond count=2 detail="two words"']);
  });

  it("falls back to a valid record when fields cannot be serialized", () => {
    const { lines, logger } = capture();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    logger.info("bad fields", { circular });

    expect(JSON.parse(lines[0]!)).toMatchObject({ level: "info", fieldsError: expect.any(String) });
  });
});

describe("parseLogLevel", () => {
  it("accepts case-insensitive levels and falls back to info", () => {
    expect(parseLogLevel("WARN")).toBe("warn");
    expect(parseLogLevel("debug")).toBe("debug");
    expect(parseLogLevel(undefined)).toBe("info");
    expect(parseLogLevel("verbose")).toBe("info");
  });
});

describe("errorFields", () => {
  it("normalizes errors and other thrown values", () => {
    expect(errorFields(new Error("boom"))).toEqual({ error: "boom" });
    expect(errorFields("plain")).toEqual({ error: "plain" });
    expect(errorFields(new Error("boom"), "cause")).toEqual({ cause: "boom" });
  });
});
