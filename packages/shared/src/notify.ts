export type NotifyEventType = "question_asked" | "handover" | "merged" | "failed";

export interface NotifyJob {
  id: string;
  title: string;
  repo: string;
  issueNumber: number | null;
  url: string;
  prUrl?: string | null;
}

export interface WebhookPayload {
  event: NotifyEventType;
  job: NotifyJob;
  detail: string;
  /** Ready-made one-liner for Slack incoming webhooks. */
  text: string;
  /** Same one-liner for Discord incoming webhooks. */
  content: string;
  sentAt: string;
}

const VERB: Record<NotifyEventType, string> = {
  question_asked: "needs an answer",
  handover: "is waiting on you",
  merged: "was merged",
  failed: "failed",
};

export function notificationLine(event: NotifyEventType, job: NotifyJob, detail: string): string {
  const ref = job.issueNumber ? `${job.repo}#${job.issueNumber}` : job.repo;
  return `Foundry: "${job.title}" (${ref}) ${VERB[event]}${detail ? ` — ${detail}` : ""}. ${job.url}`;
}

export function buildWebhookPayload(
  event: NotifyEventType,
  job: NotifyJob,
  detail: string,
  now = new Date(),
): WebhookPayload {
  const line = notificationLine(event, job, detail);
  return { event, job, detail, text: line, content: line, sentAt: now.toISOString() };
}
