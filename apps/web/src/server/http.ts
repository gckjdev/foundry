import "server-only";
import type { ControlContext } from "@foundry/control";
import {
  authenticateRunner,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "@foundry/control";
import type { Runner } from "@foundry/db";
import { createLogger, errorFields, InvalidTransitionError } from "@foundry/shared";
import { z } from "zod";
import { getContext } from "./context";

const log = createLogger({ service: "web" });

export function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof z.ZodError) return json({ error: "invalid request", issues: err.issues }, 400);
  if (err instanceof UnauthorizedError) return json({ error: err.message }, 401);
  if (err instanceof ForbiddenError) return json({ error: err.message }, 403);
  if (err instanceof NotFoundError) return json({ error: err.message }, 404);
  if (err instanceof ConflictError || err instanceof InvalidTransitionError)
    return json({ error: err.message }, 409);
  log.error("request failed", errorFields(err));
  return json({ error: "internal error" }, 500);
}

type RunnerHandler<T> = (args: {
  ctx: ControlContext;
  runner: Runner;
  body: T;
  params: Record<string, string>;
}) => Promise<unknown>;

/** Route helper for the runner API: bearer-token auth, zod-validated JSON body, typed errors. */
export function runnerRoute<S extends z.ZodType>(schema: S | null, handler: RunnerHandler<z.infer<S>>) {
  return async (req: Request, { params }: { params: Promise<Record<string, string>> }) => {
    try {
      const ctx = await getContext();
      const runner = await authenticateRunner(ctx, req.headers.get("authorization"));
      const body = (schema ? schema.parse(await req.json()) : undefined) as z.infer<S>;
      const result = await handler({ ctx, runner, body, params: await params });
      return json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}
