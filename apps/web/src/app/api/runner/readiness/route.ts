import { reportReadiness } from "@foundry/control";
import { ReadinessRequestSchema } from "@foundry/shared";
import { runnerRoute } from "@/server/http";

export const POST = runnerRoute(ReadinessRequestSchema, ({ ctx, runner, body }) => reportReadiness(ctx, runner, body));
