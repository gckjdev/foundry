export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  if (!process.env.DATABASE_URL || !process.env.FOUNDRY_SECRET) return;
  const { ensureWorker } = await import("./server/context");
  await ensureWorker();
}
