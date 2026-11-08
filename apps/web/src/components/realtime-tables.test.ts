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

  it("does not refresh the board for a cost-only jobs update", () => {
    expect(
      isRefreshMessage(board, {
        type: "change",
        table: "jobs",
        op: "UPDATE",
        columns: ["cost_usd", "tokens_in", "tokens_out", "updated_at"],
      }),
    ).toBe(false);
  });

  it("refreshes the board when a job's status (or any meaningful column) changes", () => {
    expect(
      isRefreshMessage(board, {
        type: "change",
        table: "jobs",
        op: "UPDATE",
        columns: ["status", "updated_at"],
      }),
    ).toBe(true);
    expect(
      isRefreshMessage(board, {
        type: "change",
        table: "jobs",
        op: "UPDATE",
        columns: ["title", "updated_at"],
      }),
    ).toBe(true);
  });

  it("refreshes the board on job insert and delete regardless of columns", () => {
    expect(isRefreshMessage(board, { type: "change", table: "jobs", op: "INSERT", columns: [] })).toBe(true);
    expect(isRefreshMessage(board, { type: "change", table: "jobs", op: "DELETE", columns: [] })).toBe(true);
  });

  it("still refreshes when the payload has no column info (older realtime)", () => {
    expect(isRefreshMessage(board, { type: "change", table: "jobs", op: "UPDATE" })).toBe(true);
  });

  it("does not suppress updates for tables without a noise map", () => {
    const runners = new Set(tablesForPage("/runners"));
    expect(
      isRefreshMessage(runners, { type: "change", table: "runners", op: "UPDATE", columns: ["updated_at"] }),
    ).toBe(true);
  });
});
