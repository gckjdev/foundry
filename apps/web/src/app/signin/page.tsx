import { signInAction } from "../actions";

const ERRORS: Record<string, string> = {
  Configuration:
    "GitHub signed you in, but this machine timed out talking to github.com to finish the login. Wait a few seconds and click Sign in again.",
  OAuthCallback: "GitHub redirected back, but the login could not be completed. Try Sign in again.",
  AccessDenied: "GitHub access was denied.",
  Default: "Sign-in failed. Try again.",
};

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const code = typeof sp.error === "string" ? sp.error : undefined;
  const message = code ? (ERRORS[code] ?? ERRORS.Default) : null;
  return (
    <div className="centered">
      <div className="hero stack">
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark" /> Foundry
        </div>
        <h1>Tickets in. Merged PRs out.</h1>
        <p className="dim">
          Label a GitHub issue <code>foundry</code>. An agent picks it up on one of your team&apos;s machines,
          asks when it is unsure, proves its work, and opens the PR.
        </p>
        {message ? (
          <div className="notice" data-tone="bad">
            {message}
          </div>
        ) : null}
        <form action={signInAction}>
          <button className="primary" type="submit">
            Sign in with GitHub
          </button>
        </form>
      </div>
    </div>
  );
}
