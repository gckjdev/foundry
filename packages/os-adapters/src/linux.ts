import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { arch, cpus, homedir, totalmem } from "node:os";
import { join } from "node:path";
import { dfFreeMb, exec as defaultExec, which } from "./exec";
import { FileSecretStore } from "./file-secrets";
import type { Exec, OsAdapter, ResourceLimits, SecretStore, ServiceInstall, ServiceSpec } from "./types";

export const SYSTEMD_UNIT = "foundry-runner.service";

export function parseOsRelease(text: string): string {
  const m = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(text);
  return m?.[1] ?? "Linux";
}

/**
 * Power state from /sys/class/power_supply entries: a mains adapter that is online means AC;
 * a battery with no online mains means battery; no supplies at all (desktop, VM) counts as AC.
 */
export function powerFromSupplies(supplies: { type: string; online?: string }[]): boolean | null {
  if (supplies.length === 0) return true;
  const mains = supplies.filter((s) => s.type === "Mains" || s.type === "USB");
  if (mains.some((s) => s.online === "1")) return true;
  if (supplies.some((s) => s.type === "Battery")) return false;
  return mains.length > 0 ? false : null;
}

/** `loginctl show-session -p IdleHint -p IdleSinceHint` (IdleSinceHint is µs since epoch). */
export function parseLoginctlIdle(out: string, nowMs = Date.now()): number | null {
  const hint = /IdleHint=(\w+)/.exec(out)?.[1];
  const since = Number(/IdleSinceHint=(\d+)/.exec(out)?.[1] ?? 0);
  if (!hint) return null;
  if (hint === "no") return 0;
  return since > 0 ? Math.max(0, Math.floor((nowMs - since / 1000) / 1000)) : null;
}

export function systemdUnit(spec: ServiceSpec): string {
  const user = spec.mode === "system" ? `User=${spec.user}\nGroup=${spec.user}\n` : "";
  return `[Unit]
Description=Foundry runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
${user}WorkingDirectory=${spec.workDir}
ExecStart=${[spec.binaryPath, ...spec.args].join(" ")}
Restart=always
RestartSec=5
KillMode=mixed
TimeoutStopSec=60
NoNewPrivileges=yes
StandardOutput=append:${join(spec.logDir, "runner.log")}
StandardError=append:${join(spec.logDir, "runner.log")}

[Install]
WantedBy=${spec.mode === "system" ? "multi-user.target" : "default.target"}
`;
}

/** systemd-creds (host key, root only): one encrypted credential file per secret. */
export class SystemdCredsStore implements SecretStore {
  readonly kind = "systemd-creds";
  constructor(
    private readonly dir: string,
    private readonly run: Exec = defaultExec,
  ) {}

  private path(key: string) {
    return join(this.dir, `${key.replace(/[^\w.-]/g, "_")}.cred`);
  }

  async get(key: string) {
    const r = await this.run("systemd-creds", ["decrypt", `--name=${key}`, this.path(key), "-"]);
    return r.code === 0 ? r.stdout : null;
  }

  async set(key: string, value: string) {
    await this.run("mkdir", ["-p", "-m", "0700", this.dir]);
    const r = await this.run("systemd-creds", ["encrypt", `--name=${key}`, "-", this.path(key)], { input: value });
    if (r.code !== 0) throw new Error(`systemd-creds encrypt failed: ${r.stderr.trim()}`);
  }

  async delete(key: string) {
    await this.run("rm", ["-f", this.path(key)]);
  }
}

export class LinuxAdapter implements OsAdapter {
  readonly os = "linux" as const;
  private userScopes: boolean | null = null;

  constructor(
    private readonly run: Exec = defaultExec,
    private readonly sysRoot = "/sys/class/power_supply",
  ) {}

  async info() {
    let pretty = "Linux";
    try {
      pretty = parseOsRelease(await readFile("/etc/os-release", "utf8"));
    } catch {
      // keep default
    }
    return { os: this.os, osVersion: pretty, arch: arch(), cpu: cpus().length, memMb: Math.round(totalmem() / 1024 / 1024) };
  }

  diskFreeMb(path: string) {
    return dfFreeMb(this.run, path);
  }

  async onAcPower() {
    let names: string[] = [];
    try {
      names = await readdir(this.sysRoot);
    } catch {
      return true;
    }
    const supplies = await Promise.all(
      names.map(async (n) => {
        const read = (f: string) => readFile(join(this.sysRoot, n, f), "utf8").then((s) => s.trim(), () => undefined);
        return { type: (await read("type")) ?? "", online: await read("online") };
      }),
    );
    return powerFromSupplies(supplies);
  }

  async idleSeconds() {
    const session = process.env.XDG_SESSION_ID;
    if (!session) return null;
    const r = await this.run("loginctl", ["show-session", session, "-p", "IdleHint", "-p", "IdleSinceHint"]);
    return r.code === 0 ? parseLoginctlIdle(r.stdout) : null;
  }

  async inhibitSleep(reason: string) {
    if (!(await which(this.run, "systemd-inhibit"))) return { release: () => {} };
    const child = spawn(
      "systemd-inhibit",
      ["--what=sleep:idle", "--who=foundry", `--why=${reason}`, "--mode=block", "sleep", "infinity"],
      { stdio: "ignore" },
    );
    child.on("error", () => {});
    return { release: () => child.kill() };
  }

  service(spec: ServiceSpec): ServiceInstall {
    const system = spec.mode === "system";
    const path = system ? `/etc/systemd/system/${SYSTEMD_UNIT}` : join(homedir(), ".config", "systemd", "user", SYSTEMD_UNIT);
    const ctl = system ? ["systemctl"] : ["systemctl", "--user"];
    return {
      path,
      contents: systemdUnit(spec),
      activate: [
        [...ctl, "daemon-reload"],
        [...ctl, "enable", "--now", SYSTEMD_UNIT],
        ...(system ? [] : [["loginctl", "enable-linger", process.env.USER ?? ""]]),
      ],
      deactivate: [[...ctl, "disable", "--now", SYSTEMD_UNIT]],
    };
  }

  createUserCommands(user: string, home: string) {
    return [["useradd", "--system", "--create-home", "--home-dir", home, "--shell", "/bin/bash", user]];
  }

  async secrets(): Promise<SecretStore> {
    const isRoot = process.getuid?.() === 0;
    if (isRoot && (await which(this.run, "systemd-creds"))) return new SystemdCredsStore("/var/lib/foundry/creds", this.run);
    return new FileSecretStore(join(homedir(), ".config", "foundry"));
  }

  async wrapWithLimits(argv: string[], limits: ResourceLimits) {
    if (!limits.memMb && !limits.cpuPercent) return argv;
    if (this.userScopes === null) {
      this.userScopes = (await this.run("systemd-run", ["--user", "--scope", "--quiet", "true"])).code === 0;
    }
    if (!this.userScopes) return ["nice", "-n", "5", ...argv];
    const props: string[] = [];
    if (limits.memMb) props.push("-p", `MemoryMax=${limits.memMb}M`);
    if (limits.cpuPercent) props.push("-p", `CPUQuota=${limits.cpuPercent}%`);
    return ["systemd-run", "--user", "--scope", "--quiet", "--collect", ...props, ...argv];
  }
}
