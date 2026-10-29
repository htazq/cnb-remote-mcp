import { inspect } from "node:util";

/**
 * Minimal structured JSON logger with secret redaction.
 *
 * Design goals:
 * - Never log credentials: any key matching SENSITIVE_KEY_RE is redacted.
 * - One JSON object per line on stdout/stderr for container log drivers.
 * - Zero dependencies.
 */

const SENSITIVE_KEY_RE =
  /token|secret|password|passwd|authorization|cookie|credential|api[-_]?key/i;

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[deep]";
  if (typeof value === "string") {
    // Defense in depth: mask raw bearer/basic credentials that slipped in.
    return value.replace(
      /(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
      (_m, scheme) => `${scheme} [redacted]`,
    );
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? "[redacted]" : redactValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function redact(value: unknown): unknown {
  return redactValue(value);
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bound: Record<string, unknown>): Logger;
}

export function createLogger(
  level: LogLevel = "info",
  bound: Record<string, unknown> = {},
): Logger {
  const threshold = LEVEL_WEIGHT[level];
  const emit = (
    sink: (line: string) => void,
    msgLevel: LogLevel,
    msg: string,
    fields?: Record<string, unknown>,
  ) => {
    if (LEVEL_WEIGHT[msgLevel] < threshold) return;
    const record = {
      ts: new Date().toISOString(),
      level: msgLevel,
      msg,
      ...(redact({ ...bound, ...(fields ?? {}) }) as Record<string, unknown>),
    };
    sink(JSON.stringify(record));
  };

  return {
    debug: (msg, fields) => emit((l) => process.stdout.write(l + "\n"), "debug", msg, fields),
    info: (msg, fields) => emit((l) => process.stdout.write(l + "\n"), "info", msg, fields),
    warn: (msg, fields) => emit((l) => process.stderr.write(l + "\n"), "warn", msg, fields),
    error: (msg, fields) => emit((l) => process.stderr.write(l + "\n"), "error", msg, fields),
    child: (extra) => {
      const merged = { ...bound, ...(redact(extra) as Record<string, unknown>) };
      return createLogger(level, merged);
    },
  };
}

/** Human-readable rendering for unexpected values (used in error paths only). */
export function brief(value: unknown, max = 300): string {
  const s = typeof value === "string" ? value : inspect(value, { depth: 2, breakLength: Infinity });
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
