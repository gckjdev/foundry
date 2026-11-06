import { teamMembers } from "@foundry/control";
import { invites } from "@foundry/db";
import { eq } from "drizzle-orm";
import { requireTeam } from "@/server/session";
import { inviteAction } from "../../actions";

export default async function Team() {
  const { ctx, team, role } = await requireTeam();
  const [members, pending] = await Promise.all([
    teamMembers(ctx, team.id),
    ctx.db.select().from(invites).where(eq(invites.teamId, team.id)),
  ]);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{team.name}</div>
          <h1>Team</h1>
        </div>
      </div>
      <section className="card">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Notifications</th>
            </tr>
          </thead>
          <tbody>
            {members.map(({ user, role: r }) => (
              <tr key={user.id}>
                <td>
                  <b>@{user.ghLogin}</b> <span className="faint">{user.name ?? ""}</span>
                </td>
                <td>{r}</td>
                <td className="dim">{user.notifyPref}</td>
              </tr>
            ))}
            {pending.map((i) => (
              <tr key={i.id}>
                <td>
                  @{i.ghLogin} <span className="pill">invited</span>
                </td>
                <td>{i.role}</td>
                <td className="faint">joins on first sign-in</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {role === "admin" ? (
        <section className="card">
          <h2 style={{ marginBottom: 10 }}>Invite by GitHub login</h2>
          <form action={inviteAction} className="row">
            <input name="login" placeholder="octocat" required />
            <select name="role" defaultValue="member">
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
            <button className="primary" type="submit">
              Invite
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
