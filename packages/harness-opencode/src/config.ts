import type { McpServerConfig, PermissionPolicy } from "@foundry/harness-core";
import type { Config } from "@opencode-ai/sdk";

/**
 * The per-job OpenCode config (spec 5.8.1), passed as OPENCODE_CONFIG_CONTENT so nothing is
 * written into the worktree. Everything is allowed except the policy's denied commands, so a
 * headless run never stops on a permission prompt.
 */
export function opencodeConfig(opts: { mcpServers: McpServerConfig[]; permissions: PermissionPolicy; model?: string }): Config {
  const bash: Record<string, "allow" | "deny"> = { "*": "allow" };
  for (const d of opts.permissions.denyCommands) {
    const p = d.trim();
    bash[p] = "deny";
    bash[`${p} *`] = "deny";
  }
  return {
    ...(opts.model ? { model: opts.model } : {}),
    share: "disabled",
    autoupdate: false,
    permission: {
      edit: "allow",
      bash,
      webfetch: opts.permissions.allowWebFetch ? "allow" : "deny",
      doom_loop: "allow",
      external_directory: "deny",
    },
    mcp: Object.fromEntries(
      opts.mcpServers.map((s) => [
        s.name,
        { type: "local" as const, command: [s.command, ...s.args], environment: s.env ?? {}, enabled: true, timeout: 30_000 },
      ]),
    ),
  };
}

/** "anthropic/claude-sonnet-4-5" → { providerID: "anthropic", modelID: "claude-sonnet-4-5" }. */
export function splitModel(model: string): { providerID: string; modelID: string } | undefined {
  const i = model.indexOf("/");
  if (i <= 0) return undefined;
  return { providerID: model.slice(0, i), modelID: model.slice(i + 1) };
}
