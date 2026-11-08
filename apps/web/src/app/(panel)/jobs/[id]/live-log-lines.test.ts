import { describe, expect, it } from "vitest";
import { type Line, mergeLines } from "./live-log-lines";

function line(id: number): Line {
  return {
    id,
    ts: "2026-01-01T00:00:00.000Z",
    payload: { kind: "log", level: "info", message: `line ${id}` },
  };
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
