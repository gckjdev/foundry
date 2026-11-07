import { LinuxAdapter } from "./linux";
import { MacOsAdapter } from "./macos";
import type { OsAdapter } from "./types";
import { WindowsAdapter } from "./windows";

export * from "./exec";
export * from "./file-secrets";
export * from "./home";
export * from "./linux";
export * from "./macos";
export * from "./service-names";
export * from "./types";
export * from "./windows";

export function currentOsAdapter(platform: NodeJS.Platform = process.platform): OsAdapter {
  if (platform === "darwin") return new MacOsAdapter();
  if (platform === "linux") return new LinuxAdapter();
  if (platform === "win32") return new WindowsAdapter();
  throw new Error(`Foundry runners support macOS, Linux, and Windows, not ${platform}`);
}
