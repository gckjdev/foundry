import { processWebhook, storeWebhook, withLogFields } from "@foundry/control";
import { verifyWebhookSignature } from "@foundry/github";
import { createLogger, errorFields, type Logger, newCorrelationId } from "@foundry/shared";
import { after } from "next/server";
import { getContext } from "@/server/context";
import { json } from "@/server/http";

const log = createLogger({ service: "webhook" });
const ROUTE = "POST /api/webhooks/github";

export async function POST(req: Request) {
  // One id ties every line of this delivery together, in the route and in control.
  const correlationId = newCorrelationId();
  const delivery = req.headers.get("x-github-delivery") ?? undefined;
  const event = req.headers.get("x-github-event") ?? undefined;
  const requestLog = log.child({ correlationId, delivery, event });
  const started = Date.now();
  requestLog.debug("api request", { route: ROUTE, method: "POST" });
  try {
    const res = await handle(req, requestLog, correlationId, delivery, event);
    requestLog.debug("api response", {
      route: ROUTE,
      status: res.status,
      durationMs: Date.now() - started,
    });
    return res;
  } catch (err) {
    requestLog.error("api request failed", {
      route: ROUTE,
      durationMs: Date.now() - started,
      ...errorFields(err),
    });
    throw err;
  }
}

async function handle(
  req: Request,
  requestLog: Logger,
  correlationId: string,
  delivery: string | undefined,
  event: string | undefined,
): Promise<Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    requestLog.error("GITHUB_WEBHOOK_SECRET is not set");
    return json({ error: "GITHUB_WEBHOOK_SECRET is not set" }, 500);
  }
  const raw = await req.text();
  if (!(await verifyWebhookSignature(secret, raw, req.headers.get("x-hub-signature-256")))) {
    requestLog.warn("webhook rejected: bad signature", { delivery, event });
    return json({ error: "bad signature" }, 401);
  }
  if (!delivery || !event) {
    requestLog.warn("webhook rejected: missing GitHub headers", { delivery, event });
    return json({ error: "missing GitHub headers" }, 400);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    requestLog.warn("webhook rejected: invalid JSON", { delivery, event });
    return json({ error: "invalid JSON" }, 400);
  }
  const ctx = withLogFields(await getContext(), { correlationId, delivery, event });
  const id = await storeWebhook(ctx, delivery, event, payload);
  // Acknowledge fast; GitHub times out after 10 s. The worker retries anything left unprocessed.
  if (id !== null) {
    requestLog.info("webhook accepted", { delivery, event });
    // `after` runs beyond this request; the scoped context carries the correlation id with it.
    after(() => processWebhook(ctx, id));
  } else {
    requestLog.debug("duplicate webhook", { delivery, event });
  }
  return json({ ok: true, duplicate: id === null }, 202);
}
