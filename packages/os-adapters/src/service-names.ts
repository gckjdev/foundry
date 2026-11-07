/** launchd label / systemd instance segment. Empty or punctuation-only names become `runner`. */
export function serviceSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return slug || "runner";
}
