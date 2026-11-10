/**
 * Structured logging for the control plane, webhook worker, realtime and runner.
 *
 * One record per line: `{"ts","level","service","message",...fields}`. Fields carry the context
 * that makes a message actionable (job id, runner name, webhook delivery, duration, counts) so
 * operators can filter with `jq`/Loki instead of parsing prose. The full standard lives in
 * `docs/logging.md`.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFields = Record<string, unknown>;
export type LogFormat = "json" | "pretty";
export type LogSink = (line: string) => void;

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
/** Keys owned by the logger; a field with one of these names is dropped instead of spoofing it. */
const RESERVED = new Set(["ts", "level", "service", "message"]);

export interface Logger {
  readonly level: LogLevel;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that adds the given fields to every record (e.g. `{ jobId }`). */
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  /** Process that logs: `control`, `realtime`, `runner`, `proxy`, `test`. */
  service: string;
  /** Minimum level; defaults to `FOUNDRY_LOG_LEVEL`, then `info`. */
  level?: LogLevel;
  /** `json` (default) or `pretty`; defaults to `FOUNDRY_LOG_FORMAT`, then `json`. */
  format?: LogFormat;
  /** Fields added to every record. */
  fields?: LogFields;
  /** Where a rendered line goes. Defaults to stdout, one line per write. */
  sink?: LogSink;
  now?: () => Date;
  env?: Record<string, string | undefined>;
}

export function isLogLevel(value: string | undefined): value is LogLevel {
  return !!value && (LOG_LEVELS as readonly string[]).includes(value);
}

/** Read `FOUNDRY_LOG_LEVEL` (or any string) into a level, falling back to `info`. */
export function parseLogLevel(value: string | undefined, fallback: LogLevel = "info"): LogLevel {
  const normalized = value?.toLowerCase();
  return isLogLevel(normalized) ? normalized : fallback;
}

/** `{ error: "<message>" }` for any thrown value, so failures are greppable as a field. */
export function errorFields(error: unknown, key = "error"): LogFields {
  return { [key]: error instanceof Error ? error.message : String(error) };
}

function safeFields(...sources: (LogFields | undefined)[]): LogFields {
  const out: LogFields = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (!RESERVED.has(key) && value !== undefined) out[key] = value;
    }
  }
  return out;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return /\s/.test(value) ? JSON.stringify(value) : value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function renderPretty(
  ts: string,
  level: LogLevel,
  service: string,
  message: string,
  fields: LogFields,
): string {
  const pairs = Object.entries(fields)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(" ");
  return `${ts} ${level.toUpperCase().padEnd(5)} ${service} ${message.replace(/\n/g, "\\n")}${pairs ? ` ${pairs}` : ""}`;
}

function renderJson(
  ts: string,
  level: LogLevel,
  service: string,
  message: string,
  fields: LogFields,
): string {
  try {
    return JSON.stringify({ ts, level, service, message, ...fields });
  } catch {
    return JSON.stringify({ ts, level, service, message, fieldsError: "fields are not serializable" });
  }
}

export function createLogger(opts: LoggerOptions): Logger {
  const env = opts.env ?? process.env;
  const level = opts.level ?? parseLogLevel(env.FOUNDRY_LOG_LEVEL);
  const format = opts.format ?? (env.FOUNDRY_LOG_FORMAT === "pretty" ? "pretty" : "json");
  const sink = opts.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = opts.now ?? (() => new Date());
  const bound = safeFields(opts.fields);

  const write = (entryLevel: LogLevel, message: string, fields?: LogFields): void => {
    if (RANK[entryLevel] < RANK[level]) return;
    const all = safeFields(bound, fields);
    const ts = now().toISOString();
    const line =
      format === "json"
        ? renderJson(ts, entryLevel, opts.service, message, all)
        : renderPretty(ts, entryLevel, opts.service, message, all);
    sink(line);
  };

  return {
    level,
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
    child: (fields) =>
      createLogger({ ...opts, env, level, format, sink, now, fields: safeFields(bound, fields) }),
  };
}

/** A logger that writes nothing; for tests and dependency defaults. */
export const noopLogger: Logger = {
  level: "error",
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => noopLogger,
};
