export async function registerNode() {
  const { setDefaultResultOrder } = await import("node:dns");
  setDefaultResultOrder("ipv4first");
  const { installGithubFetchRetry } = await import("./server/retry-fetch");
  installGithubFetchRetry();
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (!process.env.DATABASE_URL || !process.env.FOUNDRY_SECRET) return;
  const { ensureWorker } = await import("./server/context");
  await ensureWorker();
}
