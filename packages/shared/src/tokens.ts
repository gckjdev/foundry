import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface RealtimeClaims {
  /** Team whose changes the holder may receive. */
  teamId: string;
  sub: string;
  kind: "user" | "runner";
  exp: number;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

export function signToken(payload: object, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export type TokenRejection = "malformed" | "bad-signature" | "expired";

export type TokenVerification<T> = { ok: true; claims: T } | { ok: false; reason: TokenRejection };

/**
 * Like `verifyToken`, but says why a token was rejected so callers can give the user
 * actionable advice. The reason is only "expired" once the signature checks out.
 */
export function verifyTokenDetailed<T extends { exp: number }>(
  token: string,
  secret: string,
  now = Date.now(),
): TokenVerification<T> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return { ok: false, reason: "malformed" };
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return { ok: false, reason: "bad-signature" };
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as T;
    if (typeof claims.exp !== "number") return { ok: false, reason: "malformed" };
    if (claims.exp * 1000 < now) return { ok: false, reason: "expired" };
    return { ok: true, claims };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

export function verifyToken<T extends { exp: number }>(
  token: string,
  secret: string,
  now = Date.now(),
): T | null {
  const result = verifyTokenDetailed<T>(token, secret, now);
  return result.ok ? result.claims : null;
}

export function randomToken(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
