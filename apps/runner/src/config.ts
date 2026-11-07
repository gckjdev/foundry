import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { LAPTOP_DEFAULT_SCHEDULE, type LocalSchedule, SHARED_DEFAULT_SCHEDULE } from "@foundry/shared";
import { z } from "zod";

export const ScheduleSchema = z.object({
  acPowerOnly: z.boolean(),
  pauseWhenActiveMinutes: z.number().int().min(0),
  windows: z.array(z.string()),
  weekends: z.boolean(),
});

export const RunnerConfigSchema = z.object({
  serverUrl: z.string().url(),
  runnerId: z.string(),
  teamId: z.string(),
  name: z.string(),
  kind: z.enum(["shared", "personal"]),
  maxConcurrency: z.number().int().positive().default(1),
  schedule: ScheduleSchema,
  /** Stop taking jobs when free disk drops below this. */
  minFreeDiskMb: z.number().int().nonnegative().default(10_000),
  /** Admin URL of a local Postgres for per-job databases (`recipe.services.postgres`). */
  postgresUrl: z.string().optional(),
  /** Per-job resource limits applied with systemd-run (Linux). */
  limits: z
    .object({
      memMb: z.number().int().positive().optional(),
      cpuPercent: z.number().int().positive().optional(),
    })
    .default({}),
  /** Outbound HTTP proxy for git, coding-agent APIs, and the control plane when it is not localhost. */
  httpProxy: z.string().min(1).optional(),
});
export type RunnerConfig = z.infer<typeof RunnerConfigSchema>;

export const TOKEN_SECRET_KEY = "runner-token";

export function dataDir(): string {
  return process.env.FOUNDRY_HOME ?? join(homedir(), ".foundry");
}

export function configPath(dir = dataDir()): string {
  return join(dir, "config.json");
}

export function loadConfig(dir = dataDir()): RunnerConfig | null {
  const path = configPath(dir);
  if (!existsSync(path)) return null;
  return RunnerConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function saveConfig(config: RunnerConfig, dir = dataDir()): void {
  const path = configPath(dir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export function defaultSchedule(kind: "shared" | "personal", onLaptop: boolean): LocalSchedule {
  if (kind === "shared" && !onLaptop) return SHARED_DEFAULT_SCHEDULE;
  return LAPTOP_DEFAULT_SCHEDULE;
}

/** `foundry runner schedule` arguments, e.g. `--window 19:00-08:00 --ac-only --pause-when-active 10`. */
export function applyScheduleArgs(
  s: LocalSchedule,
  args: Record<string, string | boolean | string[]>,
): LocalSchedule {
  const next = { ...s, windows: [...s.windows] };
  if (args["ac-only"] !== undefined) next.acPowerOnly = args["ac-only"] !== "false";
  if (args["any-power"]) next.acPowerOnly = false;
  if (args["pause-when-active"] !== undefined)
    next.pauseWhenActiveMinutes = Number(args["pause-when-active"]) || 0;
  if (args.window !== undefined)
    next.windows = ([] as string[]).concat(args.window as string | string[]).filter((w) => w !== "any");
  if (args.weekends !== undefined) next.weekends = args.weekends !== "false";
  return ScheduleSchema.parse(next);
}
