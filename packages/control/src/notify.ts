import { type Job, notifications, repos, teams, type User, users } from "@foundry/db";
import {
  buildWebhookPayload,
  errorFields,
  type NotifyEventType,
  type NotifyJob,
  notificationLine,
} from "@foundry/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { type ControlContext, jobUrl } from "./context";

export interface NotifyInput {
  event: NotifyEventType;
  job: Job;
  detail: string;
}

export interface Notifier {
  notify(ctx: ControlContext, input: NotifyInput): Promise<void>;
}

export interface Transports {
  sendEmail?(to: string, subject: string, text: string): Promise<void>;
  sendPush?(subscription: unknown, payload: string): Promise<void>;
  postWebhook?(url: string, body: unknown): Promise<void>;
}

/** Transports from SMTP_URL, VAPID_* and global fetch; channels without config are skipped. */
export async function defaultTransports(): Promise<Transports> {
  const t: Transports = {
    async postWebhook(url, body) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`webhook responded ${res.status}`);
    },
  };
  if (process.env.SMTP_URL) {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport(process.env.SMTP_URL);
    const from = process.env.EMAIL_FROM ?? "Foundry <foundry@localhost>";
    t.sendEmail = async (to, subject, text) => {
      await transport.sendMail({ from, to, subject, text });
    };
  }
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    const webpush = (await import("web-push")).default;
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? "mailto:foundry@localhost",
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
    t.sendPush = async (subscription, payload) => {
      await webpush.sendNotification(subscription as never, payload);
    };
  }
  return t;
}

const SUBJECT: Record<NotifyEventType, string> = {
  question_asked: "Foundry needs an answer",
  handover: "Foundry handed a PR to you",
  merged: "Foundry merged a PR",
  failed: "A Foundry job failed",
};

/** Who hears about an event: the person asked or routed to review, else the ticket author. */
async function recipients(ctx: ControlContext, input: NotifyInput): Promise<User[]> {
  const logins = new Set<string>();
  if (input.event === "handover")
    for (const r of (input.job.assignedReviewers as string[]) ?? []) logins.add(r.toLowerCase());
  if (input.job.authorLogin) logins.add(input.job.authorLogin.toLowerCase());
  if (logins.size === 0) return [];
  return ctx.db
    .select()
    .from(users)
    .where(inArray(users.ghLogin, [...logins]));
}

/**
 * Sends each event over the member's preferred channel. "github" means GitHub's own notification
 * (the mention or review request already happened), so nothing extra is sent.
 */
export class ChannelNotifier implements Notifier {
  constructor(private readonly transports: Transports) {}

  async notify(ctx: ControlContext, input: NotifyInput): Promise<void> {
    try {
      await this.deliver(ctx, input);
    } catch (err) {
      ctx.log.warn("notify failed", { event: input.event, jobId: input.job.id, ...errorFields(err) });
    }
  }

  private async deliver(ctx: ControlContext, input: NotifyInput) {
    const repo = await ctx.db.query.repos.findFirst({ where: eq(repos.id, input.job.repoId) });
    const team = await ctx.db.query.teams.findFirst({ where: eq(teams.id, input.job.teamId) });
    const nj: NotifyJob = {
      id: input.job.id,
      title: input.job.title,
      repo: repo?.fullName ?? "",
      issueNumber: input.job.issueNumber,
      url: jobUrl(ctx, input.job.id),
      prUrl: input.job.prUrl,
    };
    const line = notificationLine(input.event, nj, input.detail);

    if (team?.outgoingWebhookUrl && this.transports.postWebhook) {
      const url = team.outgoingWebhookUrl;
      await this.record(ctx, input, null, "webhook", () =>
        this.transports.postWebhook!(url, buildWebhookPayload(input.event, nj, input.detail, ctx.now())),
      );
    }
    for (const user of await recipients(ctx, input)) {
      switch (user.notifyPref) {
        case "email":
          if (user.email && this.transports.sendEmail) {
            const to = user.email;
            await this.record(ctx, input, user.id, "email", () =>
              this.transports.sendEmail!(to, SUBJECT[input.event], line),
            );
          }
          break;
        case "push":
          if (user.pushSubscription && this.transports.sendPush) {
            const sub = user.pushSubscription;
            const payload = JSON.stringify({ title: SUBJECT[input.event], body: line, url: nj.url });
            await this.record(ctx, input, user.id, "push", () => this.transports.sendPush!(sub, payload));
          }
          break;
        case "digest":
          await ctx.db.insert(notifications).values({
            teamId: input.job.teamId,
            userId: user.id,
            jobId: input.job.id,
            event: input.event,
            detail: line,
            channel: "digest",
          });
          break;
      }
    }
  }

  private async record(
    ctx: ControlContext,
    input: NotifyInput,
    userId: string | null,
    channel: string,
    send: () => Promise<void>,
  ) {
    let error: string | null = null;
    try {
      await send();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    await ctx.db.insert(notifications).values({
      teamId: input.job.teamId,
      userId,
      jobId: input.job.id,
      event: input.event,
      detail: input.detail,
      channel,
      sentAt: error ? null : ctx.now(),
      error,
    });
  }
}

/** Daily digest: one email per member with everything queued for them since the last digest. */
export async function sendDigests(ctx: ControlContext, transports: Transports): Promise<number> {
  if (!transports.sendEmail) return 0;
  const pending = await ctx.db
    .select({ n: notifications, user: users })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(and(eq(notifications.channel, "digest"), isNull(notifications.sentAt)));
  const byUser = new Map<string, { user: User; lines: string[]; ids: string[] }>();
  for (const { n, user } of pending) {
    if (!user.email) continue;
    const entry = byUser.get(user.id) ?? { user, lines: [], ids: [] };
    entry.lines.push(`- ${n.detail}`);
    entry.ids.push(n.id);
    byUser.set(user.id, entry);
  }
  for (const { user, lines, ids } of byUser.values()) {
    await transports.sendEmail(user.email!, `Foundry daily digest (${lines.length})`, lines.join("\n"));
    await ctx.db.update(notifications).set({ sentAt: ctx.now() }).where(inArray(notifications.id, ids));
  }
  return byUser.size;
}

/** Collects notifications in memory; used by tests. */
export class MemoryNotifier implements Notifier {
  readonly sent: NotifyInput[] = [];
  async notify(_ctx: ControlContext, input: NotifyInput) {
    this.sent.push(input);
  }
}
