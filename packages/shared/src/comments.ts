import { type JobStatus, STATUS_TITLES } from "./states";

const LETTERS = "ABCDEFGHIJ";

export function questionMarker(questionId: string): string {
  return `<!-- foundry:question:${questionId} -->`;
}

export function statusMarker(jobId: string): string {
  return `<!-- foundry:status:${jobId} -->`;
}

export function findMarker(body: string, kind: "question" | "status"): string | null {
  const m = new RegExp(`<!-- foundry:${kind}:([\\w-]+) -->`).exec(body);
  return m?.[1] ?? null;
}

export function renderQuestionComment(q: {
  id: string;
  mention: string | null;
  prompt: string;
  options: string[];
}): string {
  const who = q.mention ? `@${q.mention} ` : "";
  const lines = [
    questionMarker(q.id),
    `${who}I need one decision before continuing:`,
    "",
    `**${q.prompt}**`,
  ];
  if (q.options.length > 0) {
    lines.push("");
    q.options.forEach((opt, i) => lines.push(`- [ ] ${LETTERS[i]}. ${opt}`));
    lines.push("", "Tick one box, or reply with your own answer.");
  } else {
    lines.push("", "Reply to this issue with your answer.");
  }
  return lines.join("\n");
}

export function renderAnsweredQuestion(
  q: { id: string; prompt: string; options: string[] },
  answer: { text: string; optionIndex: number | null; by: string },
): string {
  const label = answer.optionIndex !== null ? `${LETTERS[answer.optionIndex]}. ${answer.text}` : answer.text;
  const lines = [questionMarker(q.id), `**${q.prompt}**`, ""];
  q.options.forEach((opt, i) => lines.push(`- [${i === answer.optionIndex ? "x" : " "}] ${LETTERS[i]}. ${opt}`));
  lines.push("", `Answered: ${label} by @${answer.by}`);
  return lines.join("\n");
}

/** Index of the first ticked option in an edited question comment, or null. */
export function parseCheckedOption(body: string): number | null {
  const items = [...body.matchAll(/^- \[( |x|X)\] ([A-J])\. /gm)];
  const checked = items.find((m) => m[1]!.toLowerCase() === "x");
  return checked ? LETTERS.indexOf(checked[2]!) : null;
}

/** Interpret a reply comment: "A", "b.", "Option C ..." pick an option; anything else is free text. */
export function parseReplyAnswer(text: string, options: string[]): { optionIndex: number | null; text: string } {
  const trimmed = text.trim();
  const m = /^(?:option\s+)?([A-J])(?:[.):\s]|$)/i.exec(trimmed);
  if (m && options.length > 0) {
    const idx = LETTERS.indexOf(m[1]!.toUpperCase());
    if (idx >= 0 && idx < options.length) return { optionIndex: idx, text: options[idx]! };
  }
  return { optionIndex: null, text: trimmed };
}

export interface StatusCommentInput {
  jobId: string;
  status: JobStatus;
  runnerName: string | null;
  costUsd: number;
  jobUrl: string;
  prUrl: string | null;
  note?: string | null;
}

export function renderStatusComment(s: StatusCommentInput): string {
  const lines = [
    statusMarker(s.jobId),
    `**Foundry** · ${STATUS_TITLES[s.status]}`,
    "",
    "| | |",
    "|---|---|",
    `| Stage | ${STATUS_TITLES[s.status]} |`,
    `| Runner | ${s.runnerName ?? "not assigned"} |`,
    `| Cost so far | $${s.costUsd.toFixed(2)} |`,
    `| Job | [open in Foundry](${s.jobUrl}) |`,
  ];
  if (s.prUrl) lines.push(`| Pull request | ${s.prUrl} |`);
  if (s.note) lines.push("", s.note);
  return lines.join("\n");
}

export interface PrBodyInput {
  issueNumber: number | null;
  summary: string;
  plan: string | null;
  evidence: { name: string; status: string; command?: string | null }[];
  confidence: { level: string; reasons: string[]; uncertainties: string[] } | null;
  jobUrl: string;
  screenshots: { name: string; url: string }[];
}

export function renderPrBody(p: PrBodyInput): string {
  const lines: string[] = [];
  if (p.issueNumber) lines.push(`Closes #${p.issueNumber}`, "");
  lines.push("## Summary", "", p.summary.trim() || "_No summary provided._", "");
  if (p.plan) lines.push("## Plan", "", p.plan.trim(), "");
  lines.push("## Evidence", "");
  if (p.evidence.length === 0) lines.push("_No checks were run._");
  for (const e of p.evidence) {
    const icon = e.status === "passed" ? "PASS" : e.status === "failed" ? "FAIL" : "SKIP";
    lines.push(`- **${icon}** ${e.name}${e.command ? ` — \`${e.command}\`` : ""}`);
  }
  for (const s of p.screenshots) lines.push("", `![${s.name}](${s.url})`);
  lines.push("", "## Confidence", "");
  if (p.confidence) {
    lines.push(`Self-assessed: **${p.confidence.level}**`);
    for (const r of p.confidence.reasons) lines.push(`- ${r}`);
    if (p.confidence.uncertainties.length) {
      lines.push("", "Open uncertainties:");
      for (const u of p.confidence.uncertainties) lines.push(`- ${u}`);
    }
  } else {
    lines.push("_Not reported._");
  }
  lines.push("", `---`, `Opened by [Foundry](${p.jobUrl}).`);
  return lines.join("\n");
}

/** `/foundry <message>` on a PR or issue comment. */
export function parseFoundryCommand(body: string): string | null {
  const m = /^\/foundry\s+([\s\S]+)$/m.exec(body.trim());
  return m ? m[1]!.trim() : null;
}
