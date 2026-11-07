import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  currentOsAdapter,
  type Exec,
  killTree,
  parseWindowsAcPower,
  platformExecutable,
  taskkillArgs,
  WindowsAdapter,
  which,
  windowsExecutablePath,
  windowsStartupScript,
} from "./index";

const spec = {
  binaryPath: "C:\\Program Files\\Foundry\\foundry.exe",
  args: ["runner", "start", "--home", "C:\\Users\\pipi\\.foundry"],
  mode: "user" as const,
  user: "pipi",
  workDir: "C:\\Users\\pipi\\.foundry",
  logDir: "C:\\Users\\pipi\\.foundry\\logs",
  name: "Pipi Windows",
  environment: { FOUNDRY_HOME: "C:\\Users\\pipi\\.foundry" },
};

describe("WindowsAdapter", () => {
  it("is the win32 adapter and reports os windows", () => {
    expect(new WindowsAdapter().os).toBe("windows");
    expect(currentOsAdapter("win32").os).toBe("windows");
  });

  it("throws only for unknown platforms", () => {
    expect(() => currentOsAdapter("freebsd" as NodeJS.Platform)).toThrow(/macOS, Linux, and Windows/);
  });

  it("parses the Win32_Battery output", () => {
    expect(parseWindowsAcPower("AC")).toBe(true);
    expect(parseWindowsAcPower("BATTERY")).toBe(false);
    expect(parseWindowsAcPower("")).toBeNull();
  });

  it("reads power and version through injected exec", async () => {
    const run: Exec = async (cmd, args) =>
      cmd === "powershell.exe" && args.some((a) => a.includes("Win32_Battery"))
        ? { code: 0, stdout: "BATTERY", stderr: "" }
        : { code: 0, stdout: "Microsoft Windows 11 Pro", stderr: "" };
    const os = new WindowsAdapter(run);
    expect(await os.onAcPower()).toBe(false);
    expect((await os.info()).osVersion).toBe("Microsoft Windows 11 Pro");
  });

  it("renders a Startup-folder launcher and empty lifecycle commands", () => {
    const install = new WindowsAdapter().service(spec);
    expect(install.path).toContain("Start Menu");
    expect(install.path).toContain("Startup");
    expect(install.path.endsWith("foundry-runner-pipi-windows.cmd")).toBe(true);
    expect(install.activate).toEqual([]);
    expect(install.deactivate).toEqual([]);
    expect(windowsStartupScript(spec)).toContain('set "FOUNDRY_HOME=C:\\Users\\pipi\\.foundry"');
    expect(windowsStartupScript(spec)).toContain(
      'start "Foundry runner" /min "C:\\Program Files\\Foundry\\foundry.exe" "runner" "start" "--home" "C:\\Users\\pipi\\.foundry"',
    );
  });

  it("stores the runner token in an encrypted file under the home directory", async () => {
    const prev = process.env.FOUNDRY_HOME;
    try {
      process.env.FOUNDRY_HOME = mkdtempSync(join(tmpdir(), "fwin-"));
      expect((await new WindowsAdapter().secrets()).kind).toBe("encrypted-file");
    } finally {
      if (prev === undefined) delete process.env.FOUNDRY_HOME;
      else process.env.FOUNDRY_HOME = prev;
    }
  });

  it("does not create a dedicated user and does not require cgroups", async () => {
    const os = new WindowsAdapter();
    expect(os.createUserCommands("foundry", "C:\\foundry")).toEqual([]);
    expect(await os.wrapWithLimits(["pnpm", "test"], { memMb: 4096 })).toEqual(["pnpm", "test"]);
  });
});

describe("Windows exec helpers", () => {
  it("resolves which through where.exe on Windows", async () => {
    const calls: string[][] = [];
    const run: Exec = async (cmd, args) => {
      calls.push([cmd, ...args]);
      return { code: 0, stdout: "", stderr: "" };
    };
    expect(await which(run, "git", "win32")).toBe(true);
    expect(calls[0]).toEqual(["where.exe", "git"]);
  });

  it("leaves executable names untouched off Windows", () => {
    expect(platformExecutable("opencode", "darwin")).toBe("opencode");
    expect(windowsExecutablePath("claude", "darwin")).toBeUndefined();
  });

  it("builds a taskkill process-tree command", () => {
    expect(taskkillArgs(4242, true)).toEqual(["/T", "/F", "/PID", "4242"]);
    expect(taskkillArgs(4242, false)).toEqual(["/T", "/PID", "4242"]);
    // Never throws when the process is already gone.
    expect(() => killTree(999_999_999, "SIGKILL", "darwin")).not.toThrow();
  });
});
