import { spendToday } from "@foundry/control";
import { users } from "@foundry/db";
import { HARNESS_IDS } from "@foundry/shared";
import { eq } from "drizzle-orm";
import { usd } from "@/components/status";
import { requireTeam } from "@/server/session";
import { notifyPrefAction, teamSettingsAction } from "../../actions";
import { PushToggle } from "./push-toggle";

export default async function Settings() {
  const { ctx, team, user, role } = await requireTeam();
  const me = await ctx.db.query.users.findFirst({ where: eq(users.id, user.id) });
  const spent = await spendToday(ctx, team.id);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{team.name}</div>
          <h1>Settings</h1>
        </div>
      </div>
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <section className="card">
          <h2 style={{ marginBottom: 12 }}>Your notifications</h2>
          <form action={notifyPrefAction} className="stack">
            <label>
              When Foundry needs you
              <select name="notifyPref" defaultValue={me?.notifyPref ?? "github"}>
                <option value="github">GitHub only (mentions and review requests)</option>
                <option value="email">Email right away</option>
                <option value="push">Browser / desktop push</option>
                <option value="digest">Daily email digest</option>
              </select>
            </label>
            <label>
              Email
              <input name="email" type="email" defaultValue={me?.email ?? ""} />
            </label>
            <div>
              <button type="submit">Save</button>
            </div>
          </form>
          <div style={{ marginTop: 14 }}>
            <PushToggle />
          </div>
        </section>
        <section className="card">
          <h2 style={{ marginBottom: 12 }}>Team</h2>
          <div className="dim" style={{ marginBottom: 12 }}>
            Spent today: <b>{usd(spent)}</b>
            {team.dailySpendCapUsd ? ` of ${usd(team.dailySpendCapUsd)} cap` : ""}
          </div>
          <form action={teamSettingsAction} className="stack">
            <fieldset disabled={role !== "admin"} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <label>
                Team name
                <input name="name" defaultValue={team.name} />
              </label>
              <label>
                Daily spend cap (USD) — runners stop claiming new jobs once reached
                <input name="dailySpendCapUsd" type="number" step="0.5" min="0" defaultValue={team.dailySpendCapUsd ?? ""} />
              </label>
              <label>
                Default harness
                <select name="defaultHarness" defaultValue={team.defaultHarness}>
                  {HARNESS_IDS.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Default model
                <input name="defaultModel" defaultValue={team.defaultModel ?? ""} placeholder="harness default" />
              </label>
              <label>
                Outgoing webhook (Slack, Discord or any URL) — receives handovers, questions, merges and failures
                <input name="outgoingWebhookUrl" type="url" defaultValue={team.outgoingWebhookUrl ?? ""} placeholder="https://hooks.slack.com/…" />
              </label>
              <div>
                <button type="submit">Save team settings</button>
              </div>
            </fieldset>
          </form>
        </section>
      </div>
    </>
  );
}
