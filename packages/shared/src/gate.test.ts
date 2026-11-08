import { describe, expect, it } from "vitest";
import { evaluateGate, type GateInput } from "./gate";
import { DEFAULT_POLICY, PolicySchema } from "./policy";

const base = (): GateInput => ({
  mergeMode: "merge_when_confident",
  policy: PolicySchema.parse({ merge: "merge_when_confident" }),
  requiredChecks: ["lint", "test"],
  evidence: [
    { kind: "check", name: "lint", status: "passed" },
    { kind: "check", name: "test", status: "passed" },
  ],
  uiChanged: false,
  ci: "success",
  aiReview: { present: false, blocking: false },
  riskMatches: [],
  changedLines: 120,
  confidence: { level: "high", uncertainties: [] },
  costUsd: 0.4,
});

describe("evaluateGate", () => {
  it("passes when every rule holds", () => {
    const r = evaluateGate(base());
    expect(r).toEqual({ pass: true, pending: false, failed: [], reviewers: [] });
  });

  const cases: [string, (g: GateInput) => void, string][] = [
    ["merge mode off", (g) => (g.mergeMode = "off"), "merge_mode"],
    ["missing check evidence", (g) => g.evidence.pop(), "checks"],
    ["failed check", (g) => (g.evidence[0]!.status = "failed"), "checks"],
    ["no checks in recipe", (g) => (g.requiredChecks = []), "checks"],
    ["ui change without screenshot", (g) => (g.uiChanged = true), "screenshot"],
    ["ci failure", (g) => (g.ci = "failure"), "ci"],
    [
      "risk rule hit",
      (g) => (g.riskMatches = [{ rule: "schema", files: ["db/migrations/1.sql"], reviewers: ["@alice"] }]),
      "risk_rules",
    ],
    ["diff too large", (g) => (g.changedLines = 401), "diff_size"],
    ["medium confidence", (g) => (g.confidence = { level: "medium", uncertainties: [] }), "confidence"],
    ["open uncertainties", (g) => (g.confidence = { level: "high", uncertainties: ["?"] }), "confidence"],
    ["no confidence reported", (g) => (g.confidence = null), "confidence"],
    ["over budget", (g) => (g.costUsd = 11), "cost"],
  ];

  it.each(cases)("fails on %s", (_name, mutate, rule) => {
    const g = base();
    mutate(g);
    const r = evaluateGate(g);
    expect(r.pass).toBe(false);
    expect(r.failed.map((f) => f.rule)).toContain(rule);
  });

  it("uses a per-job cost cap when one is set", () => {
    const g = base();
    g.costUsd = 11;
    expect(evaluateGate({ ...g, maxCostUsd: 20 }).pass).toBe(true);
    expect(evaluateGate({ ...g, maxCostUsd: 5 }).failed.map((f) => f.rule)).toContain("cost");
  });

  it("is pending while CI runs and nothing else failed", () => {
    const g = base();
    g.ci = "pending";
    expect(evaluateGate(g)).toMatchObject({ pass: false, pending: true, failed: [] });
  });

  it("a hard failure is decided even while CI is pending", () => {
    const g = base();
    g.ci = "pending";
    g.confidence = { level: "low", uncertainties: [] };
    const r = evaluateGate(g);
    expect(r.pending).toBe(false);
    expect(r.failed[0]!.rule).toBe("confidence");
  });

  it("waits for the AI review when it is required", () => {
    const g = base();
    g.policy = PolicySchema.parse({ merge: "merge_when_confident", require_ai_review_clean: true });
    expect(evaluateGate(g).pending).toBe(true);
    g.aiReview = { present: true, blocking: true };
    expect(evaluateGate(g).failed.map((f) => f.rule)).toEqual(["ai_review"]);
  });

  it("collects reviewers from risk rules", () => {
    const g = base();
    g.riskMatches = [
      { rule: "a", files: ["x"], reviewers: ["@alice", "@acme/backend"] },
      { rule: "b", files: ["y"], reviewers: ["@alice"] },
    ];
    expect(evaluateGate(g).reviewers).toEqual(["@alice", "@acme/backend"]);
  });

  it("default policy has auto-merge off", () => {
    expect(DEFAULT_POLICY.merge).toBe("off");
  });
});
