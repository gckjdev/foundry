import { processWebhook, storeWebhook } from "@foundry/control";
import { verifyWebhookSignature } from "@foundry/github";
import { createLogger } from "@foundry/shared";
import { after } from "next/server";
import { getContext } from "@/server/context";
import { json } from "@/server/http";

const log = createLogger({ service: "webhook" });

export async function POST(req: Request) {
  const delivery = req.headers.get("x-github-delivery") ?? undefined;
  const event = req.headers.get("x-github-event") ?? undefined;
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    log.error("GITHUB_WEBHOOK_SECRET is not set");
    return json({ error: "GITHUB_WEBHOOK_SECRET is not set" }, 500);
  }
  const raw = await req.text();
  if (!(await verifyWebhookSignature(secret, raw, req.headers.get("x-hub-signature-256")))) {
    log.warn("webhook rejected: bad signature", { delivery, event });
    return json({ error: "bad signature" }, 401);
  }
  if (!delivery || !event) {
    log.warn("webhook rejected: missing GitHub headers", { delivery, event });
    return json({ error: "missing GitHub headers" }, 400);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    log.warn("webhook rejected: invalid JSON", { delivery, event });
    return json({ error: "invalid JSON" }, 400);
  }
  const ctx = await getContext();
  const id = await storeWebhook(ctx, delivery, event, payload);
  // Acknowledge fast; GitHub times out after 10 s. The worker retries anything left unprocessed.
  if (id !== null) {
    log.info("webhook accepted", { delivery, event });
    after(() => processWebhook(ctx, id));
  } else {
    log.debug("duplicate webhook", { delivery, event });
  }
  return json({ ok: true, duplicate: id === null }, 202);
}
