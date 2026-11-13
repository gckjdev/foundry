import { socketBridge } from "@foundry/mcp-foundry";
import { afterEach, describe, expect, it } from "vitest";
import { testSocketPath } from "./testing";
import { ToolServer } from "./tool-server";

describe("ToolServer", () => {
  let server: ToolServer | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it("rejects a second registration for a job instead of clobbering its token", async () => {
    const srv = new ToolServer(testSocketPath());
    server = srv;
    await srv.start();
    const token = srv.register("job-1", async () => ({ text: "first" }));
    expect(() => srv.register("job-1", async () => ({ text: "second" }))).toThrow(/already registered/);

    // The original session keeps working: its token was not overwritten.
    const bridge = socketBridge(srv.socketPath, "job-1", token);
    await expect(bridge.call("stage", { name: "investigating" })).resolves.toEqual({ text: "first" });
  });

  it("refuses a token from a registration that has been replaced", async () => {
    const srv = new ToolServer(testSocketPath());
    server = srv;
    await srv.start();
    const stale = srv.register("job-2", async () => ({ text: "first" }));
    srv.unregister("job-2");
    const fresh = srv.register("job-2", async () => ({ text: "second" }));

    const bridge = socketBridge(srv.socketPath, "job-2", fresh);
    await expect(bridge.call("stage", {})).resolves.toEqual({ text: "second" });

    const staleBridge = socketBridge(srv.socketPath, "job-2", stale);
    await expect(staleBridge.call("stage", {})).resolves.toMatchObject({
      isError: true,
      text: expect.stringContaining("not running on this runner"),
    });
  });
});
