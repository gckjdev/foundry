import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { arch, cpus, homedir, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { exec as defaultExec } from "./exec";
import { FileSecretStore } from "./file-secrets";
import { customFoundryHome } from "./home";
import { serviceSlug } from "./service-names";
import type { Exec, OsAdapter, ResourceLimits, SecretStore, ServiceInstall, ServiceSpec } from "./types";

/** `SetThreadExecutionState` flags: continuous + system required (prevent sleep). */
const ES_CONTINUOUS = 0x80000000;
const ES_SYSTEM_REQUIRED = 0x00000001;

export const WINDOWS_SLEEP_INHIBIT_SCRIPT = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class FoundryWake { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f); }' -ErrorAction SilentlyContinue; [FoundryWake]::SetThreadExecutionState(${ES_CONTINUOUS | ES_SYSTEM_REQUIRED}) | Out-Null; Start-Sleep -Seconds 86400`;

const AC_POWER_SCRIPT =
  "$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue; if ($null -eq $b) { 'AC' } elseif ($b.BatteryStatus -eq 1) { 'BATTERY' } else { 'AC' }";

const OS_VERSION_SCRIPT = "(Get-CimInstance Win32_OperatingSystem).Caption";

/** `Get-CimInstance Win32_Battery` → `AC` / `BATTERY` output (desktops and charged laptops are AC). */
export function parseWindowsAcPower(out: string): boolean | null {
  const s = out.trim().toLowerCase();
  if (s.includes("battery")) return false;
  if (s.includes("ac")) return true;
  return null;
}

function cmdQuote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** A Startup-folder `.cmd` that launches the runner minimized, then exits. */
export function windowsStartupScript(spec: ServiceSpec): string {
  const lines = ["@echo off"];
  for (const [key, value] of Object.entries(spec.environment ?? {})) lines.push(`set "${key}=${value}"`);
  lines.push(`start "Foundry runner" /min ${cmdQuote(spec.binaryPath)} ${spec.args.map(cmdQuote).join(" ")}`);
  return `${lines.join("\r\n")}\r\n`;
}

export class WindowsAdapter implements OsAdapter {
  readonly os = "windows" as const;

  constructor(private readonly run: Exec = defaultExec) {}

  async info() {
    const r = await this.run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      OS_VERSION_SCRIPT,
    ]);
    return {
      os: this.os,
      osVersion: r.stdout.trim() || "Windows",
      arch: arch(),
      cpu: cpus().length,
      memMb: Math.round(totalmem() / 1024 / 1024),
    };
  }

  async diskFreeMb(path: string) {
    // `df` does not exist on Windows; statfs reports the volume's free space.
    let target = path;
    while (target !== dirname(target) && !existsSync(target)) target = dirname(target);
    const s = await statfs(target);
    return Math.floor((Number(s.bavail) * Number(s.bsize)) / (1024 * 1024));
  }

  async onAcPower() {
    const r = await this.run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      AC_POWER_SCRIPT,
    ]);
    return r.code === 0 ? parseWindowsAcPower(r.stdout) : null;
  }

  async idleSeconds() {
    // Best-effort (GetLastInputInfo P/Invoke) is left for a later pass; returning null disables
    // pause-when-active on Windows, which matches the v1 personal-laptop target.
    return null;
  }

  async inhibitSleep(_reason: string) {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_SLEEP_INHIBIT_SCRIPT],
      { stdio: "ignore", detached: true, windowsHide: true },
    );
    child.on("error", () => {});
    return { release: () => child.kill() };
  }

  service(spec: ServiceSpec): ServiceInstall {
    const name = spec.name ? serviceSlug(spec.name) : "runner";
    const startupDir = join(
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Startup",
    );
    return {
      path: join(startupDir, `foundry-runner-${name}.cmd`),
      contents: windowsStartupScript(spec),
      activate: [],
      deactivate: [],
    };
  }

  createUserCommands(_user: string, _home: string) {
    // v1 personal runners run as the logged-in user; no dedicated account to create.
    return [];
  }

  async secrets(): Promise<SecretStore> {
    const home = customFoundryHome();
    if (home) return new FileSecretStore(join(home, "secrets"));
    return new FileSecretStore(join(homedir(), ".foundry"));
  }

  async wrapWithLimits(argv: string[], _limits: ResourceLimits) {
    // No cgroups on Windows; the runner already watches memory and kills the tree on timeout.
    return argv;
  }
}
