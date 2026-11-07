import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyRunnerHome, dataDir, loadConfig, notJoinedMessage, saveConfig } from "./config";

const schedule = { acPowerOnly: true, pauseWhenActiveMinutes: 0, windows: [], weekends: true };

function config(name: string) {
  return {
    serverUrl: "http://localhost:3000",
    runnerId: `id-${name}`,
    teamId: "team",
    name,
    kind: "personal" as const,
    maxConcurrency: 1,
    schedule,
    minFreeDiskMb: 10_000,
    limits: {},
  };
}

describe("runner homes", () => {
  it("loads two joined configs without sharing a directory", () => {
    const root = mkdtempSync(join(tmpdir(), "foundry-cfg-"));
    const homeA = join(root, "a");
    const homeB = join(root, "b");
    saveConfig(config("pipi-a"), homeA);
    saveConfig(config("pipi-b"), homeB);
    expect(loadConfig(homeA)?.name).toBe("pipi-a");
    expect(loadConfig(homeB)?.name).toBe("pipi-b");
    expect(loadConfig(homeA)?.runnerId).not.toBe(loadConfig(homeB)?.runnerId);
  });

  it("applies --home for later commands and names that directory when not joined", () => {
    const prev = process.env.FOUNDRY_HOME;
    const home = mkdtempSync(join(tmpdir(), "foundry-home-flag-"));
    try {
      applyRunnerHome("~/foundry-test-home");
      expect(dataDir()).toBe(join(homedir(), "foundry-test-home"));
      applyRunnerHome(home);
      expect(dataDir()).toBe(home);
      expect(notJoinedMessage()).toContain(home);
      expect(loadConfig()).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.FOUNDRY_HOME;
      else process.env.FOUNDRY_HOME = prev;
    }
  });
});
