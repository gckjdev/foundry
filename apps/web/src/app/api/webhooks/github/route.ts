import { processWebhook, storeWebhook } from "@foundry/control";
import { verifyWebhookSignature } from "@foundry/github";
import { after } from "next/server";
import { getContext } from "@/server/context";
import { json } from "@/server/http";

export async function POST(req: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return json({ error: "GITHUB_WEBHOOK_SECRET is not set" }, 500);
  const raw = await req.text();
  if (!(await verifyWebhookSignature(secret, raw, req.headers.get("x-hub-signature-256")))) {
    return json({ error: "bad signature" }, 401);
  }
  const delivery = req.headers.get("x-github-delivery");
  const event = req.headers.get("x-github-event");
  if (!delivery || !event) return json({ error: "missing GitHub headers" }, 400);
  const ctx = await getContext();
  const id = await storeWebhook(ctx, delivery, event, JSON.parse(raw));
  // Acknowledge fast; GitHub times out after 10 s. The worker retries anything left unprocessed.
  if (id !== null) after(() => processWebhook(ctx, id));
  return json({ ok: true, duplicate: id === null }, 202);
}
