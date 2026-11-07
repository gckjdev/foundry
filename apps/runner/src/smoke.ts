import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessAdapter } from "@foundry/harness-core";
import { ToolServer } from "./tool-server";

export interface SmokeResult {
  harness: string;
  ok: boolean;
  detail: string;
  costUsd: number;
}

/**
 * `foundry doctor --live`: one tiny real session per harness. The agent must call the Foundry
 * `confidence` tool through the per-job MCP server, which proves the harness, its auth, and the
 * MCP bridge all work from this binary.
 */
export async function smokeTest(
  harness: HarnessAdapter,
  mcpCommand: { command: string; args: string[] },
  opts: { model?: string; timeoutMs?: number } = {},
): Promise<SmokeResult> {
  const cwd = mkdtempSync(join(tmpdir(), "foundry-smoke-"));
  execFileSync("git", ["init", "--quiet"], { cwd });
  const tools = new ToolServer(`/tmp/fdr-smoke-${process.pid}.sock`);
  await tools.start();
  let called = false;
  const token = tools.register("smoke", async (tool, args) => {
    if (tool === "confidence") called = true;
    return { text: `ok (${tool} ${JSON.stringify(args)})` };
  });
  const env = { FOUNDRY_MCP_SOCKET: tools.socketPath, FOUNDRY_JOB_ID: "smoke", FOUNDRY_MCP_TOKEN: token };
  let cost = 0;
  let lastText = "";
  try {
    const session = await harness.start({
      cwd,
      model: opts.model ?? "",
      systemPrompt: "You are testing a tool connection. Do exactly what the user asks and nothing else.",
      prompt:
        'Call the `confidence` tool from the `foundry` MCP server with level "high" and reasons ["smoke test"]. Then reply with the single word OK.',
      env,
      mcpServers: [{ name: "foundry", command: mcpCommand.command, args: mcpCommand.args, env }],
      permissions: { denyCommands: ["git push"], allowWebFetch: false },
      harnessPort: 41_980,
    });
    const timer = setTimeout(() => void harness.stop(session), opts.timeoutMs ?? 180_000);
    for await (const e of session.events) {
      if (e.kind === "usage") cost += e.costUsd;
      if (e.kind === "message") lastText = e.text;
      if (e.kind === "error") lastText = e.message;
    }
    const result = await session.done;
    clearTimeout(timer);
    const ok = result.status === "ok" && called;
    return {
      harness: harness.id,
      ok,
      detail: ok
        ? `session ok, MCP tool called, reply: ${lastText.slice(0, 80)}`
        : `${result.status}${result.error ? `: ${result.error}` : ""}; tool called: ${called}; last: ${lastText.slice(0, 200)}`,
      costUsd: cost,
    };
  } catch (err) {
    return { harness: harness.id, ok: false, detail: String(err), costUsd: cost };
  } finally {
    await harness.release?.(cwd).catch(() => {});
    await tools.close();
    rmSync(cwd, { recursive: true, force: true });
  }
}
