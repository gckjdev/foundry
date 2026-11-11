import { type JobStatus, STATUS_TITLES } from "@foundry/shared";

const TONE: Record<JobStatus, string> = {
  queued: "info",
  triage: "live",
  investigating: "live",
  implementing: "live",
  reviewing: "live",
  verifying: "live",
  needs_input: "warn",
  pr_ci: "info",
  pr_review: "live",
  waiting_on_you: "warn",
  merged: "ok",
  failed: "bad",
  cancelled: "",
};

export function StatusPill({ status }: { status: string }) {
  const s = status as JobStatus;
  return (
    <span className="pill" data-tone={TONE[s] ?? ""}>
      {STATUS_TITLES[s] ?? status}
    </span>
  );
}

export function ago(date: Date | string | null): string {
  if (!date) return "—";
  const s = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const usd = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `$${n.toFixed(2)}`;
export const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`;
