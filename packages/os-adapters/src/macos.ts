import { spawn } from "node:child_process";
import { arch, cpus, homedir, totalmem } from "node:os";
import { join } from "node:path";
import { exec as defaultExec, dfFreeMb } from "./exec";
import { FileSecretStore } from "./file-secrets";
import type { Exec, OsAdapter, ResourceLimits, SecretStore, ServiceInstall, ServiceSpec } from "./types";

export const LAUNCHD_LABEL = "dev.foundry.runner";
const KEYCHAIN_SERVICE_PREFIX = "dev.foundry.";

export function parsePmsetBatt(out: string): boolean | null {
  if (/AC Power/.test(out)) return true;
  if (/Battery Power/.test(out)) return false;
  return null;
}

/** `ioreg -c IOHIDSystem` reports HIDIdleTime in nanoseconds. */
export function parseHidIdle(out: string): number | null {
  const m = /"HIDIdleTime"\s*=\s*(\d+)/.exec(out);
  return m ? Math.floor(Number(m[1]) / 1e9) : null;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function launchdPlist(spec: ServiceSpec): string {
  const args = [spec.binaryPath, ...spec.args].map((a) => `    <string>${xml(a)}</string>`).join("\n");
  const user = spec.mode === "system" ? `  <key>UserName</key>\n  <string>${xml(spec.user)}</string>\n` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
${user}  <key>WorkingDirectory</key>
  <string>${xml(spec.workDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(join(spec.logDir, "runner.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(join(spec.logDir, "runner.log"))}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
`;
}

/** Keychain items for the runner user, through the `security` CLI. */
export class KeychainSecretStore implements SecretStore {
  readonly kind = "keychain";
  constructor(
    private readonly account: string,
    private readonly run: Exec = defaultExec,
  ) {}

  async get(key: string) {
    const r = await this.run("security", [
      "find-generic-password",
      "-a",
      this.account,
      "-s",
      KEYCHAIN_SERVICE_PREFIX + key,
      "-w",
    ]);
    return r.code === 0 ? r.stdout.replace(/\n$/, "") : null;
  }

  async set(key: string, value: string) {
    // -U updates an existing item. The value goes through argv briefly; `security` has no stdin mode for -w.
    const r = await this.run("security", [
      "add-generic-password",
      "-U",
      "-a",
      this.account,
      "-s",
      KEYCHAIN_SERVICE_PREFIX + key,
      "-w",
      value,
    ]);
    if (r.code !== 0) throw new Error(`keychain write failed: ${r.stderr.trim()}`);
  }

  async delete(key: string) {
    await this.run("security", [
      "delete-generic-password",
      "-a",
      this.account,
      "-s",
      KEYCHAIN_SERVICE_PREFIX + key,
    ]);
  }
}

export class MacOsAdapter implements OsAdapter {
  readonly os = "macos" as const;
  constructor(private readonly run: Exec = defaultExec) {}

  async info() {
    const v = await this.run("sw_vers", ["-productVersion"]);
    return {
      os: this.os,
      osVersion: v.stdout.trim() || "unknown",
      arch: arch(),
      cpu: cpus().length,
      memMb: Math.round(totalmem() / 1024 / 1024),
    };
  }

  diskFreeMb(path: string) {
    return dfFreeMb(this.run, path);
  }

  async onAcPower() {
    const r = await this.run("pmset", ["-g", "batt"]);
    return r.code === 0 ? parsePmsetBatt(r.stdout) : null;
  }

  async idleSeconds() {
    const r = await this.run("ioreg", ["-c", "IOHIDSystem", "-d", "4"]);
    return r.code === 0 ? parseHidIdle(r.stdout) : null;
  }

  async inhibitSleep(_reason: string) {
    // `-i` prevents idle sleep; `-w` ties it to our pid so a crashed runner never leaks it.
    const child = spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
    child.on("error", () => {});
    return { release: () => child.kill() };
  }

  service(spec: ServiceSpec): ServiceInstall {
    const path =
      spec.mode === "system"
        ? `/Library/LaunchDaemons/${LAUNCHD_LABEL}.plist`
        : join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
    const domain = spec.mode === "system" ? "system" : `gui/${process.getuid?.() ?? 501}`;
    return {
      path,
      contents: launchdPlist(spec),
      activate: [["launchctl", "bootstrap", domain, path]],
      deactivate: [["launchctl", "bootout", `${domain}/${LAUNCHD_LABEL}`]],
    };
  }

  createUserCommands(user: string, home: string) {
    return [
      [
        "sysadminctl",
        "-addUser",
        user,
        "-fullName",
        "Foundry Runner",
        "-home",
        home,
        "-shell",
        "/bin/zsh",
        "-password",
        "-",
      ],
      ["dscl", ".", "create", `/Users/${user}`, "IsHidden", "1"],
      ["createhomedir", "-c", "-u", user],
    ];
  }

  async secrets(): Promise<SecretStore> {
    // A custom FOUNDRY_HOME is a second runner on this login; keep its token out of the shared Keychain.
    if (process.env.FOUNDRY_HOME) return new FileSecretStore(join(process.env.FOUNDRY_HOME, "secrets"));
    return new KeychainSecretStore(process.env.USER ?? "foundry", this.run);
  }

  async wrapWithLimits(argv: string[], _limits: ResourceLimits) {
    // macOS has no cgroups: lower priority here; the runner watches memory and kills the group.
    return ["nice", "-n", "5", ...argv];
  }
}
