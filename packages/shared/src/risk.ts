import picomatch from "picomatch";
import type { ParsedDiff } from "./diff";
import type { RiskRule } from "./policy";

export interface RiskMatch {
  rule: string;
  files: string[];
  reviewers: string[];
}

export function matchRiskRules(diff: ParsedDiff, rules: RiskRule[]): RiskMatch[] {
  const matches: RiskMatch[] = [];
  for (const rule of rules) {
    const isPathMatch = rule.paths?.length ? picomatch(rule.paths, { dot: true }) : null;
    const re = rule.diff_regex ? new RegExp(rule.diff_regex) : null;
    const files = diff.files
      .filter((f) => (isPathMatch?.(f.path) ?? false) || (re ? f.addedLines.some((l) => re.test(l)) : false))
      .map((f) => f.path);
    if (files.length > 0) matches.push({ rule: rule.name, files, reviewers: rule.reviewers });
  }
  return matches;
}

export function isUiChange(diff: ParsedDiff, uiPaths: string[]): boolean {
  if (uiPaths.length === 0) return false;
  const isMatch = picomatch(uiPaths, { dot: true });
  return diff.files.some((f) => isMatch(f.path));
}

/** Split reviewer handles into users and `org/team` slugs for the GitHub API. */
export function splitReviewers(handles: string[]): { users: string[]; teams: string[] } {
  const users = new Set<string>();
  const teams = new Set<string>();
  for (const h of handles) {
    const v = h.replace(/^@/, "");
    if (v.includes("/")) teams.add(v.split("/")[1]!);
    else users.add(v);
  }
  return { users: [...users], teams: [...teams] };
}
