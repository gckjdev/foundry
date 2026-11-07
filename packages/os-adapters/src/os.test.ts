import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  currentOsAdapter,
  type Exec,
  FileSecretStore,
  KeychainSecretStore,
  LinuxAdapter,
  launchdPlist,
  MacOsAdapter,
  parseHidIdle,
  parseLoginctlIdle,
  parseOsRelease,
  parsePmsetBatt,
  powerFromSupplies,
  SystemdCredsStore,
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

describe("current OS", () => {
  it("returns the macOS adapter on darwin", () => {
    if (process.platform !== "darwin") return;
    expect(currentOsAdapter().os).toBe("macos");
  });
});

describe("FOUNDRY_HOME secrets", () => {
  const prev = process.env.FOUNDRY_HOME;
  const restore = () => {
    if (prev === undefined) delete process.env.FOUNDRY_HOME;
    else process.env.FOUNDRY_HOME = prev;
  };

  it("keeps a second runner's token out of the default macOS Keychain", async () => {
    process.env.FOUNDRY_HOME = mkdtempSync(join(tmpdir(), "foundry-home-"));
    try {
      const store = await new MacOsAdapter().secrets();
      expect(store.kind).toBe("encrypted-file");
    } finally {
      restore();
    }
  });

  it("keeps the default directory on the shared secret store", async () => {
    process.env.FOUNDRY_HOME = join(homedir(), ".foundry");
    try {
      expect((await new MacOsAdapter().secrets()).kind).toBe("keychain");
    } finally {
      restore();
    }
  });

  it("does not let a second home overwrite the first token", async () => {
    const homeA = mkdtempSync(join(tmpdir(), "foundry-a-"));
    const homeB = mkdtempSync(join(tmpdir(), "foundry-b-"));
    const linux = new LinuxAdapter(async () => ({ code: 1, stdout: "", stderr: "" }));
    try {
      process.env.FOUNDRY_HOME = homeA;
      await (await new MacOsAdapter().secrets()).set("runner-token", "token-a");
      process.env.FOUNDRY_HOME = homeB;
      await (await linux.secrets()).set("runner-token", "token-b");
      process.env.FOUNDRY_HOME = homeA;
      expect(await (await new MacOsAdapter().secrets()).get("runner-token")).toBe("token-a");
      process.env.FOUNDRY_HOME = homeB;
      expect(await (await linux.secrets()).get("runner-token")).toBe("token-b");
    } finally {
      restore();
    }
  });
});

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
  it("gives a named runner its own label and FOUNDRY_HOME", () => {
    const named = {
      ...spec,
      name: "Pipi OpenCode",
      environment: { FOUNDRY_HOME: "/tmp/foundry-b" },
    };
    const plist = launchdPlist(named);
    expect(plist).toContain("<string>dev.foundry.runner.pipi-opencode</string>");
    expect(plist).toContain("<key>FOUNDRY_HOME</key>\n    <string>/tmp/foundry-b</string>");
    const install = new MacOsAdapter().service(named);
    expect(install.path).toBe("/Library/LaunchDaemons/dev.foundry.runner.pipi-opencode.plist");
    expect(install.deactivate.flat()).toContain("system/dev.foundry.runner.pipi-opencode");
    expect(install.contents).toContain("<key>KeepAlive</key>");
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
    expect(unit).toContain("Restart=always");
  });
  it("gives a named runner its own unit and FOUNDRY_HOME", () => {
    const named = {
      ...spec,
      mode: "user" as const,
      name: "pipi-b",
      environment: { FOUNDRY_HOME: "/tmp/foundry-b" },
    };
    const unit = systemdUnit(named);
    expect(unit).toContain("Description=Foundry runner (pipi-b)");
    expect(unit).toContain("Environment=FOUNDRY_HOME=/tmp/foundry-b");
    expect(unit).toContain("Restart=always");
    const install = new LinuxAdapter(async () => ({ code: 0, stdout: "", stderr: "" })).service(named);
    expect(install.path).toContain("foundry-runner-pipi-b.service");
    expect(install.activate.flat()).toContain("foundry-runner-pipi-b.service");
    expect(install.deactivate.flat()).toContain("foundry-runner-pipi-b.service");
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

const ok =
  (stdout = "", code = 0): Exec =>
  async () => ({ code, stdout, stderr: "no" });

describe("secret stores with a fake exec", () => {
  it("reads and writes the macOS keychain through the security CLI", async () => {
    const store = new KeychainSecretStore("pipi", ok("s3cret\n"));
    expect(await store.get("runner-token")).toBe("s3cret");
    await store.set("runner-token", "next");
    await store.delete("runner-token");
    const failing = new KeychainSecretStore("pipi", ok("", 1));
    expect(await failing.get("missing")).toBeNull();
    await expect(failing.set("k", "v")).rejects.toThrow(/keychain write failed/);
  });

  it("reads and writes systemd credentials", async () => {
    const store = new SystemdCredsStore("/var/lib/foundry/creds", ok("tok"));
    expect(store.kind).toBe("systemd-creds");
    expect(await store.get("runner-token")).toBe("tok");
    await store.set("runner-token", "next");
    await store.delete("runner-token");
    const failing = new SystemdCredsStore("/tmp/creds", ok("", 1));
    expect(await failing.get("missing")).toBeNull();
    await expect(failing.set("k", "v")).rejects.toThrow(/systemd-creds encrypt failed/);
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
