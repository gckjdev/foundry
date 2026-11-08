import { describe, expect, it } from "vitest";
import { isRefreshMessage, tablesForPage } from "./realtime-tables";

const board = new Set(tablesForPage("/board"));

describe("panel realtime refresh", () => {
  it("refreshes the board when a job changes", () => {
    expect(isRefreshMessage(board, { type: "change", table: "jobs" })).toBe(true);
  });

  it("does not refresh the board for agent log rows or runner heartbeats", () => {
    // The runner flushes tool calls/messages into `events` every second and heartbeats
    // `runners` every 15 s; the board renders neither, so it must stop re-rendering on them.
    expect(tablesForPage("/board")).toEqual(["jobs"]);
    expect(isRefreshMessage(board, { type: "change", table: "events" })).toBe(false);
    expect(isRefreshMessage(board, { type: "change", table: "runners" })).toBe(false);
  });

  it("keeps the job page following its live events", () => {
    const job = new Set(tablesForPage("/jobs/3ddf935d"));
    expect(isRefreshMessage(job, { type: "change", table: "events" })).toBe(true);
    expect(isRefreshMessage(job, { type: "change", table: "questions" })).toBe(true);
  });

  it("does not refresh pages without live data", () => {
    for (const page of ["/settings", "/team", "/"]) {
      expect(tablesForPage(page)).toEqual([]);
      expect(isRefreshMessage(new Set(tablesForPage(page)), { type: "change", table: "jobs" })).toBe(false);
    }
  });

  it("ignores the hello frame and rows without a table", () => {
    expect(isRefreshMessage(board, { type: "hello" })).toBe(false);
    expect(isRefreshMessage(board, { type: "change" })).toBe(false);
  });
});
