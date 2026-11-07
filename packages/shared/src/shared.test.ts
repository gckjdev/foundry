import { describe, expect, it } from "vitest";
import { HeartbeatResponseSchema } from "./api";
import { parseBrief, renderBrief } from "./brief";
import {
  findMarker,
  parseCheckedOption,
  parseFoundryCommand,
  parseReplyAnswer,
  renderAnsweredQuestion,
  renderQuestionComment,
} from "./comments";
import { parseUnifiedDiff } from "./diff";
import { parsePolicyYaml } from "./policy";
import { expandRecipeVars, parseRecipeYaml } from "./recipe";
import { isUiChange, matchRiskRules, splitReviewers } from "./risk";
import { assertTransition, canTransition, stageLabel } from "./states";
import { jobBranchName, missingTicketSections, parseLabels, parseTicketSections } from "./ticket";
import { signToken, verifyToken } from "./tokens";

const DIFF = `diff --git a/src/app/page.tsx b/src/app/page.tsx
--- a/src/app/page.tsx
+++ b/src/app/page.tsx
@@ -1,2 +1,3 @@
-old
+new
+const key = process.env.SECRET;
diff --git a/db/migrations/002.sql b/db/migrations/002.sql
--- /dev/null
+++ b/db/migrations/002.sql
@@ -0,0 +1 @@
+create table x ();
`;

describe("state machine", () => {
  it("allows the playbook path and rejects skips", () => {
    expect(canTransition("queued", "triage")).toBe(true);
    expect(canTransition("verifying", "implementing")).toBe(true);
    expect(canTransition("triage", "merged")).toBe(false);
    expect(() => assertTransition("merged", "queued")).toThrow();
  });
  it("labels stages", () => expect(stageLabel("waiting_on_you")).toBe("foundry:waiting-on-you"));
});

describe("diff and risk rules", () => {
  const diff = parseUnifiedDiff(DIFF);
  it("parses files and counts", () => {
    expect(diff.files.map((f) => f.path)).toEqual(["src/app/page.tsx", "db/migrations/002.sql"]);
    expect(diff.changedLines).toBe(4);
  });
  it("matches path and regex rules", () => {
    const policy = parsePolicyYaml(`
risk_rules:
  - name: database schema
    paths: ["**/migrations/**"]
    reviewers: ["@acme/backend-leads"]
  - name: secrets and env
    diff_regex: "process\\\\.env\\\\."
    reviewers: ["@alice"]
  - name: auth
    paths: ["src/auth/**"]
`);
    const m = matchRiskRules(diff, policy.risk_rules);
    expect(m.map((x) => x.rule)).toEqual(["database schema", "secrets and env"]);
    expect(splitReviewers(m.flatMap((x) => x.reviewers))).toEqual({
      users: ["alice"],
      teams: ["backend-leads"],
    });
  });
  it("detects UI changes", () => {
    expect(isUiChange(diff, parseRecipeYaml("{}").ui_paths)).toBe(true);
  });
});

describe("recipe", () => {
  it("parses the spec example and expands vars", () => {
    const r = parseRecipeYaml(`
install: bun install --frozen-lockfile
checks:
  - name: lint
    run: bun run lint
dev_server:
  run: bun run dev --port $FOUNDRY_PORT
services:
  postgres: { database: "app_$FOUNDRY_JOB_ID" }
system_deps: [playwright-chromium]
`);
    expect(r.checks[0]).toEqual({ name: "lint", run: "bun run lint", timeout_sec: 900 });
    expect(expandRecipeVars(r.dev_server!.run, { FOUNDRY_PORT: "41000" })).toBe("bun run dev --port 41000");
  });
});

describe("questions", () => {
  const q = { id: "q1", mention: "alice", prompt: "Which scope?", options: ["Polish", "Layout", "Redesign"] };
  it("round-trips a ticked checkbox", () => {
    const body = renderQuestionComment(q);
    expect(findMarker(body, "question")).toBe("q1");
    expect(parseCheckedOption(body)).toBeNull();
    expect(parseCheckedOption(body.replace("- [ ] B.", "- [x] B."))).toBe(1);
  });
  it("parses replies", () => {
    expect(parseReplyAnswer("A", q.options)).toEqual({ optionIndex: 0, text: "Polish" });
    expect(parseReplyAnswer("option c please", q.options)).toEqual({ optionIndex: 2, text: "Redesign" });
    expect(parseReplyAnswer("Actually do both A and B", q.options).optionIndex).toBeNull();
  });
  it("renders the answered state", () => {
    const body = renderAnsweredQuestion(q, { text: "Polish", optionIndex: 0, by: "alice" });
    expect(body).toContain("- [x] A. Polish");
    expect(body).toContain("Answered: A. Polish by @alice");
  });
  it("parses /foundry commands", () => {
    expect(parseFoundryCommand("/foundry make the button blue")).toBe("make the button blue");
    expect(parseFoundryCommand("looks good")).toBeNull();
  });
});

describe("tickets", () => {
  it("parses override labels", () => {
    expect(parseLabels(["foundry", "harness:opencode", "model:openai/gpt-5.4", "runner:mini"])).toEqual({
      triggered: true,
      harness: "opencode",
      model: "openai/gpt-5.4",
      runner: "mini",
    });
  });
  it("parses issue form sections", () => {
    const body =
      "### Goal\n\nAdd favorites\n\n### Acceptance criteria\n\n- star button\n\n### Constraints\n\n_No response_";
    expect(parseTicketSections(body)).toEqual({ goal: "Add favorites", acceptanceCriteria: "- star button" });
    expect(missingTicketSections("make it nicer")).toEqual(["goal", "acceptanceCriteria"]);
  });
  it("builds branch names", () => {
    expect(jobBranchName("0123456789ab", "Mark recipes as Favorites!")).toBe(
      "foundry/01234567-mark-recipes-as-favorites",
    );
  });
});

describe("heartbeat response", () => {
  it("parses keepJobIds", () => {
    const res = HeartbeatResponseSchema.parse({
      realtimeUrl: "ws://x",
      realtimeToken: "t",
      draining: false,
      revokedJobIds: ["a"],
      keepJobIds: ["b"],
      repos: [],
    });
    expect(res.keepJobIds).toEqual(["b"]);
  });
});

describe("brief and tokens", () => {
  it("round-trips a brief", () => {
    const b = {
      version: 1 as const,
      jobId: "j1",
      title: "T",
      stageReached: "implementing",
      harness: "claude-code",
      sessionId: null,
      plan: "do it",
      findings: ["a"],
      checks: [{ name: "lint", status: "passed" }],
      qa: [{ question: "q", answer: "a" }],
      uncertainties: [],
      updatedAt: "2026-11-06T00:00:00Z",
    };
    expect(parseBrief(renderBrief(b))).toEqual(b);
  });
  it("signs and verifies tokens", () => {
    const t = signToken({ teamId: "t", exp: Math.floor(Date.now() / 1000) + 60 }, "s");
    expect(verifyToken(t, "s")?.exp).toBeGreaterThan(0);
    expect(verifyToken(t, "other")).toBeNull();
    expect(verifyToken(signToken({ exp: 1 }, "s"), "s")).toBeNull();
  });
});
