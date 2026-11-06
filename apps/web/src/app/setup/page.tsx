import { requireUser } from "@/server/session";
import { createTeamAction } from "../actions";

export default async function Setup() {
  const user = await requireUser();
  return (
    <div className="centered">
      <div className="hero stack">
        <div className="eyebrow">Welcome, @{user.login}</div>
        <h1>Start a team</h1>
        <p className="dim">
          A team owns repos, runners and jobs. If a teammate already set one up, ask them to invite <b>@{user.login}</b>{" "}
          from the Team page instead.
        </p>
        <form action={createTeamAction} className="row">
          <input name="name" placeholder="Team name" required autoFocus />
          <button className="primary" type="submit">
            Create team
          </button>
        </form>
      </div>
    </div>
  );
}
