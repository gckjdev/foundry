import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const MergeModeSchema = z.enum(["off", "merge_when_confident"]);
export type MergeMode = z.infer<typeof MergeModeSchema>;

export const RiskRuleSchema = z
  .object({
    name: z.string().min(1),
    paths: z.array(z.string()).optional(),
    diff_regex: z.string().optional(),
    reviewers: z.array(z.string()).default([]),
  })
  .refine((r) => (r.paths?.length ?? 0) > 0 || !!r.diff_regex, {
    message: "a risk rule needs `paths` or `diff_regex`",
  });

export const PolicySchema = z.object({
  merge: MergeModeSchema.default("off"),
  require_ci_green: z.boolean().default(true),
  require_ai_review_clean: z.boolean().default(false),
  /** GitHub logins whose reviews count as the AI review (e.g. Bugbot). */
  ai_review_bots: z.array(z.string()).default(["cursor[bot]"]),
  max_verify_loops: z.number().int().min(0).default(3),
  /** How many times the independent reviewer may send a change back to implementing. */
  max_review_loops: z.number().int().min(0).default(2),
  max_cost_per_job_usd: z.number().positive().default(10),
  max_diff_lines_for_automerge: z.number().int().positive().default(400),
  max_job_minutes: z.number().int().positive().default(60),
  risk_rules: z.array(RiskRuleSchema).default([]),
  permissions: z
    .object({
      /** Shell commands the agent may never run (prefix match). */
      deny_commands: z.array(z.string()).default(["git push", "rm -rf /", "sudo"]),
      allow_web_fetch: z.boolean().default(true),
    })
    .default({ deny_commands: ["git push", "rm -rf /", "sudo"], allow_web_fetch: true }),
});

export type Policy = z.infer<typeof PolicySchema>;
export type RiskRule = z.infer<typeof RiskRuleSchema>;

export function parsePolicyYaml(text: string): Policy {
  return PolicySchema.parse(parseYaml(text) ?? {});
}

export const DEFAULT_POLICY: Policy = PolicySchema.parse({});

/** A job's own limit wins; otherwise the repo policy applies (60 minutes by default). */
export function effectiveMaxJobMinutes(
  override: number | null | undefined,
  policy: Pick<Policy, "max_job_minutes">,
): number {
  return override ?? policy.max_job_minutes;
}

/** A job's own cost cap wins; otherwise the repo policy applies ($10 by default). */
export function effectiveMaxCostUsd(
  override: number | null | undefined,
  policy: Pick<Policy, "max_cost_per_job_usd">,
): number {
  return override ?? policy.max_cost_per_job_usd;
}
