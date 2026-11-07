import { linkInstallation, syncUnlinkedInstallations } from "@foundry/control";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { INSTALL_COOKIE, requireAdmin } from "@/server/session";

/**
 * GitHub App Setup URL, and also the post-login landing so an install that happened
 * before the user had a session is still attached to their team.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const fromQuery = Number(url.searchParams.get("installation_id"));
  const fromCookie = Number(jar.get(INSTALL_COOKIE)?.value);
  const installationId = Number.isInteger(fromQuery) && fromQuery > 0 ? fromQuery : fromCookie;

  const session = await auth();
  if (!Number.isInteger(installationId) || installationId <= 0) {
    if (!session?.user?.id) redirect("/signin");
    const { ctx, team } = await requireAdmin();
    await syncUnlinkedInstallations(ctx, team.id);
    redirect("/repos?installed=1");
  }

  if (!session?.user?.id) {
    jar.set(INSTALL_COOKIE, String(installationId), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 60,
    });
    redirect("/signin");
  }

  const { ctx, team } = await requireAdmin();
  await linkInstallation(ctx, team.id, installationId);
  jar.delete(INSTALL_COOKIE);
  redirect("/repos?installed=1");
}
