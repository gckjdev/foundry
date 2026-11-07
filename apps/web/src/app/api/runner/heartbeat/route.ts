import { heartbeat } from "@foundry/control";
import { HeartbeatRequestSchema } from "@foundry/shared";
import { runnerRoute } from "@/server/http";

export const POST = runnerRoute(HeartbeatRequestSchema, ({ ctx, runner, body }) =>
  heartbeat(ctx, runner, body),
);
