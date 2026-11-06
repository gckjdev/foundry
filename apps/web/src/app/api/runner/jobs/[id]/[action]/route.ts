import {
  completeOnboarding,
  ConflictError,
  openPullRequest,
  ownedJob,
  runnerAsk,
  runnerCheckpoint,
  runnerConfidence,
  runnerEvents,
  runnerEvidence,
  runnerInputs,
  runnerPlan,
  runnerStage,
} from "@foundry/control";
import {
  AskRequestSchema,
  CheckpointRequestSchema,
  ConfidenceRequestSchema,
  EventsRequestSchema,
  EvidenceRequestSchema,
  OnboardingResultSchema,
  OpenPrRequestSchema,
  PlanRequestSchema,
  StageRequestSchema,
} from "@foundry/shared";
import { z } from "zod";
import { runnerRoute } from "@/server/http";

/** `POST /api/runner/jobs/:id/:action` — everything a runner reports about a job it holds. */
const actions = {
  events: runnerRoute(EventsRequestSchema, ({ ctx, runner, body, params }) =>
    runnerEvents(ctx, runner, params.id!, body.events),
  ),
  stage: runnerRoute(StageRequestSchema, async ({ ctx, runner, body, params }) => {
    const job = await runnerStage(ctx, runner, params.id!, body);
    if (!job) throw new ConflictError("job moved by someone else");
    return { status: job.status };
  }),
  ask: runnerRoute(AskRequestSchema, async ({ ctx, runner, body, params }) => {
    const q = await runnerAsk(ctx, runner, params.id!, body.prompt, body.options);
    return { questionId: q.id };
  }),
  evidence: runnerRoute(EvidenceRequestSchema, async ({ ctx, runner, body, params }) => {
    const row = await runnerEvidence(ctx, runner, params.id!, body);
    return { id: row.id };
  }),
  confidence: runnerRoute(ConfidenceRequestSchema, ({ ctx, runner, body, params }) =>
    runnerConfidence(ctx, runner, params.id!, body),
  ),
  plan: runnerRoute(PlanRequestSchema, ({ ctx, runner, body, params }) => runnerPlan(ctx, runner, params.id!, body.plan)),
  checkpoint: runnerRoute(CheckpointRequestSchema, ({ ctx, runner, body, params }) =>
    runnerCheckpoint(ctx, runner, params.id!, body),
  ),
  pr: runnerRoute(OpenPrRequestSchema, async ({ ctx, runner, body, params }) => {
    const job = await ownedJob(ctx, runner, params.id!);
    return openPullRequest(ctx, job, body);
  }),
  onboarding: runnerRoute(OnboardingResultSchema, async ({ ctx, runner, body, params }) => {
    const job = await ownedJob(ctx, runner, params.id!);
    return { pr: await completeOnboarding(ctx, job, body) };
  }),
  inputs: runnerRoute(z.object({ take: z.boolean().default(true) }), async ({ ctx, runner, body, params }) => ({
    inputs: await runnerInputs(ctx, runner, params.id!, body.take),
  })),
} as const;

export async function POST(req: Request, route: { params: Promise<{ id: string; action: string }> }) {
  const { action } = await route.params;
  const handler = actions[action as keyof typeof actions];
  if (!handler) return Response.json({ error: `unknown action ${action}` }, { status: 404 });
  return handler(req, route as { params: Promise<Record<string, string>> });
}
