import { signInAction } from "../actions";

export default function SignIn() {
  return (
    <div className="centered">
      <div className="hero stack">
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark" /> Foundry
        </div>
        <h1>Tickets in. Merged PRs out.</h1>
        <p className="dim">
          Label a GitHub issue <code>foundry</code>. An agent picks it up on one of your team&apos;s machines, asks when it
          is unsure, proves its work, and opens the PR.
        </p>
        <form action={signInAction}>
          <button className="primary" type="submit">
            Sign in with GitHub
          </button>
        </form>
      </div>
    </div>
  );
}
