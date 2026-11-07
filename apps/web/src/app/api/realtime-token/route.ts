import { realtimeToken } from "@foundry/control";
import { json } from "@/server/http";
import { requireTeam } from "@/server/session";

export async function GET() {
  const { ctx, user, team } = await requireTeam();
  return json({
    url: ctx.realtimeUrl,
    token: realtimeToken(ctx, { teamId: team.id, sub: user.id, kind: "user" }),
  });
}
