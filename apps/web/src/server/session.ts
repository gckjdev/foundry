import "server-only";
import { requireMember, teamsForUser } from "@foundry/control";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { getContext } from "./context";

export const TEAM_COOKIE = "foundry_team";
export const INSTALL_COOKIE = "foundry_install";

// `cache` keeps one auth + membership lookup per request. The panel layout and the page below it
// both call `requireTeam()`, so without this each navigation repeated the same `teamsForUser` query.
export const requireUser = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  return session.user;
});

/** The signed-in user and their current team (cookie, else their first team). */
export const requireTeam = cache(async () => {
  const user = await requireUser();
  const ctx = await getContext();
  const teams = await teamsForUser(ctx, user.id);
  if (teams.length === 0) redirect("/setup");
  const wanted = (await cookies()).get(TEAM_COOKIE)?.value;
  const current = teams.find((t) => t.team.id === wanted) ?? teams[0]!;
  return { ctx, user, team: current.team, role: current.role, teams };
});

export async function requireAdmin() {
  const s = await requireTeam();
  await requireMember(s.ctx, s.user.id, s.team.id, "admin");
  return s;
}
