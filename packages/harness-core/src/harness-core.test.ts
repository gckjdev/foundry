import { describe, expect, it } from "vitest";
import { AsyncQueue, FakeHarness, type HarnessEvent, isDeniedCommand } from "./index";

const opts = { cwd: "/tmp", model: "", systemPrompt: "", env: {}, mcpServers: [], permissions: { denyCommands: [], allowWebFetch: true } };

describe("AsyncQueue", () => {
  it("delivers pushed items in order and ends on close", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    setTimeout(() => {
      q.push(2);
      q.close();
    }, 5);
    const got: number[] = [];
    for await (const n of q) got.push(n);
    expect(got).toEqual([1, 2]);
  });
});

describe("FakeHarness", () => {
  it("replays scripted turns across start and resume", async () => {
    const h = new FakeHarness("claude-code", [
      { events: [{ kind: "message", role: "agent", text: "hi" }], costUsd: 0.1 },
      { events: [{ kind: "tool_call", tool: "Bash" }] },
    ]);
    const s1 = await h.start({ ...opts, prompt: "do it" });
    const e1: HarnessEvent[] = [];
    for await (const e of s1.events) e1.push(e);
    expect(await s1.done).toMatchObject({ status: "ok", costUsd: 0.1 });
    expect(e1.map((e) => e.kind)).toEqual(["message", "usage"]);
    const s2 = await h.resume(await s1.id, "answer", opts);
    for await (const _ of s2.events) {
      // drain
    }
    expect(h.calls.map((c) => [c.kind, c.sessionId])).toEqual([
      ["start", "fake-session-1"],
      ["resume", "fake-session-1"],
    ]);
  });

  it("can be stopped mid-turn", async () => {
    const h = new FakeHarness("opencode", [{ act: () => new Promise(() => {}) }]);
    const s = await h.start({ ...opts, prompt: "" });
    await h.stop(s);
    expect((await s.done).status).toBe("stopped");
  });
});

describe("isDeniedCommand", () => {
  it("matches prefixes and chained commands", () => {
    const deny = ["git push", "sudo"];
    expect(isDeniedCommand("git push origin main", deny)).toBe(true);
    expect(isDeniedCommand("pnpm test && git push", deny)).toBe(true);
    expect(isDeniedCommand("git pushd", deny)).toBe(false);
    expect(isDeniedCommand("pnpm test", deny)).toBe(false);
  });
});
