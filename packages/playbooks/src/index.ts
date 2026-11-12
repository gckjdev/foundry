/// <reference path="./md.d.ts" />
import {
  type CiFailure,
  type HandoffBrief,
  type PendingInput,
  parseTicketSections,
  renderBrief,
} from "@foundry/shared";
import bugfix from "./playbooks/bugfix.md" with { type: "text" };
import defaultPlaybook from "./playbooks/default.md" with { type: "text" };
import feature from "./playbooks/feature.md" with { type: "text" };
import onboarding from "./playbooks/onboarding.md" with { type: "text" };
import reviewer from "./playbooks/reviewer.md" with { type: "text" };
import mergeRiskSkill from "./skills/merge-risk/SKILL.md" with { type: "text" };
import showMeSkill from "./skills/show-me/SKILL.md" with { type: "text" };

/** Skills that ship with Foundry and can be installed into a repo's harness skill folders. */
export const BUILTIN_SKILLS: Record<string, string> = {
  "merge-risk": mergeRiskSkill,
  "show-me": showMeSkill,
};

/** Skills the onboarding PR installs into a repo. */
export const PLAYBOOK_SKILLS = ["merge-risk", "show-me"] as const;

/** A SKILL.md body without its YAML frontmatter, for embedding in a prompt. */
export function skillBody(markdown: string): string {
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  return (frontmatter ? markdown.slice(frontmatter[0].length) : markdown).trim();
}

/** Built-in playbooks. A repo can override any of them with `.foundry/playbook[.<name>].md`. */
export const BUILTIN_PLAYBOOKS: Record<string, string> = {
  default: defaultPlaybook,
  bugfix: `${defaultPlaybook}\n${bugfix}`,
  feature: `${defaultPlaybook}\n${feature}`,
  onboarding,
};

export interface RepoPlaybookFiles {
  /** `.foundry/playbook.md` replaces the default playbook. */
  playbook?: string;
  /** `.foundry/playbook.<name>.md` for named playbooks and `.foundry/playbook.<harness>.md` notes. */
  named?: Record<string, string>;
  /** `.foundry/skills/*.md`: repo knowledge appended to the system prompt. */
  skills?: { name: string; content: string }[];
}

export interface PromptJob {
  kind: "ticket" | "onboarding";
  title: string;
  body: string;
  issueNumber: number | null;
  repoFullName: string;
  playbook: string;
  harness: string;
  author: string | null;
  branch: string;
}

export interface AssembleInput {
  job: PromptJob;
  repo?: RepoPlaybookFiles;
  /** Present on portable resume: the agent starts fresh from the last checkpoint. */
  brief?: HandoffBrief | null;
  inputs?: PendingInput[];
  resumeStage?: string;
}

export function basePlaybook(job: Pick<PromptJob, "kind" | "playbook">, repo?: RepoPlaybookFiles): string {
  if (job.kind === "onboarding") return BUILTIN_PLAYBOOKS.onboarding!;
  const named = repo?.named?.[job.playbook];
  if (named) return named;
  if (job.playbook === "default" && repo?.playbook) return repo.playbook;
  return BUILTIN_PLAYBOOKS[job.playbook] ?? repo?.playbook ?? BUILTIN_PLAYBOOKS.default!;
}

export interface ReviewPromptInput {
  repoFullName: string;
  title: string;
  body: string;
  issueNumber: number | null;
  branch: string;
  defaultBranch: string;
  plan: string | null;
  summary: string | null;
  /** Present for the post-PR review: the open pull request being reviewed. */
  pullRequest?: { number: number; url: string; headSha: string };
  /** Failed checks for the PR head, when the review was triggered by CI. */
  ciFailures?: CiFailure[];
}

/**
 * The independent reviewer is a separate harness session with no context from the implementer.
 * It gets the ticket, the plan and a clean checkout of the branch, and reports through `review`.
 */
export function assembleReviewPrompt(
  input: ReviewPromptInput,
  repo?: RepoPlaybookFiles,
): {
  systemPrompt: string;
  prompt: string;
} {
  // The merge-risk rubric drives the `risk` field every review must report. Embed it here as well
  // as installing it into the repo so a review works even for repos onboarded before the skill
  // existed.
  const parts = [reviewer, `## Skill: merge-risk\n\n${skillBody(mergeRiskSkill)}`];
  for (const skill of repo?.skills ?? []) {
    parts.push(`## Repo knowledge: ${skill.name}\n\n${skill.content.trim()}`);
  }
  const lines = [
    `# Code review for ${input.repoFullName}`,
    "",
    `Review branch \`${input.branch}\` against \`origin/${input.defaultBranch}\`.`,
    "",
    input.issueNumber ? `## Ticket #${input.issueNumber}: ${input.title}` : `## Ticket: ${input.title}`,
    "",
    input.body.trim() || "_The ticket has no description._",
  ];
  if (input.plan) lines.push("", "## The implementer's plan", "", input.plan.trim());
  if (input.summary) lines.push("", "## The implementer's summary", "", input.summary.trim());
  if (input.pullRequest) {
    lines.push(
      "",
      "## Pull request",
      "",
      `#${input.pullRequest.number}: ${input.pullRequest.url}`,
      `Head commit: \`${input.pullRequest.headSha}\``,
      "",
      "This review runs after the pull request's CI checks finished. Review the change as usual. If a",
      "check failed, use the details below to find the cause and report a blocking finding with the",
      "concrete fix. Foundry records your verdict and posts it to GitHub as the review.",
    );
    const failures = input.ciFailures ?? [];
    lines.push("", "## Failed CI checks", "");
    if (failures.length === 0) {
      lines.push("No failed checks were reported.");
    } else {
      for (const failure of failures) {
        lines.push(`### ${failure.name} (${failure.conclusion})`, "");
        if (failure.summary) lines.push(failure.summary.trim(), "");
        if (failure.detailsUrl) lines.push(`Details: ${failure.detailsUrl}`, "");
        for (const a of failure.annotations.slice(0, 20)) {
          lines.push(`- \`${a.path}${a.line ? `:${a.line}` : ""}\`: ${a.message}`);
        }
        if (failure.annotations.length) lines.push("");
      }
    }
  }
  return { systemPrompt: parts.join("\n\n"), prompt: lines.join("\n") };
}

export function renderInputs(inputs: PendingInput[]): string {
  return inputs
    .map((i) =>
      i.kind === "answer"
        ? `@${i.by} answered your question${i.questionPrompt ? ` "${i.questionPrompt}"` : ""}: ${i.text}`
        : `Message from @${i.by}: ${i.text}`,
    )
    .join("\n\n");
}

/** System prompt (playbook + repo skills + harness notes) and the first user message. */
export function assemblePrompt(input: AssembleInput): { systemPrompt: string; prompt: string } {
  const { job, repo } = input;
  const parts = [basePlaybook(job, repo)];
  const harnessNotes = repo?.named?.[job.harness];
  if (harnessNotes) parts.push(`## Notes for ${job.harness}\n\n${harnessNotes}`);
  for (const skill of repo?.skills ?? [])
    parts.push(`## Repo knowledge: ${skill.name}\n\n${skill.content.trim()}`);
  const systemPrompt = parts.join("\n\n");

  const lines: string[] = [];
  if (job.kind === "onboarding") {
    lines.push(`Set up Foundry for ${job.repoFullName}. You are on branch \`${job.branch}\`.`);
  } else {
    const sections = parseTicketSections(job.body);
    lines.push(
      `# Ticket${job.issueNumber ? ` #${job.issueNumber}` : ""}: ${job.title}`,
      "",
      `Repository: ${job.repoFullName} · branch \`${job.branch}\`${job.author ? ` · filed by @${job.author}` : ""}`,
      "",
      job.body.trim() || "_The ticket has no description._",
    );
    if (!sections.acceptanceCriteria) {
      lines.push(
        "",
        "_Note: the ticket has no explicit acceptance criteria. Decide in triage whether to ask._",
      );
    }
  }
  if (input.brief) {
    lines.push(
      "",
      "---",
      "",
      "This job was started earlier on another machine and is resuming from its last checkpoint. The branch",
      "already contains the earlier work. Here is the handoff brief:",
      "",
      renderBrief(input.brief),
      "",
      `Continue from the **${input.resumeStage ?? input.brief.stageReached}** stage. Do not redo finished stages.`,
    );
  } else if (input.resumeStage && input.resumeStage !== "triage") {
    lines.push("", `Start at the **${input.resumeStage}** stage; earlier stages are done.`);
  }
  if (input.inputs?.length) lines.push("", "---", "", renderInputs(input.inputs));
  return { systemPrompt, prompt: lines.join("\n") };
}

/** The message sent when resuming a parked session in place (sticky resume). */
export function resumeMessage(inputs: PendingInput[], resumeStage: string): string {
  const body = inputs.length ? renderInputs(inputs) : "You were paused. Continue where you left off.";
  return `${body}\n\nContinue with the playbook from the ${resumeStage} stage.`;
}

export const NUDGE_MESSAGE =
  "You stopped before finishing. Continue with the playbook. If you are waiting on a decision, call `ask`. " +
  "When verification passes, call `confidence` and then `stage(done)`.";

export function verifyFailedMessage(
  failures: { name: string; command: string; outputTail: string }[],
  loop: number,
  max: number,
): string {
  const details = failures
    .map((f) => `### ${f.name} (\`${f.command}\`)\n\n\`\`\`\n${f.outputTail.slice(-4000)}\n\`\`\``)
    .join("\n\n");
  return `The runner ran the recipe checks and these failed (verify loop ${loop} of ${max}):\n\n${details}\n\nFix them, call \`run_checks\` until they pass, then \`confidence\` and \`stage(done)\`.`;
}
