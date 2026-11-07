import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Default runner data directory for this login. */
export function defaultFoundryHome(): string {
  return join(homedir(), ".foundry");
}

/** Expand `~` and resolve a home path to an absolute directory. */
export function resolveFoundryHome(input: string): string {
  const trimmed = input.trim();
  const expanded =
    trimmed === "~" ? homedir() : trimmed.startsWith("~/") ? join(homedir(), trimmed.slice(2)) : trimmed;
  return resolve(expanded);
}

/** Home for this process. `FOUNDRY_HOME` wins; otherwise `~/.foundry`. */
export function foundryHome(): string {
  const raw = process.env.FOUNDRY_HOME?.trim();
  return raw ? resolveFoundryHome(raw) : defaultFoundryHome();
}

/**
 * A non-default home, or null when this process should use the shared secret store
 * (Keychain on macOS, `~/.config/foundry` or systemd-creds on Linux).
 */
export function customFoundryHome(): string | null {
  const raw = process.env.FOUNDRY_HOME?.trim();
  if (!raw) return null;
  const resolved = resolveFoundryHome(raw);
  return resolved === resolve(defaultFoundryHome()) ? null : resolved;
}
