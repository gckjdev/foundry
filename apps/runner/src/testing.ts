import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { socketBridge } from "@foundry/mcp-foundry";
import type { ClaimedJob, HeartbeatResponse, PendingInput } from "@foundry/shared";
import type { CheckpointInput, ControlPlane, OnboardingResult } from "./api";

export interface RecordedCall {
  method: string;
  jobId?: string;
  body?: unknown;
}

/** Records every call; tests assert on `calls` and script `pendingInputs` / `claimQueue`. */
export class RecordingControlPlane implements ControlPlane {
  readonly calls: RecordedCall[] = [];
  pendingInputs: PendingInput[] = [];
  claimQueue: ClaimedJob[] = [];
  revoked = new Set<string>();
  heartbeatResponse: HeartbeatResponse = {
    realtimeUrl: "",
    realtimeToken: "",
    draining: false,
    revokedJobIds: [],
    repos: [],
  };

  private rec(method: string, jobId?: string, body?: unknown) {
    this.calls.push({ method, jobId, body });
  }

  named(method: string) {
    return this.calls.filter((c) => c.method === method);
  }

  async heartbeat(req: unknown) {
    this.rec("heartbeat", undefined, req);
    return this.heartbeatResponse;
  }
  async claim() {
    this.rec("claim");
    return this.claimQueue.shift() ?? null;
  }
  async readiness(req: unknown) {
    this.rec("readiness", undefined, req);
  }
  async gitToken(repoId: string) {
    this.rec("gitToken", undefined, { repoId });
    return {
      token: "ghs_testtokentesttokentesttoken",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
  }
  async uploadArtifact(jobId: string, name: string, contentType: string, bytes: Uint8Array) {
    this.rec("uploadArtifact", jobId, { name, contentType, size: bytes.byteLength });
    return { artifactId: `art-${name}`, url: `https://foundry.test/a/${name}` };
  }
  async events(jobId: string, events: unknown[]) {
    this.rec("events", jobId, events);
  }
  async stage(jobId: string, req: unknown) {
    this.rec("stage", jobId, req);
    return { status: (req as { to: string }).to };
  }
  async ask(jobId: string, prompt: string, options: string[]) {
    this.rec("ask", jobId, { prompt, options });
    return { questionId: "q1" };
  }
  async evidence(jobId: string, req: unknown) {
    this.rec("evidence", jobId, req);
    return { id: `ev${this.calls.length}` };
  }
  async confidence(jobId: string, req: unknown) {
    this.rec("confidence", jobId, req);
  }
  async plan(jobId: string, plan: string) {
    this.rec("plan", jobId, { plan });
  }
  async checkpoint(jobId: string, req: CheckpointInput) {
    this.rec("checkpoint", jobId, req);
  }
  async openPr(jobId: string, req: unknown) {
    this.rec("openPr", jobId, req);
    return { prNumber: 7, url: "https://github.com/acme/app/pull/7" };
  }
  async onboarding(jobId: string, result: OnboardingResult) {
    this.rec("onboarding", jobId, result);
  }
  async inputs(jobId: string) {
    this.rec("inputs", jobId);
    return this.pendingInputs.splice(0);
  }
}

function sh(cwd: string, ...args: string[]) {
  execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
}

/**
 * A throwaway "GitHub": `<base>/<owner>/<repo>.git` bare repos, used via FOUNDRY_GIT_BASE.
 * Returns the base URL and a helper that seeds a repo with files on `main`.
 */
export function createGitFixture() {
  const root = mkdtempSync(join(tmpdir(), "foundry-git-"));
  const base = `file://${root}`;
  function seedRepo(fullName: string, files: Record<string, string>) {
    const bare = join(root, `${fullName}.git`);
    mkdirSync(bare, { recursive: true });
    sh(bare, "init", "--bare", "--quiet", "-b", "main");
    const work = mkdtempSync(join(tmpdir(), "foundry-seed-"));
    sh(work, "init", "--quiet", "-b", "main");
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(work, path, ".."), { recursive: true });
      writeFileSync(join(work, path), content);
    }
    sh(work, "add", "-A");
    sh(work, "commit", "--quiet", "-m", "init");
    sh(work, "push", "--quiet", bare, "main");
    return bare;
  }
  return { root, base, seedRepo };
}

export function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
}

export function testSocketPath(): string {
  return `/tmp/fdr-${randomBytes(4).toString("hex")}.sock`;
}

/** The agent side of the MCP bridge, for FakeHarness turns. */
export function agentTools(env: Record<string, string>) {
  const bridge = socketBridge(env.FOUNDRY_MCP_SOCKET!, env.FOUNDRY_JOB_ID!, env.FOUNDRY_MCP_TOKEN!);
  return (tool: Parameters<typeof bridge.call>[0], args: Record<string, unknown> = {}) =>
    bridge.call(tool, args);
}

export function claimedJob(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    kind: "ticket",
    repo: { id: "repo-1", fullName: "acme/app", defaultBranch: "main" },
    issueNumber: 12,
    title: "Add done marker",
    body: "### Goal\n\nWrite done.txt\n\n### Acceptance criteria\n\ndone.txt exists",
    author: "alice",
    harness: "claude-code",
    model: null,
    playbook: "default",
    branch: "foundry/11111111-add-done-marker",
    resumeStage: "triage",
    sessionId: null,
    resumeMode: "fresh",
    loopCount: 0,
    costUsd: 0,
    pendingInputs: [],
    mergeMode: "off",
    ...overrides,
  };
}

export const TEST_RECIPE = `checks:
  - name: marker
    run: test -f done.txt
ui_paths: ["**/*.tsx"]
`;
