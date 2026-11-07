import { syncUnlinkedInstallations, teamRepos } from "@foundry/control";
import { HARNESS_IDS } from "@foundry/shared";
import { requireTeam } from "@/server/session";
import { onboardAction, repoSettingsAction, syncReposAction } from "../../actions";

const ONBOARDING: Record<string, { label: string; tone: string }> = {
  not_started: { label: "not onboarded", tone: "" },
  running: { label: "onboarding…", tone: "live" },
  pr_open: { label: "recipe PR open", tone: "info" },
  done: { label: "accepting jobs", tone: "ok" },
  failed: { label: "onboarding failed", tone: "bad" },
};

export default async function Repos({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { ctx, team, role } = await requireTeam();
  let list = await teamRepos(ctx, team.id);
  let syncError: string | null = null;
  if (list.length === 0 && role === "admin") {
    try {
      await syncUnlinkedInstallations(ctx, team.id);
      list = await teamRepos(ctx, team.id);
    } catch (err) {
      syncError = err instanceof Error ? err.message : String(err);
    }
  }
  const sp = await searchParams;
  const appSlug = process.env.GITHUB_APP_SLUG;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{team.name}</div>
          <h1>Repos</h1>
        </div>
        <div className="row">
          {role === "admin" ? (
            <form action={syncReposAction}>
              <button type="submit">Sync from GitHub</button>
            </form>
          ) : null}
          {appSlug && role === "admin" ? (
            <a className="button primary" href={`https://github.com/apps/${appSlug}/installations/new`}>
              Install GitHub App
            </a>
          ) : null}
        </div>
      </div>
      {sp.installed ? (
        <div className="notice" style={{ marginBottom: 14 }}>
          GitHub App installed. Repos synced.
        </div>
      ) : null}
      {syncError ? (
        <div className="notice" data-tone="bad" style={{ marginBottom: 14 }}>
          Could not list GitHub App repos: {syncError}
        </div>
      ) : null}
      {list.length === 0 ? (
        <div className="notice">
          No repos yet. Install the Foundry GitHub App on your org or account and pick the repos Foundry may
          work on.
        </div>
      ) : null}
      <div className="stack">
        {list.map((repo) => {
          const ob = ONBOARDING[repo.onboardingStatus] ?? ONBOARDING.not_started!;
          return (
            <section key={repo.id} className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="row">
                  <h2>{repo.fullName}</h2>
                  <span className="pill" data-tone={ob.tone}>
                    {ob.label}
                  </span>
                </div>
                {!repo.acceptsJobs && repo.onboardingStatus !== "pr_open" ? (
                  <form action={onboardAction}>
                    <input type="hidden" name="repoId" value={repo.id} />
                    {repo.onboardingStatus === "running" || repo.onboardingStatus === "failed" ? (
                      <input type="hidden" name="restart" value="1" />
                    ) : null}
                    <button className="primary" type="submit">
                      {repo.onboardingStatus === "not_started" ? "Onboard repo" : "Retry onboarding"}
                    </button>
                  </form>
                ) : null}
              </div>
              {repo.acceptsJobs ? (
                <p className="dim small">
                  Recipe {repo.recipeSha?.slice(0, 7)} on {repo.defaultBranch}. Label an issue{" "}
                  <code>foundry</code> to start a job.
                </p>
              ) : (
                <p className="dim small">
                  Onboarding runs an agent that writes <code>.foundry/recipe.yaml</code> and{" "}
                  <code>policy.yaml</code>, proves every command on a runner, and opens a PR for you to
                  review.
                </p>
              )}
              {role === "admin" ? (
                <form
                  action={repoSettingsAction}
                  className="row"
                  style={{ marginTop: 10, alignItems: "flex-end" }}
                >
                  <input type="hidden" name="repoId" value={repo.id} />
                  <label>
                    Merge mode
                    <select name="mergeMode" defaultValue={repo.mergeMode}>
                      <option value="off">Off — always hand over</option>
                      <option value="merge_when_confident">Merge when confident</option>
                    </select>
                  </label>
                  <label>
                    Default harness
                    <select name="defaultHarness" defaultValue={repo.defaultHarness ?? ""}>
                      <option value="">Team default</option>
                      {HARNESS_IDS.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Default model
                    <input
                      name="defaultModel"
                      defaultValue={repo.defaultModel ?? ""}
                      placeholder="team default"
                    />
                  </label>
                  <label>
                    GitHub Project ID (optional)
                    <input name="ghProjectId" defaultValue={repo.ghProjectId ?? ""} placeholder="PVT_…" />
                  </label>
                  <button type="submit">Save</button>
                </form>
              ) : null}
            </section>
          );
        })}
      </div>
    </>
  );
}
