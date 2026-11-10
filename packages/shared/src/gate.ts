import type { MergeMode, Policy } from "./policy";
import type { RiskMatch } from "./risk";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface GateInput {
  /** Effective merge mode for the repo (panel setting, falling back to policy.yaml). */
  mergeMode: MergeMode;
  policy: Policy;
  /** Recipe check names that must have passing evidence. */
  requiredChecks: string[];
  evidence: { kind: string; name: string; status: "passed" | "failed" | "skipped" }[];
  uiChanged: boolean;
  ci: "success" | "failure" | "pending" | "none";
  aiReview: { present: boolean; blocking: boolean };
  /** The independent reviewer that runs before verifying (spec: reviewing stage). */
  codeReview: { present: boolean; blocking: boolean };
  riskMatches: RiskMatch[];
  changedLines: number;
  confidence: { level: ConfidenceLevel; uncertainties: string[] } | null;
  costUsd: number;
  /** Effective per-job cost cap; falls back to `policy.max_cost_per_job_usd` when absent. */
  maxCostUsd?: number;
}

export type GateRuleId =
  | "merge_mode"
  | "checks"
  | "screenshot"
  | "ci"
  | "ai_review"
  | "code_review"
  | "risk_rules"
  | "diff_size"
  | "confidence"
  | "cost";

export interface GateFailure {
  rule: GateRuleId;
  detail: string;
}

export interface GateResult {
  pass: boolean;
  /** Still waiting on something external (CI or AI review) — re-evaluate later. */
  pending: boolean;
  failed: GateFailure[];
  /** Reviewers to request when handing over because of risk rules. */
  reviewers: string[];
}

/**
 * The confidence gate (spec 5.5). Every rule must hold for auto-merge; the agent's own
 * confidence can only lower trust, never override a failed rule.
 */
export function evaluateGate(input: GateInput): GateResult {
  const failed: GateFailure[] = [];
  let pending = false;
  const { policy } = input;

  if (input.mergeMode !== "merge_when_confident") {
    failed.push({ rule: "merge_mode", detail: "Auto-merge is off for this repo" });
  }

  const checkEvidence = input.evidence.filter((e) => e.kind === "check");
  const missingOrFailed = input.requiredChecks.filter(
    (name) => !checkEvidence.some((e) => e.name === name && e.status === "passed"),
  );
  if (input.requiredChecks.length === 0) {
    failed.push({ rule: "checks", detail: "The recipe defines no checks, so nothing was verified" });
  } else if (missingOrFailed.length > 0) {
    failed.push({ rule: "checks", detail: `Checks without passing evidence: ${missingOrFailed.join(", ")}` });
  }

  if (input.uiChanged) {
    const shot = input.evidence.some((e) => e.kind === "screenshot" && e.status === "passed");
    if (!shot) failed.push({ rule: "screenshot", detail: "UI files changed but no screenshot was captured" });
  }

  if (policy.require_ci_green) {
    if (input.ci === "pending") pending = true;
    else if (input.ci === "failure") failed.push({ rule: "ci", detail: "CI failed" });
  }

  if (policy.require_ai_review_clean) {
    if (!input.aiReview.present) pending = true;
    else if (input.aiReview.blocking) {
      failed.push({ rule: "ai_review", detail: "AI review has unresolved blocking comments" });
    }
  }

  if (!input.codeReview.present) {
    failed.push({ rule: "code_review", detail: "No independent code review evidence" });
  } else if (input.codeReview.blocking) {
    failed.push({ rule: "code_review", detail: "The independent review requested changes" });
  }

  for (const m of input.riskMatches) {
    failed.push({ rule: "risk_rules", detail: `Risk rule hit: ${m.rule} (${m.files.length} files)` });
  }

  if (input.changedLines > policy.max_diff_lines_for_automerge) {
    failed.push({
      rule: "diff_size",
      detail: `Diff is ${input.changedLines} lines (limit ${policy.max_diff_lines_for_automerge})`,
    });
  }

  if (!input.confidence) {
    failed.push({ rule: "confidence", detail: "The agent did not report its confidence" });
  } else if (input.confidence.level !== "high" || input.confidence.uncertainties.length > 0) {
    const open = input.confidence.uncertainties.length;
    failed.push({
      rule: "confidence",
      detail: `Agent confidence is ${input.confidence.level}${open ? ` with ${open} open uncertainties` : ""}`,
    });
  }

  const maxCostUsd = input.maxCostUsd ?? policy.max_cost_per_job_usd;
  if (input.costUsd > maxCostUsd) {
    failed.push({
      rule: "cost",
      detail: `Job cost $${input.costUsd.toFixed(2)} exceeds $${maxCostUsd}`,
    });
  }

  const reviewers = [...new Set(input.riskMatches.flatMap((m) => m.reviewers))];
  // A hard failure decides the outcome even if CI is still running.
  const pass = failed.length === 0 && !pending;
  return { pass, pending: pending && failed.length === 0, failed, reviewers };
}
