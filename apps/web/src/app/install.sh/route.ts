import { installScript } from "@foundry/shared";

export const dynamic = "force-dynamic";

/** `curl -fsSL <server>/install.sh | sh -s -- <fdj_token>` installs the runner and joins it here. */
export function GET() {
  const body = installScript({
    serverUrl: process.env.FOUNDRY_PUBLIC_URL ?? "http://localhost:3000",
    releaseUrl: process.env.FOUNDRY_RELEASE_URL,
  });
  return new Response(body, { headers: { "content-type": "text/x-shellscript; charset=utf-8", "cache-control": "no-store" } });
}
