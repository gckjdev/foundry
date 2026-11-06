import { eventsSince } from "@foundry/control";
import { json } from "@/server/http";
import { requireTeam } from "@/server/session";

/** Incremental timeline for the job page's live log. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { ctx, team } = await requireTeam();
  const { id } = await params;
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0);
  return json({ events: await eventsSince(ctx, team.id, id, Number.isFinite(after) ? after : 0) });
}
