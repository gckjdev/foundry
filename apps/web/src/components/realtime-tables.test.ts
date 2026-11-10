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

  it("still refreshes when an update carries no column info (older realtime)", () => {
    expect(isRefreshMessage(board, { type: "change", table: "jobs", op: "UPDATE" })).toBe(true);
    // The realtime service normalizes a missing `columns` list to `[]`, so an empty list must
    // fail open too — otherwise every UPDATE would be dropped when the trigger cannot report it.
    expect(isRefreshMessage(board, { type: "change", table: "jobs", op: "UPDATE", columns: [] })).toBe(true);
  });

  it("does not suppress updates for tables without a noise map", () => {
    const runners = new Set(tablesForPage("/runners"));
    expect(
      isRefreshMessage(runners, { type: "change", table: "runners", op: "UPDATE", columns: ["updated_at"] }),
    ).toBe(true);
  });
});

describe("inbox key events", () => {
  const inbox = new Set(tablesForPage("/inbox"));

  it("watches the jobs and questions it renders", () => {
    expect(tablesForPage("/inbox")).toEqual(["jobs", "questions"]);
  });

  it("refreshes when a question is asked", () => {
    expect(isRefreshMessage(inbox, { type: "change", table: "questions", op: "INSERT", columns: [] })).toBe(
      true,
    );
  });

  it("refreshes when a question is answered", () => {
    expect(
      isRefreshMessage(inbox, {
        type: "change",
        table: "questions",
        op: "UPDATE",
        columns: ["answer", "answered_by", "answered_at"],
      }),
    ).toBe(true);
  });

  it("refreshes when one of its jobs moves, is created, or is removed", () => {
    expect(
      isRefreshMessage(inbox, { type: "change", table: "jobs", op: "UPDATE", columns: ["status"] }),
    ).toBe(true);
    expect(isRefreshMessage(inbox, { type: "change", table: "jobs", op: "INSERT", columns: [] })).toBe(true);
    expect(isRefreshMessage(inbox, { type: "change", table: "jobs", op: "DELETE", columns: [] })).toBe(true);
  });

  it("does not refresh for agent events, runner heartbeats or cost ticks", () => {
    expect(isRefreshMessage(inbox, { type: "change", table: "events" })).toBe(false);
    expect(isRefreshMessage(inbox, { type: "change", table: "runners" })).toBe(false);
    expect(
      isRefreshMessage(inbox, {
        type: "change",
        table: "jobs",
        op: "UPDATE",
        columns: ["cost_usd", "tokens_in", "tokens_out", "updated_at"],
      }),
    ).toBe(false);
  });

  it("does not refresh when only a question's GitHub comment id is stored", () => {
    // `askQuestion` inserts the question (already a refresh) and then stores the comment id.
    expect(
      isRefreshMessage(inbox, {
        type: "change",
        table: "questions",
        op: "UPDATE",
        columns: ["gh_comment_id"],
      }),
    ).toBe(false);
  });
});

describe("runners page key events", () => {
  const runners = new Set(tablesForPage("/runners"));

  it("watches runners and the jobs they are running", () => {
    expect(tablesForPage("/runners")).toEqual(["runners", "jobs"]);
  });

  it("refreshes on runner heartbeats and job changes", () => {
    expect(
      isRefreshMessage(runners, {
        type: "change",
        table: "runners",
        op: "UPDATE",
        columns: ["last_seen_at"],
      }),
    ).toBe(true);
    expect(
      isRefreshMessage(runners, { type: "change", table: "jobs", op: "UPDATE", columns: ["status"] }),
    ).toBe(true);
  });

  it("does not refresh for agent event rows", () => {
    expect(isRefreshMessage(runners, { type: "change", table: "events" })).toBe(false);
  });
});
