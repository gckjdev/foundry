import { users } from "@foundry/db";
import { eq } from "drizzle-orm";
import { json } from "@/server/http";
import { requireTeam } from "@/server/session";

export async function POST(req: Request) {
  const { ctx, user } = await requireTeam();
  const subscription = await req.json();
  await ctx.db.update(users).set({ pushSubscription: subscription, notifyPref: "push" }).where(eq(users.id, user.id));
  return json({ ok: true });
}

export async function GET() {
  return json({ publicKey: process.env.VAPID_PUBLIC_KEY ?? null });
}
