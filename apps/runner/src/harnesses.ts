import { ClaudeCodeAdapter } from "@foundry/harness-claude-code";
import type { HarnessAdapter } from "@foundry/harness-core";
import { OpencodeAdapter } from "@foundry/harness-opencode";

/** Harnesses this runner can drive; the job's `harness` picks one. */
export function defaultHarnesses(): Partial<Record<string, HarnessAdapter>> {
  return {
    "claude-code": new ClaudeCodeAdapter(),
    opencode: new OpencodeAdapter(),
  };
}
