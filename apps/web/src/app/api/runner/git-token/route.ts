import { runnerGitToken } from "@foundry/control";
import { z } from "zod";
import { runnerRoute } from "@/server/http";

export const POST = runnerRoute(z.object({ repoId: z.string() }), ({ ctx, runner, body }) =>
  runnerGitToken(ctx, runner, body.repoId),
);
