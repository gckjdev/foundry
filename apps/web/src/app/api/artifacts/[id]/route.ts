import { readArtifact } from "@foundry/control";
import { getContext } from "@/server/context";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const found = await readArtifact(await getContext(), id, token);
  if (!found) return new Response("not found", { status: 404 });
  return new Response(found.bytes, {
    headers: {
      "content-type": found.row.contentType,
      "cache-control": "private, max-age=86400",
      "content-disposition": `inline; filename="${found.row.name}"`,
    },
  });
}
