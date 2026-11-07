#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { bridgeFromEnv, runStdioServer } from "@foundry/mcp-foundry";
import { currentOsAdapter } from "@foundry/os-adapters";
import { parseRecipeYaml, VERSION } from "@foundry/shared";
import { loadGitHubEnvFromFile } from "@foundry/shared/github-host";
import { applyHttpProxyEnv, loadHttpProxyFromEnvFile } from "@foundry/shared/proxy";
import { HttpControlPlane, joinControlPlane } from "./api";
import {
  applyRunnerHome,
  applyScheduleArgs,
  dataDir,
  defaultSchedule,
  loadConfig,
  notJoinedMessage,
  type RunnerConfig,
  saveConfig,
  TOKEN_SECRET_KEY,
} from "./config";
import { Daemon } from "./daemon";
import { defaultHarnesses } from "./harnesses";
import { checkRecipe } from "./readiness";

const HELP = `foundry ${VERSION}: the Foundry runner

Usage:
  foundry runner join <fdj_token> --server <url> [--shared] [--name NAME] [--home DIR] [--concurrency N] [--http-proxy URL]
  foundry runner start [--home DIR]     Run the daemon in the foreground
  foundry runner install-service [--home DIR] [--system] [--user NAME]
                                        Install a launchd/systemd service for this home
  foundry runner uninstall-service [--home DIR] [--system]
                                        Remove that service. The other homes stay loaded
  foundry runner status [--home DIR]    Show the daemon's last reported state
  foundry runner schedule [--ac-only[=false]] [--pause-when-active MIN] [--window HH:MM-HH:MM ...] [--weekends[=false]]
  foundry check [DIR]                   Check that this machine can run the repo's .foundry/recipe.yaml
  foundry doctor [--live]               Check harnesses, git, disk and power; --live runs a tiny real session
  foundry open <job-id>                 Print the worktree path of a job on this runner
  foundry mcp                           (internal) the per-job foundry MCP server over stdio
  foundry --version
`;

/** How harnesses re-invoke this binary as the MCP server. */
export function selfCommand(sub: string[]): { command: string; args: string[] } {
  const script = process.argv[1];
  if (script && /\.(ts|js|mjs)$/.test(script)) return { command: process.execPath, args: [script, ...sub] };
  return { command: process.execPath, args: sub };
}

function fail(message: string): never {
  console.error(`foundry: ${message}`);
  process.exit(1);
}

function loadNearbyEnv(): void {
  const candidates = [
    join(process.cwd(), ".env"),
    join(fileURLToPath(new URL("../../../.env", import.meta.url))),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const contents = readFileSync(p, "utf8");
    loadHttpProxyFromEnvFile(contents);
    loadGitHubEnvFromFile(contents);
    break;
  }
}

async function requireConfig(): Promise<{ config: RunnerConfig; token: string }> {
  const config = loadConfig();
  if (!config) fail(notJoinedMessage());
  const token =
    process.env.FOUNDRY_RUNNER_TOKEN ?? (await (await currentOsAdapter().secrets()).get(TOKEN_SECRET_KEY));
  if (!token) fail("runner token missing from the secret store; join again");
  return { config, token };
}

async function join_(
  positionals: string[],
  values: Record<string, string | boolean | undefined>,
  configuredProxy?: string,
) {
  const serverUrl = (values.server as string | undefined) ?? positionals.find((p) => /^https?:\/\//.test(p));
  const joinToken = (values.token as string | undefined) ?? positionals.find((p) => p.startsWith("fdj_"));
  if (!serverUrl || !joinToken) fail("usage: foundry runner join <fdj_token> --server <url> [--shared]");
  const os = currentOsAdapter();
  const info = await os.info();
  const kind = values.shared ? "shared" : ((values.kind as "shared" | "personal" | undefined) ?? "personal");
  const name = (values.name as string | undefined) ?? `${userInfo().username}-${hostname().split(".")[0]}`;
  const maxConcurrency = Number(values.concurrency ?? 1) || 1;
  const res = await joinControlPlane(serverUrl, {
    joinToken,
    name,
    kind,
    os: info.os,
    arch: info.arch,
    osVersion: info.osVersion,
    cpu: info.cpu,
    memMb: info.memMb,
    maxConcurrency,
  });
  await (await os.secrets()).set(TOKEN_SECRET_KEY, res.runnerToken);
  const onLaptop = (await os.onAcPower()) !== null;
  const existing = loadConfig();
  saveConfig({
    serverUrl,
    runnerId: res.runnerId,
    teamId: res.teamId,
    name,
    kind,
    maxConcurrency,
    schedule: existing?.schedule ?? defaultSchedule(kind, onLaptop),
    minFreeDiskMb: existing?.minFreeDiskMb ?? 10_000,
    postgresUrl: existing?.postgresUrl ?? process.env.FOUNDRY_POSTGRES_URL,
    limits: existing?.limits ?? {},
    httpProxy: configuredProxy || existing?.httpProxy,
  });
  console.log(
    `Joined as "${name}" (${kind}). Start it with \`foundry runner start\` or \`foundry runner install-service\`.`,
  );
}

async function start() {
  const { config, token } = await requireConfig();
  const daemon = new Daemon({
    api: new HttpControlPlane(config.serverUrl, token),
    os: currentOsAdapter(),
    harnesses: defaultHarnesses(),
    dataDir: dataDir(),
    maxConcurrency: config.maxConcurrency,
    schedule: config.schedule,
    minFreeDiskMb: config.minFreeDiskMb,
    mcpCommand: selfCommand(["mcp"]),
    postgresUrl: config.postgresUrl,
    limits: config.limits,
  });
  await daemon.start();
  console.log(`foundry runner "${config.name}" connected to ${config.serverUrl}`);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log("stopping: handing running jobs back…");
    await daemon.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

function serviceSpec(system: boolean, user: string) {
  const config = loadConfig();
  if (!config) fail(notJoinedMessage());
  const dir = dataDir();
  return {
    spec: {
      binaryPath: process.execPath,
      args: selfCommand(["runner", "start", "--home", dir]).args,
      mode: system ? ("system" as const) : ("user" as const),
      user,
      workDir: dir,
      logDir: join(dir, "logs"),
      name: config.name,
      environment: { FOUNDRY_HOME: dir },
    },
    dir,
  };
}

async function installService(values: Record<string, string | boolean | undefined>) {
  const os = currentOsAdapter();
  const system = !!values.system;
  const user = (values.user as string | undefined) ?? userInfo().username;
  const { spec, dir } = serviceSpec(system, user);
  const install = os.service(spec);
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  if (system && process.getuid?.() !== 0) {
    console.log(
      `Run with sudo to install a system service, or write this file to ${install.path}:\n\n${install.contents}`,
    );
    return;
  }
  mkdirSync(dirname(install.path), { recursive: true });
  mkdirSync(join(dir, "logs"), { recursive: true });
  writeFileSync(install.path, install.contents);
  for (const cmd of install.activate) {
    const r = spawnSync(cmd[0]!, cmd.slice(1), { stdio: "inherit" });
    if (r.status !== 0) fail(`\`${cmd.join(" ")}\` failed`);
  }
  console.log(`Installed ${install.path}. The runner starts on ${system ? "boot" : "login"}.`);
}

async function uninstallService(values: Record<string, string | boolean | undefined>) {
  const os = currentOsAdapter();
  const system = !!values.system;
  const user = (values.user as string | undefined) ?? userInfo().username;
  const { spec } = serviceSpec(system, user);
  const install = os.service(spec);
  if (system && process.getuid?.() !== 0) {
    const commands = install.deactivate.map((cmd) => cmd.join(" ")).join("\n");
    console.log(`Run with sudo:\n\n${commands}\nrm -f ${install.path}`);
    return;
  }
  for (const cmd of install.deactivate) {
    const r = spawnSync(cmd[0]!, cmd.slice(1), { stdio: "inherit" });
    if (r.status !== 0) console.error(`foundry: \`${cmd.join(" ")}\` failed (continuing)`);
  }
  const { rmSync } = await import("node:fs");
  rmSync(install.path, { force: true });
  console.log(`Removed ${install.path}.`);
}

function status() {
  const file = join(dataDir(), "status.json");
  const config = loadConfig();
  if (!config) fail(notJoinedMessage());
  console.log(`runner ${config.name} (${config.kind}) → ${config.serverUrl}`);
  console.log(`home: ${dataDir()}`);
  console.log(`schedule: ${JSON.stringify(config.schedule)}`);
  if (!existsSync(file)) return console.log("daemon: not running (no status yet)");
  const s = JSON.parse(readFileSync(file, "utf8")) as {
    at: string;
    pid: number;
    accepting: { ok: boolean; reason?: string };
    running: { id: string; stage: string; title: string }[];
  };
  const age = Math.round((Date.now() - Date.parse(s.at)) / 1000);
  console.log(
    `daemon: pid ${s.pid}, last heartbeat ${age}s ago${age > 60 ? " (stale: is it running?)" : ""}`,
  );
  console.log(`accepting jobs: ${s.accepting.ok ? "yes" : `no (${s.accepting.reason})`}`);
  for (const j of s.running) console.log(`  ${j.id.slice(0, 8)}  ${j.stage.padEnd(13)} ${j.title}`);
}

function schedule(values: Record<string, string | boolean | string[] | undefined>) {
  const config = loadConfig();
  if (!config) fail(notJoinedMessage());
  const defined = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) as Record<
    string,
    string | boolean | string[]
  >;
  config.schedule = applyScheduleArgs(config.schedule, defined);
  saveConfig(config);
  console.log(`schedule: ${JSON.stringify(config.schedule)} (restart the runner to apply)`);
}

async function check(dir: string) {
  const path = join(dir, ".foundry/recipe.yaml");
  if (!existsSync(path)) fail(`${path} not found`);
  const recipe = parseRecipeYaml(readFileSync(path, "utf8"));
  const os = currentOsAdapter();
  const r = await checkRecipe(recipe, os.os, {
    postgresUrl: loadConfig()?.postgresUrl ?? process.env.FOUNDRY_POSTGRES_URL,
  });
  console.log(r.ready ? "✓ this runner can run the recipe" : `✗ ${r.reason}`);
  if (!r.ready) process.exit(1);
}

async function doctor(live: boolean) {
  const os = currentOsAdapter();
  const info = await os.info();
  const rows: [string, boolean, string][] = [];
  rows.push(["os", true, `${info.os} ${info.osVersion} ${info.arch}, ${info.cpu} cpu, ${info.memMb} MB`]);
  const gitV = spawnSync("git", ["--version"], { encoding: "utf8" });
  rows.push(["git", gitV.status === 0, gitV.stdout.trim() || "not found"]);
  for (const [id, h] of Object.entries(defaultHarnesses())) {
    const d = await h!.detect();
    rows.push([
      id,
      d.installed && d.authOk,
      d.installed ? `${d.version ?? "?"}${d.authOk ? "" : " (not signed in)"}` : "not installed",
    ]);
  }
  const disk = await os.diskFreeMb(dataDir()).catch(() => -1);
  rows.push(["disk", disk > (loadConfig()?.minFreeDiskMb ?? 10_000), `${disk} MB free in ${dataDir()}`]);
  const power = await os.onAcPower();
  rows.push(["power", power !== false, power === null ? "no battery" : power ? "on AC" : "on battery"]);
  const config = loadConfig();
  rows.push([
    "joined",
    !!config,
    config ? `${config.name} → ${config.serverUrl}` : "run `foundry runner join`",
  ]);
  for (const [name, ok, detail] of rows) console.log(`${ok ? "✓" : "✗"} ${name.padEnd(12)} ${detail}`);
  if (!live) return;
  const { smokeTest } = await import("./smoke");
  for (const [id, h] of Object.entries(defaultHarnesses())) {
    console.log(`… live session with ${id}`);
    const r = await smokeTest(h!, selfCommand(["mcp"]));
    console.log(`${r.ok ? "✓" : "✗"} ${`${id} live`.padEnd(12)} ${r.detail} ($${r.costUsd.toFixed(4)})`);
    if (!r.ok) process.exitCode = 1;
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      token: { type: "string" },
      server: { type: "string" },
      shared: { type: "boolean" },
      name: { type: "string" },
      home: { type: "string" },
      kind: { type: "string" },
      concurrency: { type: "string" },
      system: { type: "boolean" },
      user: { type: "string" },
      window: { type: "string", multiple: true },
      "pause-when-active": { type: "string" },
      "ac-only": { type: "string" },
      "any-power": { type: "boolean" },
      weekends: { type: "string" },
      "http-proxy": { type: "string" },
      version: { type: "boolean", short: "v" },
      live: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [cmd, sub, ...rest] = positionals;
  if (typeof values.home === "string") applyRunnerHome(values.home);
  loadNearbyEnv();
  if (typeof values["http-proxy"] === "string" && values["http-proxy"].trim()) {
    process.env.FOUNDRY_HTTP_PROXY = values["http-proxy"].trim();
  }
  const configuredProxy = process.env.FOUNDRY_HTTP_PROXY?.trim() || loadConfig()?.httpProxy;
  applyHttpProxyEnv({ fallback: configuredProxy });
  if (values.version) return console.log(VERSION);
  if (values.help || !cmd) return console.log(HELP);
  const v = values as Record<string, string | boolean | undefined>;
  if (cmd === "mcp") return runStdioServer(bridgeFromEnv(), VERSION);
  if (cmd === "check") return check(sub ?? process.cwd());
  if (cmd === "doctor") return doctor(!!values.live);
  if (cmd === "open") {
    const path = join(dataDir(), "worktrees", sub ?? "");
    if (!sub || !existsSync(path)) fail("no such job worktree on this runner");
    return console.log(path);
  }
  if (cmd === "runner") {
    switch (sub) {
      case "join":
        return join_(rest, v, configuredProxy);
      case "start":
        return start();
      case "install-service":
        return installService(v);
      case "uninstall-service":
        return uninstallService(v);
      case "status":
        return status();
      case "schedule":
        return schedule(values as Record<string, string | boolean | string[] | undefined>);
    }
  }
  console.log(HELP);
  process.exit(1);
}

if (import.meta.main) {
  main().catch((err) => fail(String(err?.stack ?? err)));
}
