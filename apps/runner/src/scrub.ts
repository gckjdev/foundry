const PATTERNS: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bfd[rj]_[A-Za-z0-9_.-]{16,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g,
  /(authorization:\s*(?:bearer|basic)\s+)[^\s"']+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/**
 * Remove credentials from anything that leaves the machine (event text, check output). Known
 * secret values (tokens, env values) are replaced exactly; common token shapes by pattern.
 */
export function scrub(text: string, known: Iterable<string> = []): string {
  let out = text;
  for (const value of known) {
    if (value && value.length >= 8) out = out.split(value).join("[redacted]");
  }
  for (const re of PATTERNS) {
    out = out.replace(re, (m, prefix?: string) =>
      typeof prefix === "string" && m.startsWith(prefix) ? `${prefix}[redacted]` : "[redacted]",
    );
  }
  return out;
}

/** Env var names whose values are always treated as secrets. */
export function secretEnvValues(env: Record<string, string | undefined>): string[] {
  return Object.entries(env)
    .filter(([k, v]) => v && /(TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|DATABASE_URL)/i.test(k))
    .map(([, v]) => v!);
}
