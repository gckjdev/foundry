import { describe, expect, it } from "vitest";
import { assemblePrompt, basePlaybook, resumeMessage } from "./index";

const job = {
  kind: "ticket" as const,
  title: "Export CSV",
  body: "### Goal\n\nUsers export their invoices\n\n### Acceptance criteria\n\nA download button",
  issueNumber: 12,
  repoFullName: "acme/app",
  playbook: "default",
  harness: "claude-code",
  author: "alice",
  branch: "foundry/abcd1234-export-csv",
};

describe("assemblePrompt", () => {
  it("uses the built-in playbook and puts the ticket in the first message", () => {
    const { systemPrompt, prompt } = assemblePrompt({ job });
    expect(systemPrompt).toContain("# Foundry playbook");
    expect(systemPrompt).toContain("Asking instead of guessing");
    expect(prompt).toContain("# Ticket #12: Export CSV");
    expect(prompt).not.toContain("no explicit acceptance criteria");
  });

  it("applies repo overrides, harness notes and skills", () => {
    const { systemPrompt } = assemblePrompt({
      job: { ...job, playbook: "bugfix" },
      repo: {
        named: { "claude-code": "Use pnpm only." },
        skills: [{ name: "testing", content: "Run vitest with --run." }],
      },
    });
    expect(systemPrompt).toContain("## Bug fix notes");
    expect(systemPrompt).toContain("## Notes for claude-code\n\nUse pnpm only.");
    expect(systemPrompt).toContain("## Repo knowledge: testing");
    expect(basePlaybook({ kind: "ticket", playbook: "default" }, { playbook: "CUSTOM" })).toBe("CUSTOM");
  });

  it("starts a portable resume from the handoff brief with pending answers", () => {
    const { prompt } = assemblePrompt({
      job,
      brief: {
        version: 1,
        jobId: "j",
        title: "Export CSV",
        stageReached: "implementing",
        harness: "claude-code",
        sessionId: null,
        plan: "1. add button",
        findings: [],
        checks: [],
        qa: [{ question: "CSV or XLSX?", answer: "CSV" }],
        uncertainties: [],
        updatedAt: "2026-01-01T00:00:00Z",
      },
      resumeStage: "implementing",
      inputs: [{ kind: "message", text: "Use semicolons", by: "bob" }],
    });
    expect(prompt).toContain("resuming from its last checkpoint");
    expect(prompt).toContain("Continue from the **implementing** stage");
    expect(prompt).toContain("Message from @bob: Use semicolons");
  });

  it("renders the in-place resume message", () => {
    expect(
      resumeMessage(
        [{ kind: "answer", text: "CSV", by: "alice", questionPrompt: "Format?" }],
        "investigating",
      ),
    ).toBe(
      '@alice answered your question "Format?": CSV\n\nContinue with the playbook from the investigating stage.',
    );
  });
});
