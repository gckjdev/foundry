import {
  type ClaimedJob,
  ClaimResponseSchema,
  type ConfidenceRequest,
  type EvidenceRequest,
  type FoundryEvent,
  GitTokenResponseSchema,
  type HeartbeatRequest,
  type HeartbeatResponse,
  HeartbeatResponseSchema,
  type JoinRequest,
  JoinResponseSchema,
  OpenPrResponseSchema,
  type PendingInput,
  PendingInputSchema,
  type PrReviewRequest,
  PrReviewResponseSchema,
  type RunnerStage,
  type StageRequest,
} from "@foundry/shared";
import { z } from "zod";

export interface CheckpointInput {
  stage: RunnerStage | null;
  sessionId: string | null;
  briefRef: string;
  headSha: string | null;
}

export interface OnboardingResult {
  ok: boolean;
  reason: string | null;
  headSha: string | null;
  summary: string;
}

/**
 * Everything the runner asks of the control plane. The daemon uses the HTTP client; the
 * end-to-end suite plugs in an implementation that calls `@foundry/control` directly.
 */
export interface ControlPlane {
  heartbeat(req: HeartbeatRequest): Promise<HeartbeatResponse>;
  claim(): Promise<ClaimedJob | null>;
  readiness(req: {
    repoId: string;
    recipeSha: string | null;
    ready: boolean;
    reason: string | null;
  }): Promise<void>;
  gitToken(repoId: string): Promise<{ token: string; expiresAt: string }>;
  uploadArtifact(
    jobId: string,
    name: string,
    contentType: string,
    bytes: Uint8Array,
  ): Promise<{ artifactId: string; url: string }>;
  events(jobId: string, events: FoundryEvent[]): Promise<void>;
  stage(jobId: string, req: StageRequest): Promise<{ status: string }>;
  ask(jobId: string, prompt: string, options: string[]): Promise<{ questionId: string }>;
  evidence(jobId: string, req: EvidenceRequest): Promise<{ id: string }>;
  confidence(jobId: string, req: ConfidenceRequest): Promise<void>;
  plan(jobId: string, plan: string): Promise<void>;
  checkpoint(jobId: string, req: CheckpointInput): Promise<void>;
  openPr(
    jobId: string,
    req: { title: string; summary: string; headSha: string; uiChanged: boolean; changedLines: number },
  ): Promise<{ prNumber: number; url: string }>;
  onboarding(jobId: string, result: OnboardingResult): Promise<void>;
  inputs(jobId: string): Promise<PendingInput[]>;
  /** Report the automatic post-PR review; the control plane publishes and acts on it. */
  submitPrReview(jobId: string, report: PrReviewRequest): Promise<{ status: string }>;
}

/** The control plane rejected the call because the job is no longer this runner's (HTTP 409). */
export class JobRevokedError extends Error {}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The control plane's error text, without the request URL prefix. */
    readonly detail = message,
  ) {
    super(message);
  }
}

async function request<T>(
  url: string,
  init: {
    method?: string;
    token?: string;
    body?: unknown;
    raw?: Uint8Array;
    headers?: Record<string, string>;
  },
  schema?: z.ZodType<T>,
): Promise<T> {
  const headers: Record<string, string> = { ...init.headers };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  let body: RequestInit["body"];
  if (init.raw) body = init.raw as unknown as RequestInit["body"];
  else if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await fetch(url, {
    method: init.method ?? "POST",
    headers,
    body,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const message = (data as { error?: string }).error ?? `${res.status} ${res.statusText}`;
    if (res.status === 409) throw new JobRevokedError(message);
    throw new ApiError(res.status, `${url}: ${message}`, message);
  }
  return schema ? schema.parse(data) : (data as T);
}

export async function joinControlPlane(serverUrl: string, req: JoinRequest) {
  return request(`${serverUrl.replace(/\/$/, "")}/api/runner/join`, { body: req }, JoinResponseSchema);
}

export class HttpControlPlane implements ControlPlane {
  private readonly base: string;

  constructor(
    serverUrl: string,
    private readonly token: string,
  ) {
    this.base = `${serverUrl.replace(/\/$/, "")}/api/runner`;
  }

  private post<T>(path: string, body: unknown, schema?: z.ZodType<T>): Promise<T> {
    return request(`${this.base}${path}`, { token: this.token, body }, schema);
  }

  heartbeat(req: HeartbeatRequest) {
    return this.post("/heartbeat", req, HeartbeatResponseSchema);
  }

  async claim() {
    return (await this.post("/claim", {}, ClaimResponseSchema)).job;
  }

  async readiness(req: { repoId: string; recipeSha: string | null; ready: boolean; reason: string | null }) {
    await this.post("/readiness", req);
  }

  gitToken(repoId: string) {
    return this.post("/git-token", { repoId }, GitTokenResponseSchema);
  }

  uploadArtifact(jobId: string, name: string, contentType: string, bytes: Uint8Array) {
    return request(
      `${this.base}/artifacts`,
      {
        token: this.token,
        raw: bytes,
        headers: { "content-type": contentType, "x-foundry-job": jobId, "x-foundry-name": name },
      },
      z.object({ artifactId: z.string(), url: z.string() }),
    );
  }

  private job<T>(jobId: string, action: string, body: unknown, schema?: z.ZodType<T>) {
    return this.post(`/jobs/${encodeURIComponent(jobId)}/${action}`, body, schema);
  }

  async events(jobId: string, events: FoundryEvent[]) {
    for (let i = 0; i < events.length; i += 200)
      await this.job(jobId, "events", { events: events.slice(i, i + 200) });
  }

  stage(jobId: string, req: StageRequest) {
    return this.job(jobId, "stage", req, z.object({ status: z.string() }));
  }

  ask(jobId: string, prompt: string, options: string[]) {
    return this.job(jobId, "ask", { prompt, options }, z.object({ questionId: z.string() }));
  }

  evidence(jobId: string, req: EvidenceRequest) {
    return this.job(jobId, "evidence", req, z.object({ id: z.string() }));
  }

  async confidence(jobId: string, req: ConfidenceRequest) {
    await this.job(jobId, "confidence", req);
  }

  async plan(jobId: string, plan: string) {
    await this.job(jobId, "plan", { plan });
  }

  async checkpoint(jobId: string, req: CheckpointInput) {
    await this.job(jobId, "checkpoint", req);
  }

  openPr(
    jobId: string,
    req: { title: string; summary: string; headSha: string; uiChanged: boolean; changedLines: number },
  ) {
    return this.job(jobId, "pr", req, OpenPrResponseSchema);
  }

  async onboarding(jobId: string, result: OnboardingResult) {
    await this.job(jobId, "onboarding", result);
  }

  async inputs(jobId: string) {
    const res = await this.job(
      jobId,
      "inputs",
      { take: true },
      z.object({ inputs: z.array(PendingInputSchema) }),
    );
    return res.inputs;
  }

  submitPrReview(jobId: string, report: PrReviewRequest) {
    return this.job(jobId, "pr-review", report, PrReviewResponseSchema);
  }
}
