import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HarnessAdapter } from "@foundry/harness-core";
import type { OsAdapter, SleepInhibitor } from "@foundry/os-adapters";
import {
  type HarnessInfo,
  HEARTBEAT_INTERVAL_MS,
  type LocalSchedule,
  scheduleAllows,
  VERSION,
} from "@foundry/shared";
import { httpProxyEnv } from "@foundry/shared/proxy";
import type { ControlPlane } from "./api";
import { collectGarbage } from "./gc";
import { JobRunner, type JobRunnerDeps } from "./job-runner";
import { PortLeases } from "./ports";
import { ReadinessReporter } from "./readiness";
import { LocalJobs } from "./state";
import { ToolServer } from "./tool-server";
import { Workspace } from "./workspace";

export interface DaemonOptions {
  api: ControlPlane;
  os: OsAdapter;
  harnesses: Partial<Record<string, HarnessAdapter>>;
  dataDir: string;
  maxConcurrency: number;
  schedule: LocalSchedule;
  minFreeDiskMb: number;
  mcpCommand: { command: string; args: string[] };
  postgresUrl?: string;
  limits?: { memMb?: number; cpuPercent?: number };
  socketPath?: string;
  log?: (message: string, data?: Record<string, unknown>) => void;
  heartbeatMs?: number;
  /** Override for tests. */
  createSocket?: (
    url: string,
    token: string,
  ) => { onmessage: ((e: { data: unknown }) => void) | null; close(): void; onclose: (() => void) | null };
}

/**
 * The runner daemon (spec 5.9): heartbeats, claims jobs while the local schedule allows,
 * listens for realtime pokes, keeps the machine awake while jobs run, and cleans up.
 */
export class Daemon {
  readonly running = new Map<string, { runner: JobRunner; done: Promise<unknown> }>();
  private readonly workspace: Workspace;
  private readonly ports: PortLeases;
  private readonly localJobs: LocalJobs;
  private readonly tools: ToolServer;
  private readonly readiness: ReadinessReporter;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private gcTimer: ReturnType<typeof setInterval> | null = null;
  private inhibitor: SleepInhibitor | null = null;
  private socket: { close(): void } | null = null;
  private socketUrl = "";
  private accepting: { ok: boolean; reason?: string } = { ok: true };
  private draining = false;
  private stopped = false;
  private claiming = false;
  private harnessInfo: HarnessInfo[] = [];
  private wrap: string[] | undefined;
  private readonly log: (message: string, data?: Record<string, unknown>) => void;

  constructor(private readonly opts: DaemonOptions) {
    this.workspace = new Workspace(opts.dataDir);
    this.ports = new PortLeases(join(opts.dataDir, "ports.json"));
    this.localJobs = new LocalJobs(join(opts.dataDir, "jobs"));
    this.tools = new ToolServer(opts.socketPath ?? join(opts.dataDir, "foundry.sock"));
    this.log = opts.log ?? ((m, d) => console.log(`[foundry] ${m}`, d ?? ""));
    this.readiness = new ReadinessReporter(opts.api, this.workspace, opts.os.os, {
      postgresUrl: opts.postgresUrl,
      log: (m) => this.log(m),
    });
  }

  async start(): Promise<void> {
    await this.tools.start();
    this.harnessInfo = await this.detectHarnesses();
    if (this.opts.limits?.memMb || this.opts.limits?.cpuPercent)
      this.wrap = await this.opts.os.wrapWithLimits([], this.opts.limits);
    await collectGarbage({
      workspace: this.workspace,
      localJobs: this.localJobs,
      ports: this.ports,
      running: new Set(),
    });
    await this.tick();
    this.heartbeatTimer = setInterval(() => void this.tick(), this.opts.heartbeatMs ?? HEARTBEAT_INTERVAL_MS);
    this.gcTimer = setInterval(() => void this.gc(), 3600_000);
  }

  /** Give running jobs back (they resume from checkpoints) and stop. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.gcTimer) clearInterval(this.gcTimer);
    this.socket?.close();
    await Promise.all(
      [...this.running.values()].map(async (r) => {
        await r.runner.pause();
        await r.done;
      }),
    );
    this.inhibitor?.release();
    await this.tools.close();
  }

  private async detectHarnesses(): Promise<HarnessInfo[]> {
    const out: HarnessInfo[] = [];
    for (const [id, h] of Object.entries(this.opts.harnesses)) {
      if (!h) continue;
      const d = await h.detect().catch(() => ({ installed: false, authOk: false }) as const);
      out.push({
        id,
        installed: d.installed,
        authOk: d.authOk,
        ...("version" in d && d.version ? { version: d.version } : {}),
      });
    }
    return out;
  }

  private async gc(): Promise<void> {
    try {
      const removed = await collectGarbage({
        workspace: this.workspace,
        localJobs: this.localJobs,
        ports: this.ports,
        running: new Set(this.running.keys()),
      });
      if (removed.length) this.log(`gc removed ${removed.length} worktree(s)`);
    } catch (err) {
      this.log(`gc failed: ${String(err)}`);
    }
  }

  private async evaluateAccepting(
    diskFreeMb: number,
    onAcPower: boolean | null,
  ): Promise<{ ok: boolean; reason?: string }> {
    if (this.draining) return { ok: false, reason: "draining" };
    if (diskFreeMb < this.opts.minFreeDiskMb)
      return { ok: false, reason: `low disk (${diskFreeMb} MB free)` };
    const idleSeconds =
      this.opts.schedule.pauseWhenActiveMinutes > 0 ? await this.opts.os.idleSeconds() : null;
    return scheduleAllows(this.opts.schedule, { onAcPower, idleSeconds }, new Date());
  }

  /** One heartbeat: report, apply revocations, sync readiness, then try to claim. */
  async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      const [info, diskFreeMb, onAcPower] = await Promise.all([
        this.opts.os.info(),
        this.opts.os.diskFreeMb(this.opts.dataDir),
        this.opts.os.onAcPower(),
      ]);
      const wasAccepting = this.accepting.ok;
      this.accepting = await this.evaluateAccepting(diskFreeMb, onAcPower);
      const res = await this.opts.api.heartbeat({
        cpu: info.cpu,
        memMb: info.memMb,
        diskFreeMb,
        onAcPower,
        accepting: this.accepting.ok,
        notAcceptingReason: this.accepting.reason ?? null,
        runningJobIds: [...this.running.keys()],
        harnesses: this.harnessInfo,
        maxConcurrency: this.opts.maxConcurrency,
        version: VERSION,
      });
      this.draining = res.draining;
      for (const id of res.revokedJobIds) {
        const r = this.running.get(id);
        if (r) {
          this.log(`job ${id} was revoked by the control plane`);
          void r.runner.revoke();
        }
      }
      // Outside the schedule (lid unplugged, owner active, window closed): hand jobs back.
      if (wasAccepting && !this.accepting.ok && this.opts.schedule.acPowerOnly && onAcPower === false) {
        for (const r of this.running.values()) void r.runner.pause();
      }
      this.connectRealtime(res.realtimeUrl, res.realtimeToken);
      await this.readiness.sync(res.repos);
      await this.claimLoop();
      this.writeStatus();
    } catch (err) {
      this.log(`heartbeat failed: ${String(err)}`);
    }
  }

  private connectRealtime(url: string, token: string): void {
    if (!url || url === this.socketUrl) return;
    this.socket?.close();
    this.socketUrl = url;
    try {
      const ws = this.opts.createSocket
        ? this.opts.createSocket(url, token)
        : (new WebSocket(
            `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`,
          ) as unknown as {
            onmessage: ((e: { data: unknown }) => void) | null;
            onclose: (() => void) | null;
            close(): void;
          });
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(String(e.data)) as { table?: string; op?: string };
          if (msg.table === "jobs") void this.claimLoop();
        } catch {}
      };
      ws.onclose = () => {
        if (this.socket === ws) {
          this.socket = null;
          this.socketUrl = "";
        }
      };
      this.socket = ws;
    } catch (err) {
      this.log(`realtime connect failed: ${String(err)}`);
      this.socketUrl = "";
    }
  }

  /** Claim until full or the queue has nothing for us. */
  async claimLoop(): Promise<void> {
    if (this.claiming || this.stopped) return;
    this.claiming = true;
    try {
      while (!this.stopped && this.accepting.ok && this.running.size < this.opts.maxConcurrency) {
        const job = await this.opts.api.claim();
        if (!job) break;
        this.log(`claimed job ${job.id} (${job.resumeMode}) at ${job.resumeStage}: ${job.title}`);
        const runner = new JobRunner(this.jobDeps(), job);
        const done = runner
          .run()
          .catch((err) => this.log(`job ${job.id} crashed: ${String(err)}`))
          .finally(() => {
            this.running.delete(job.id);
            this.updateInhibitor();
            void this.claimLoop();
          });
        this.running.set(job.id, { runner, done });
        this.updateInhibitor();
      }
    } catch (err) {
      this.log(`claim failed: ${String(err)}`);
    } finally {
      this.claiming = false;
    }
  }

  private jobDeps(): JobRunnerDeps {
    return {
      api: this.opts.api,
      harnesses: this.opts.harnesses,
      workspace: this.workspace,
      ports: this.ports,
      tools: this.tools,
      localJobs: this.localJobs,
      mcpCommand: this.opts.mcpCommand,
      log: this.log,
      postgresUrl: this.opts.postgresUrl,
      wrap: this.wrap,
      baseEnv: httpProxyEnv(),
    };
  }

  private updateInhibitor(): void {
    if (this.running.size > 0 && !this.inhibitor) {
      void this.opts.os
        .inhibitSleep("Foundry is running a job")
        .then((i) => {
          if (this.running.size > 0 && !this.inhibitor) this.inhibitor = i;
          else i.release();
        })
        .catch(() => {});
    } else if (this.running.size === 0 && this.inhibitor) {
      this.inhibitor.release();
      this.inhibitor = null;
    }
  }

  private writeStatus(): void {
    try {
      writeFileSync(
        join(this.opts.dataDir, "status.json"),
        JSON.stringify({ ...this.status(), pid: process.pid, at: new Date().toISOString() }, null, 2),
      );
    } catch {}
  }

  status() {
    return {
      accepting: this.accepting,
      draining: this.draining,
      running: [...this.running.values()].map((r) => ({
        id: r.runner.jobId,
        stage: r.runner.currentStage,
        title: r.runner.job.title,
      })),
    };
  }
}
