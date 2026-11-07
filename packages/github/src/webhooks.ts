import { verify } from "@octokit/webhooks-methods";

/** Check the `X-Hub-Signature-256` header against the raw request body. */
export async function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  if (!signature) return false;
  try {
    return await verify(secret, rawBody, signature);
  } catch {
    return false;
  }
}

export { sign as signWebhookPayload } from "@octokit/webhooks-methods";
