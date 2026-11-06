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

export function verifyToken<T extends { exp: number }>(token: string, secret: string, now = Date.now()): T | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as T;
    if (typeof claims.exp !== "number" || claims.exp * 1000 < now) return null;
    return claims;
  } catch {
    return null;
  }
}

export function randomToken(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
