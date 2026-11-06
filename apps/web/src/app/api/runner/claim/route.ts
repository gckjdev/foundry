import { claimJob } from "@foundry/control";
import { runnerRoute } from "@/server/http";

export const POST = runnerRoute(null, async ({ ctx, runner }) => ({ job: await claimJob(ctx, runner) }));
