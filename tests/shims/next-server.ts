const pending: Promise<unknown>[] = [];

/** Next `after()` — in tests, run the callback and keep the promise so the case can await it. */
export function after(fn: () => unknown): void {
  pending.push(Promise.resolve().then(fn));
}

export async function flushAfter(): Promise<void> {
  await Promise.all(pending.splice(0, pending.length));
}
