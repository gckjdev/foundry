import { LinuxAdapter } from "./linux";
import { MacOsAdapter } from "./macos";
import type { OsAdapter } from "./types";

export * from "./exec";
export * from "./file-secrets";
export * from "./home";
export * from "./linux";
export * from "./macos";
export * from "./service-names";
export * from "./types";

export function currentOsAdapter(): OsAdapter {
  if (process.platform === "darwin") return new MacOsAdapter();
  if (process.platform === "linux") return new LinuxAdapter();
  throw new Error(`Foundry runners support macOS and Linux, not ${process.platform}`);
}
