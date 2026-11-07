import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { artifacts } from "@foundry/db";
import { signToken, verifyToken } from "@foundry/shared";
import { eq } from "drizzle-orm";
import type { ControlContext } from "./context";

const URL_TTL_S = 30 * 24 * 3600;

export function artifactsDir(): string {
  return resolve(/* turbopackIgnore: true */ process.env.ARTIFACTS_DIR ?? "./.artifacts");
}

export async function storeArtifact(
  ctx: ControlContext,
  input: { teamId: string; jobId: string | null; name: string; contentType: string; bytes: Uint8Array },
) {
  const safeName = input.name.replace(/[^\w.-]+/g, "_").slice(0, 100) || "artifact";
  const [row] = await ctx.db
    .insert(artifacts)
    .values({
      teamId: input.teamId,
      jobId: input.jobId,
      name: safeName,
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
      storageKey: "",
    })
    .returning();
  const key = join(/* turbopackIgnore: true */ input.teamId, row!.id, safeName);
  const path = join(/* turbopackIgnore: true */ artifactsDir(), key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, input.bytes);
  await ctx.db.update(artifacts).set({ storageKey: key }).where(eq(artifacts.id, row!.id));
  return { ...row!, storageKey: key };
}

/** Long-lived signed URL, so screenshots embedded in PR bodies render without a session. */
export function artifactUrl(ctx: ControlContext, artifactId: string): string {
  const t = signToken({ a: artifactId, exp: Math.floor(ctx.now().getTime() / 1000) + URL_TTL_S }, ctx.secret);
  return `${ctx.publicUrl.replace(/\/$/, "")}/api/artifacts/${artifactId}?t=${t}`;
}

export async function readArtifact(ctx: ControlContext, artifactId: string, token: string) {
  const claims = verifyToken<{ a: string; exp: number }>(token, ctx.secret, ctx.now().getTime());
  if (!claims || claims.a !== artifactId) return null;
  const row = await ctx.db.query.artifacts.findFirst({ where: eq(artifacts.id, artifactId) });
  if (!row?.storageKey) return null;
  const bytes = await readFile(
    /* turbopackIgnore: true */ join(/* turbopackIgnore: true */ artifactsDir(), row.storageKey),
  );
  return { row, bytes };
}
