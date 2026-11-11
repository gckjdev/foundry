import Link from "next/link";
import { LiveRefresh } from "@/components/live-refresh";
import { PanelShell } from "@/components/panel-shell";
import { requireTeam } from "@/server/session";
import { signOutAction, switchTeamAction } from "../actions";

const LINKS = [
  ["/board", "Board"],
  ["/inbox", "Inbox"],
  ["/runners", "Runners"],
  ["/repos", "Repos"],
  ["/metrics", "Metrics"],
  ["/team", "Team"],
  ["/settings", "Settings"],
] as const;

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const { user, team, teams } = await requireTeam();
  return (
    <PanelShell
      nav={
        <nav className="nav">
          <div className="brand">
            <span className="brand-mark" /> Foundry
          </div>
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
          <div className="spacer" />
          <div style={{ padding: "0 10px 10px" }}>
            <LiveRefresh />
          </div>
          {teams.length > 1 ? (
            <form action={switchTeamAction} className="stack" style={{ padding: "0 10px 10px" }}>
              <select name="teamId" defaultValue={team.id}>
                {teams.map((t) => (
                  <option key={t.team.id} value={t.team.id}>
                    {t.team.name}
                  </option>
                ))}
              </select>
              <button type="submit">Switch team</button>
            </form>
          ) : null}
          <div className="who">
            <div>{team.name}</div>
            <div>@{user.login}</div>
            <form action={signOutAction}>
              <button type="submit" className="small" style={{ marginTop: 8, padding: "3px 8px" }}>
                Sign out
              </button>
            </form>
          </div>
        </nav>
      }
    >
      {children}
    </PanelShell>
  );
}
