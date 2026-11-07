import { AsyncQueue, deferred } from "./queue";
import type {
  HarnessAdapter,
  HarnessDetection,
  HarnessEvent,
  HarnessId,
  HarnessSession,
  ResumeOpts,
  SessionResult,
  StartOpts,
} from "./types";

/**
 * One scripted turn. `act` runs as the "agent": it can call the job's Foundry tools (stage, ask,
 * evidence, confidence) through whatever the test wired up, and edit files in `cwd`.
 */
export interface FakeTurn {
  events?: HarnessEvent[];
  act?: (ctx: {
    cwd: string;
    prompt: string;
    env: Record<string, string>;
    sessionId: string;
  }) => Promise<void>;
  result?: SessionResult["status"];
  costUsd?: number;
}

export interface FakeCall {
  kind: "start" | "resume";
  sessionId: string;
  prompt: string;
  opts: StartOpts | ResumeOpts;
}

/**
 * Replays scripted turns instead of running a model. Each `start` or `resume` consumes the next
 * turn, so a test describes the whole job as a list of agent turns.
 */
export class FakeHarness implements HarnessAdapter {
  readonly calls: FakeCall[] = [];
  private turns: FakeTurn[];
  private nextSession = 1;
  private readonly sessions = new WeakMap<HarnessSession, { stopped: boolean; stop: () => void }>();

  constructor(
    readonly id: HarnessId = "claude-code",
    turns: FakeTurn[] = [],
    private readonly detection: HarnessDetection = { installed: true, version: "fake-1.0", authOk: true },
  ) {
    this.turns = [...turns];
  }

  enqueue(...turns: FakeTurn[]): void {
    this.turns.push(...turns);
  }

  get remainingTurns(): number {
    return this.turns.length;
  }

  async detect() {
    return this.detection;
  }

  async start(opts: StartOpts) {
    const sessionId = `fake-session-${this.nextSession++}`;
    this.calls.push({ kind: "start", sessionId, prompt: opts.prompt, opts });
    return this.run(sessionId, opts.prompt, opts);
  }

  async resume(sessionId: string, message: string, opts: ResumeOpts) {
    this.calls.push({ kind: "resume", sessionId, prompt: message, opts });
    return this.run(sessionId, message, opts);
  }

  async stop(session: HarnessSession) {
    this.sessions.get(session)?.stop();
    await session.done;
  }

  private run(sessionId: string, prompt: string, opts: ResumeOpts): HarnessSession {
    const turn = this.turns.shift() ?? {
      events: [{ kind: "message", role: "agent", text: "(no scripted turn)" }],
    };
    const queue = new AsyncQueue<HarnessEvent>();
    const done = deferred<SessionResult>();
    const state = { stopped: false, stop: () => {} };
    const stopped = new Promise<void>((resolve) => {
      state.stop = () => {
        state.stopped = true;
        resolve();
      };
    });
    const session: HarnessSession = { id: Promise.resolve(sessionId), events: queue, done: done.promise };
    this.sessions.set(session, state);
    void (async () => {
      try {
        for (const e of turn.events ?? []) queue.push(e);
        if (turn.act)
          await Promise.race([turn.act({ cwd: opts.cwd, prompt, env: opts.env, sessionId }), stopped]);
        if (turn.costUsd)
          queue.push({ kind: "usage", tokensIn: 1000, tokensOut: 200, costUsd: turn.costUsd });
        done.resolve({ status: state.stopped ? "stopped" : (turn.result ?? "ok"), costUsd: turn.costUsd });
      } catch (err) {
        queue.push({ kind: "error", message: String(err) });
        done.resolve({ status: state.stopped ? "stopped" : "error", error: String(err) });
      } finally {
        queue.close();
      }
    })();
    return session;
  }
}
