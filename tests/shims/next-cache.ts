/** Vitest stand-in for Next's `next/cache`: cache invalidation is a request-scoped no-op in tests. */
export function revalidatePath(_path: string, _type?: "page" | "layout"): void {}
export function revalidateTag(_tag: string): void {}
export function updateTag(_tag: string): void {}
export function refresh(): void {}
