import { z } from "zod";

export const HandoffBriefSchema = z.object({
  version: z.literal(1),
  jobId: z.string(),
  title: z.string(),
  stageReached: z.string(),
  harness: z.string(),
  sessionId: z.string().nullable(),
  plan: z.string().nullable(),
  findings: z.array(z.string()).default([]),
  checks: z.array(z.object({ name: z.string(), status: z.string() })).default([]),
  qa: z.array(z.object({ question: z.string(), answer: z.string() })).default([]),
  uncertainties: z.array(z.string()).default([]),
  updatedAt: z.string(),
});

export type HandoffBrief = z.infer<typeof HandoffBriefSchema>;

export function briefRef(jobId: string): string {
  return `refs/foundry/${jobId}/brief`;
}

/** Markdown humans can read, with the machine copy in a fenced JSON block. */
export function renderBrief(b: HandoffBrief): string {
  const lines = [
    `# Handoff brief: ${b.title}`,
    "",
    `Stage reached: **${b.stageReached}** · harness: ${b.harness} · updated ${b.updatedAt}`,
    "",
    "## Plan",
    "",
    b.plan ?? "_none yet_",
    "",
    "## Findings",
    "",
    ...(b.findings.length ? b.findings.map((f) => `- ${f}`) : ["_none_"]),
    "",
    "## Checks",
    "",
    ...(b.checks.length ? b.checks.map((c) => `- ${c.name}: ${c.status}`) : ["_not run_"]),
    "",
    "## Questions and answers",
    "",
    ...(b.qa.length ? b.qa.map((q) => `- Q: ${q.question}\n  A: ${q.answer}`) : ["_none_"]),
    "",
    "## Open uncertainties",
    "",
    ...(b.uncertainties.length ? b.uncertainties.map((u) => `- ${u}`) : ["_none_"]),
    "",
    "```json",
    JSON.stringify(b, null, 2),
    "```",
    "",
  ];
  return lines.join("\n");
}

export function parseBrief(markdown: string): HandoffBrief {
  const m = /```json\n([\s\S]*?)\n```/.exec(markdown);
  if (!m) throw new Error("handoff brief has no JSON block");
  return HandoffBriefSchema.parse(JSON.parse(m[1]!));
}
