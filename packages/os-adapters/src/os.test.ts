import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Exec,
  FileSecretStore,
  LinuxAdapter,
  launchdPlist,
  MacOsAdapter,
  parseHidIdle,
  parseLoginctlIdle,
  parseOsRelease,
  parsePmsetBatt,
  powerFromSupplies,
  systemdUnit,
} from "./index";

const spec = {
  binaryPath: "/usr/local/bin/foundry",
  args: ["runner", "start"],
  mode: "system" as const,
  user: "foundry",
  workDir: "/var/lib/foundry",
  logDir: "/var/log/foundry",
};

describe("macOS parsing", () => {
  it("reads pmset and ioreg", () => {
    expect(parsePmsetBatt("Now drawing from 'AC Power'\n -InternalBattery-0 100%")).toBe(true);
    expect(parsePmsetBatt("Now drawing from 'Battery Power'")).toBe(false);
    expect(parseHidIdle('    |   "HIDIdleTime" = 125000000000')).toBe(125);
  });
  it("renders a launchd daemon running as the foundry user", () => {
    const plist = launchdPlist(spec);
    expect(plist).toContain("<string>dev.foundry.runner</string>");
    expect(plist).toContain("<key>UserName</key>\n  <string>foundry</string>");
    expect(plist).toContain("<string>/usr/local/bin/foundry</string>\n    <string>runner</string>");
  });
  it("uses the injected exec for power state", async () => {
    const run: Exec = async (cmd) => ({
      code: 0,
      stdout: cmd === "pmset" ? "Now drawing from 'Battery Power'" : "",
      stderr: "",
    });
    expect(await new MacOsAdapter(run).onAcPower()).toBe(false);
  });
});

describe("Linux parsing", () => {
  it("reads os-release, power supplies and logind idle", () => {
    expect(parseOsRelease('NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n')).toBe("Ubuntu 24.04.1 LTS");
    expect(powerFromSupplies([])).toBe(true);
    expect(powerFromSupplies([{ type: "Mains", online: "1" }, { type: "Battery" }])).toBe(true);
    expect(powerFromSupplies([{ type: "Mains", online: "0" }, { type: "Battery" }])).toBe(false);
    expect(parseLoginctlIdle("IdleHint=no\nIdleSinceHint=0")).toBe(0);
    expect(parseLoginctlIdle("IdleHint=yes\nIdleSinceHint=1000000000", 1_060_000)).toBe(60);
  });
  it("renders a hardened systemd unit", () => {
    const unit = systemdUnit(spec);
    expect(unit).toContain("User=foundry");
    expect(unit).toContain("ExecStart=/usr/local/bin/foundry runner start");
    expect(unit).toContain("WantedBy=multi-user.target");
  });
  it("wraps job commands in a cgroup scope when user scopes work", async () => {
    const run: Exec = async () => ({ code: 0, stdout: "", stderr: "" });
    expect(
      await new LinuxAdapter(run).wrapWithLimits(["pnpm", "test"], { memMb: 4096, cpuPercent: 200 }),
    ).toEqual([
      "systemd-run",
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      "-p",
      "MemoryMax=4096M",
      "-p",
      "CPUQuota=200%",
      "pnpm",
      "test",
    ]);
    const failing: Exec = async () => ({ code: 1, stdout: "", stderr: "" });
    expect(await new LinuxAdapter(failing).wrapWithLimits(["x"], { memMb: 1 })).toEqual([
      "nice",
      "-n",
      "5",
      "x",
    ]);
  });
});

describe("FileSecretStore", () => {
  it("round-trips encrypted secrets", async () => {
    const store = new FileSecretStore(mkdtempSync(join(tmpdir(), "fsec-")));
    expect(await store.get("k")).toBeNull();
    await store.set("k", "s3cret");
    await store.set("other", "v");
    expect(await store.get("k")).toBe("s3cret");
    await store.delete("k");
    expect(await store.get("k")).toBeNull();
    expect(await store.get("other")).toBe("v");
  });
});
