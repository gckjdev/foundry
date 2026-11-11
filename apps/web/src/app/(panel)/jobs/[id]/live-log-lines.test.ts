import type { FoundryEvent } from "@foundry/shared";
import { describe, expect, it } from "vitest";
import { type Line, mergeLines, needsServerRefresh } from "./live-log-lines";

function line(id: number): Line {
  return {
    id,
    ts: "2026-01-01T00:00:00.000Z",
    payload: { kind: "log", level: "info", message: `line ${id}` },
  };
}

function eventLine(payload: FoundryEvent): Line {
  return { id: 1, ts: "2026-01-01T00:00:00.000Z", payload };
}

function ids(lines: Line[]): number[] {
  return lines.map((l) => l.id);
}

describe("live log merging", () => {
  it("appends new events in order", () => {
    expect(ids(mergeLines([line(1), line(2)], [line(3)]))).toEqual([1, 2, 3]);
  });

  it("drops events that two overlapping polls both fetched", () => {
    // React Strict Mode runs the polling effect twice in development; both loops can append the
    // same batch and produce duplicate React keys.
    const first = mergeLines([line(1)], [line(2), line(3)]);
    const second = mergeLines(first, [line(2), line(3)]);
    expect(ids(second)).toEqual([1, 2, 3]);
  });

  it("drops duplicate ids inside a single batch", () => {
    expect(ids(mergeLines([], [line(4), line(4), line(5)]))).toEqual([4, 5]);
  });

  it("keeps the previous array when nothing is new", () => {
    const prev = [line(1), line(2)];
    expect(mergeLines(prev, [line(2)])).toBe(prev);
  });

  it("keeps only the last 1000 lines", () => {
    const prev = Array.from({ length: 1000 }, (_, i) => line(i + 1));
    const merged = mergeLines(prev, [line(1001), line(1002)]);
    expect(merged).toHaveLength(1000);
    expect(ids(merged).at(0)).toBe(3);
    expect(ids(merged).at(-1)).toBe(1002);
  });
});

describe("job page server refresh from polled events", () => {
  it("does not refresh for kinds the live log draws itself", () => {
    const logOnly: FoundryEvent[] = [
      { kind: "tool_call", tool: "Read" },
      { kind: "usage", tokensIn: 1, tokensOut: 2, costUsd: 0.01 },
      { kind: "log", level: "info", message: "working" },
      { kind: "subagent_started", name: "explorer" },
    ];
    expect(needsServerRefresh(logOnly.map(eventLine))).toBe(false);
  });

  it("does not refresh for agent or system messages, which the Timeline does not render", () => {
    // Harnesses report every assistant turn as a `message` event; refreshing on those would put
    // the per-turn storm back. The server-rendered Timeline only shows human messages.
    expect(needsServerRefresh([eventLine({ kind: "message", role: "agent", text: "thinking…" })])).toBe(
      false,
    );
    expect(
      needsServerRefresh([eventLine({ kind: "message", role: "system", text: "Pull request opened" })]),
    ).toBe(false);
  });

  it("refreshes when evidence is recorded, so the Evidence card fills in", () => {
    // `runnerEvidence` inserts the evidence row and an event but never touches `jobs`.
    expect(needsServerRefresh([eventLine({ kind: "evidence", name: "lint", status: "passed" })])).toBe(true);
  });

  it("refreshes for timeline entries that do not move the job row", () => {
    const timeline: FoundryEvent[] = [
      { kind: "stage_changed", from: "implementing", to: "reviewing" },
      { kind: "checkpoint", stage: "implementing", briefRef: "refs/foundry/x/brief" },
      { kind: "gate", pass: false, failed: [{ rule: "ci", detail: "red" }] },
      { kind: "error", message: "harness exited" },
      { kind: "message", role: "human", text: "from GitHub" },
      { kind: "question", questionId: "q1", prompt: "proceed?" },
      { kind: "answer", questionId: "q1", text: "yes", by: "pipi" },
      { kind: "resumed", runnerId: "r1", runnerName: "laptop", mode: "sticky", harnessChanged: false },
    ];
    for (const payload of timeline) {
      expect(needsServerRefresh([eventLine(payload)])).toBe(true);
    }
  });

  it("does not refresh for an empty poll", () => {
    expect(needsServerRefresh([])).toBe(false);
  });
});
