import { linkInstallation } from "@foundry/control";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/session";

/** GitHub App "Setup URL": GitHub redirects here after the App is installed on an org or account. */
export async function GET(req: Request) {
  const { ctx, team } = await requireAdmin();
  const installationId = Number(new URL(req.url).searchParams.get("installation_id"));
  if (!Number.isInteger(installationId) || installationId <= 0) redirect("/repos?error=missing_installation");
  await linkInstallation(ctx, team.id, installationId);
  redirect("/repos?installed=1");
}
