import { artifactUrl, authenticateRunner, ownedJob, storeArtifact } from "@foundry/control";
import { getContext } from "@/server/context";
import { errorResponse, json } from "@/server/http";

const MAX_BYTES = 10 * 1024 * 1024;

/** Raw upload: body is the file; `x-foundry-job` and `x-foundry-name` headers describe it. */
export async function POST(req: Request) {
  try {
    const ctx = await getContext();
    const runner = await authenticateRunner(ctx, req.headers.get("authorization"));
    const job = await ownedJob(ctx, runner, req.headers.get("x-foundry-job") ?? "");
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return json({ error: "artifact too large" }, 413);
    const row = await storeArtifact(ctx, {
      teamId: job.teamId,
      jobId: job.id,
      name: req.headers.get("x-foundry-name") ?? "artifact",
      contentType: req.headers.get("content-type") ?? "application/octet-stream",
      bytes,
    });
    return json({ artifactId: row.id, url: artifactUrl(ctx, row.id) });
  } catch (err) {
    return errorResponse(err);
  }
}
