import type { ControlContext } from "./context";
import { processPendingWebhooks } from "./ingest";
import { reconcileLabeledIssues } from "./jobs";
import { reconcileChangesRequestedReviews, reconcileOpenPullRequests } from "./merge-gate";
import { sendDigests, type Transports } from "./notify";
import { requeueLostJobs } from "./sweeper";

export const SWEEP_INTERVAL_MS = 30_000;

/**
 * In-process background loop for the web server: retries unprocessed webhooks, re-queues jobs from
 * lost runners every 30 s, and sends the daily digest once per day after `digestHour` local time.
 */
export function startWorker(ctx: ControlContext, transports: Transports, opts: { digestHour?: number } = {}) {
  let lastDigestDay = "";
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await processPendingWebhooks(ctx);
      const merged = await reconcileOpenPullRequests(ctx);
      if (merged.length) ctx.log.info("marked jobs merged from GitHub PRs", { jobs: merged });
      const reviewed = await reconcileChangesRequestedReviews(ctx);
      if (reviewed.length) ctx.log.info("re-queued jobs from changes-requested reviews", { jobs: reviewed });
      const tickets = await reconcileLabeledIssues(ctx);
      if (tickets.length) ctx.log.info("created jobs from labeled GitHub issues", { jobs: tickets });
      const requeued = await requeueLostJobs(ctx);
      if (requeued.length) ctx.log.info("re-queued jobs from offline runners", { jobs: requeued });
      const now = ctx.now();
      const day = now.toISOString().slice(0, 10);
      if (now.getHours() >= (opts.digestHour ?? 9) && day !== lastDigestDay) {
        lastDigestDay = day;
        await sendDigests(ctx, transports);
      }
    } catch (err) {
      ctx.log.error("worker tick failed", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, SWEEP_INTERVAL_MS);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}
