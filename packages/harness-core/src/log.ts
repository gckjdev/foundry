import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const MAX_SECTION = 2_000_000;

export function clipHarnessLog(text: string, max = MAX_SECTION): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [truncated ${text.length - max} bytes]\n`;
}

/**
 * Append one labeled section to a job harness transcript. Used to dump every prompt sent to
 * the coding agent and every event/message that comes back.
 */
export function appendHarnessLog(
  file: string | undefined,
  section: string,
  body: string,
  redact: (text: string) => string = (s) => s,
): void {
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  const stamp = new Date().toISOString();
  appendFileSync(file, `\n===== ${stamp} ${section} =====\n${clipHarnessLog(redact(body))}\n`);
}

export function harnessLogJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === "string" ? clipHarnessLog(v, 100_000) : v), 2);
  } catch {
    return String(value);
  }
}
