import { describe, expect, it } from "vitest";
import { shellArgv } from "./checks";

describe("shellArgv", () => {
  it("uses sh -c on macOS/Linux", () => {
    expect(shellArgv("pnpm test", "darwin")).toEqual(["sh", "-c", "pnpm test"]);
    expect(shellArgv("pnpm test", "linux")).toEqual(["sh", "-c", "pnpm test"]);
  });

  it("runs recipe commands through PowerShell on Windows", () => {
    expect(shellArgv("pnpm test", "win32", "pwsh")).toEqual([
      "pwsh",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "pnpm test",
    ]);
    expect(shellArgv("pnpm test", "win32", "powershell.exe")).toEqual([
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "pnpm test",
    ]);
  });
});
