import { artifactUrl, diagnoseQueue, jobDetail } from "@foundry/control";
import type { EventRow } from "@foundry/db";
import {
  type FoundryEvent,
  type GateResult,
  type JobStatus,
  RUNNER_STAGES,
  STATUS_TITLES,
} from "@foundry/shared";
import { githubIssueUrl } from "@foundry/shared/github-host";
import { notFound } from "next/navigation";
import { ago, StatusPill, usd } from "@/components/status";
import { requireTeam } from "@/server/session";
import { answerAction, cancelAction, helpfulAction, messageAction, retryAction } from "../../../actions";
import { LiveLog } from "./live-log";

function describe(e: FoundryEvent): string | null {
  switch (e.kind) {
    case "stage_changed":
      return `${e.from ? `${STATUS_TITLES[e.from]} → ` : ""}${STATUS_TITLES[e.to]}${e.reason ? ` · ${e.reason}` : ""}`;
    case "resumed":
      return `Resumed on ${e.runnerName} (${e.mode === "sticky" ? "same session" : "fresh session from handoff brief"})`;
    case "question":
      return `Asked: ${e.prompt}`;
    case "answer":
      return `@${e.by} answered: ${e.text}`;
    case "checkpoint":
      return `Checkpoint after ${e.stage}`;
    case "gate":
      return e.pass ? "Confidence gate passed" : `Gate held: ${e.failed.map((f) => f.rule).join(", ")}`;
    case "evidence":
      return `Evidence ${e.name}: ${e.status}`;
    case "error":
      return `Error: ${e.message}`;
    case "message":
      return e.role === "human" ? e.text : null;
    default:
      return null;
  }
}

const TIMELINE_KINDS = new Set([
  "stage_changed",
  "resumed",
  "question",
  "answer",
  "checkpoint",
  "gate",
  "error",
  "message",
]);

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, team } = await requireTeam();
  const d = await jobDetail(ctx, team.id, id).catch(() => null);
  if (!d) notFound();
  const { job, repo } = d;
  const status = job.status as JobStatus;
  const gate = job.gateResult as GateResult | null;
  const confidence = job.confidence as { level: string; reasons: string[]; uncertainties: string[] } | null;
  const openQuestion = d.questions.find((q) => !q.answeredAt);
  const waiting =
    status === "queued" ? (await diagnoseQueue(ctx, team.id)).find((x) => x.jobId === job.id)?.reason : null;
  const timeline = d.timeline.filter((e: EventRow) => TIMELINE_KINDS.has(e.kind));
  const lastEventId = d.timeline.at(-1)?.id ?? 0;
  const initialLog = d.timeline
    .slice(-200)
    .map((e) => ({ id: e.id, ts: e.ts.toISOString(), payload: e.payload as FoundryEvent }));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            {repo.fullName}
            {job.issueNumber ? (
              <>
                {" · "}
                <a href={githubIssueUrl(process.env.GITHUB_HOST, repo.fullName, job.issueNumber)}>
                  #{job.issueNumber}
                </a>
              </>
            ) : null}
            {job.kind === "onboarding" ? " · onboarding" : ""}
          </div>
          <h1>{job.title}</h1>
          <div className="row" style={{ marginTop: 10 }}>
            <StatusPill status={status} />
            <span className="dim">
              {job.harness}
              {job.model ? ` / ${job.model}` : ""}
            </span>
            <span className="dim">· {d.runnerName ? `on ${d.runnerName}` : "no runner"}</span>
            <span className="dim">· {usd(job.costUsd)}</span>
            <span className="dim">· loop {job.loopCount}</span>
            {job.resumeCount > 0 ? (
              <span className="pill" data-tone="info">
                resumed ×{job.resumeCount}
              </span>
            ) : null}
            {job.prUrl ? <a href={job.prUrl}>Pull request ↗</a> : null}
          </div>
          {waiting ? (
            <div className="waiting" style={{ marginTop: 8 }}>
              ⏸ Waiting: {waiting}
            </div>
          ) : null}
          {job.failureReason && status === "failed" ? (
            <div className="waiting" style={{ color: "var(--bad)" }}>
              {job.failureReason}
            </div>
          ) : null}
        </div>
        <div className="row">
          <form action={retryAction} className="row">
            <input type="hidden" name="jobId" value={job.id} />
            <select name="stage" defaultValue={job.lastCompletedStage ? job.resumeStage : "triage"}>
              {RUNNER_STAGES.map((s) => (
                <option key={s} value={s}>
                  from {STATUS_TITLES[s]}
                </option>
              ))}
            </select>
            <button type="submit">Retry</button>
          </form>
          {job.worktreePath && d.runnerName ? (
            <span className="pill" title={`Run on ${d.runnerName}: foundry open ${job.id.slice(0, 8)}`}>
              foundry open {job.id.slice(0, 8)}
            </span>
          ) : null}
          {!["merged", "cancelled"].includes(status) ? (
            <form action={cancelAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <button type="submit" className="danger">
                Cancel
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {openQuestion ? (
        <section className="card" style={{ borderColor: "var(--warn)" }}>
          <div className="eyebrow" style={{ color: "var(--warn)" }}>
            Needs your answer {openQuestion.askedLogin ? `· asked @${openQuestion.askedLogin}` : ""}
          </div>
          <h2 style={{ marginBottom: 12 }}>{openQuestion.prompt}</h2>
          <form action={answerAction} className="stack">
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="questionId" value={openQuestion.id} />
            {(openQuestion.options as string[]).map((opt, i) => (
              <label key={opt} className="row" style={{ flexDirection: "row", color: "var(--text)" }}>
                <input type="radio" name="option" value={i} /> {String.fromCharCode(65 + i)}. {opt}
              </label>
            ))}
            <textarea name="text" placeholder="Or write your own answer" />
            <div>
              <button className="primary" type="submit">
                Answer and resume
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <div className="grid grid-2" style={{ marginTop: 14, alignItems: "start" }}>
        <div className="stack">
          <section className="card">
            <h2 style={{ marginBottom: 12 }}>Timeline</h2>
            <div className="timeline">
              {timeline.map((e) => {
                const text = describe(e.payload as FoundryEvent);
                if (!text) return null;
                return (
                  <div key={e.id} className="tl-item" data-kind={e.kind}>
                    <div>{text}</div>
                    <div className="tl-time">
                      {e.ts.toLocaleString()} · {ago(e.ts)}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="card">
            <h2 style={{ marginBottom: 10 }}>Message the agent</h2>
            <form action={messageAction} className="stack">
              <input type="hidden" name="jobId" value={job.id} />
              <textarea
                name="text"
                placeholder="Guidance, a correction, or a follow-up change. Parked jobs resume at Implementing."
              />
              <div>
                <button type="submit">Send</button>
              </div>
            </form>
          </section>
          {d.questions.filter((q) => q.answeredAt).length > 0 ? (
            <section className="card">
              <h2 style={{ marginBottom: 10 }}>Questions</h2>
              {d.questions
                .filter((q) => q.answeredAt)
                .map((q) => (
                  <div key={q.id} style={{ marginBottom: 12 }}>
                    <div>{q.prompt}</div>
                    <div className="dim small">
                      → {q.answer} · @{q.answeredBy} via {q.answeredVia?.replace("gh_", "GitHub ")}
                    </div>
                    <form action={helpfulAction} className="row small" style={{ marginTop: 4 }}>
                      <input type="hidden" name="jobId" value={job.id} />
                      <input type="hidden" name="questionId" value={q.id} />
                      <span className="faint">Good question?</span>
                      <button
                        name="helpful"
                        value="yes"
                        type="submit"
                        style={{ padding: "1px 8px" }}
                        aria-pressed={q.helpful === true}
                      >
                        👍
                      </button>
                      <button
                        name="helpful"
                        value="no"
                        type="submit"
                        style={{ padding: "1px 8px" }}
                        aria-pressed={q.helpful === false}
                      >
                        👎
                      </button>
                    </form>
                  </div>
                ))}
            </section>
          ) : null}
        </div>

        <div className="stack">
          {job.plan ? (
            <section className="card">
              <h2 style={{ marginBottom: 10 }}>Plan</h2>
              <pre className="dim">{job.plan}</pre>
            </section>
          ) : null}
          <section className="card">
            <h2 style={{ marginBottom: 10 }}>Evidence</h2>
            {d.evidence.length === 0 ? (
              <div className="faint">No checks recorded yet.</div>
            ) : (
              <table>
                <tbody>
                  {d.evidence.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <span
                          className="pill"
                          data-tone={e.status === "passed" ? "ok" : e.status === "failed" ? "bad" : ""}
                        >
                          {e.status}
                        </span>
                      </td>
                      <td>
                        <div>
                          {e.name} <span className="faint">loop {e.loop}</span>
                        </div>
                        {e.command ? <div className="faint small">$ {e.command}</div> : null}
                        {e.artifactId ? (
                          // biome-ignore lint/performance/noImgElement: signed artifact URL, not a static asset
                          <img
                            src={artifactUrl(ctx, e.artifactId)}
                            alt={e.name}
                            style={{ maxWidth: "100%", marginTop: 8, borderRadius: 4 }}
                          />
                        ) : null}
                        {e.outputTail && e.status === "failed" ? (
                          <pre className="log small">{e.outputTail}</pre>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="card">
            <h2 style={{ marginBottom: 10 }}>Confidence gate</h2>
            {confidence ? (
              <div style={{ marginBottom: 10 }}>
                Agent says <b>{confidence.level}</b>
                {confidence.uncertainties.length ? (
                  <ul className="dim">
                    {confidence.uncertainties.map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {gate ? (
              <>
                <div className="row" style={{ marginBottom: 8 }}>
                  <span className="pill" data-tone={gate.pass ? "ok" : gate.pending ? "info" : "warn"}>
                    {gate.pass ? "passed" : gate.pending ? "waiting on CI / review" : "held for a human"}
                  </span>
                </div>
                <ul className="dim">
                  {gate.failed.map((f) => (
                    <li key={f.rule}>
                      <b>{f.rule}</b> — {f.detail}
                    </li>
                  ))}
                </ul>
                {(job.assignedReviewers as string[]).length ? (
                  <div className="small">
                    Routed to {(job.assignedReviewers as string[]).map((r) => `@${r}`).join(", ")}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="faint">Evaluated once the PR is open.</div>
            )}
          </section>
          <section className="card">
            <h2 style={{ marginBottom: 10 }}>Live log</h2>
            <LiveLog jobId={job.id} initial={initialLog} after={lastEventId} />
          </section>
        </div>
      </div>
    </>
  );
}
