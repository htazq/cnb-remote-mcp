import { createHash, randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { mkdir, open, rename, stat } from "node:fs/promises";
import path from "node:path";
import { redact } from "../util/logger.js";

/**
 * Append-only audit log for tool calls.
 *
 * Records who called which tool with which (redacted) arguments and the
 * outcome. Sensitive values never reach the log: arguments pass through the
 * same redaction used by the logger, and tokens are only ever referenced by
 * a short SHA-256 fingerprint.
 *
 * Rotation: when the file exceeds maxBytes it is renamed to `<name>.1`.
 */

export interface AuditEvent {
  ts: string;
  event: "tool_call" | "auth" | "http" | "lifecycle";
  actor: string;
  action: string;
  outcome: "ok" | "error" | "denied";
  detail?: Record<string, unknown>;
  durationMs?: number;
  requestId?: string;
}

export interface AuditSink {
  write(event: AuditEvent): Promise<void>;
  close(): Promise<void>;
}

/** Emits audit events as structured log lines (stateless deployments). */
export class LogAuditSink implements AuditSink {
  constructor(private readonly log: { info(msg: string, fields?: unknown): void }) {}
  async write(event: AuditEvent): Promise<void> {
    this.log.info("audit", event as unknown as Record<string, unknown>);
  }
  async close(): Promise<void> {}
}

/** Fans out one event to several sinks; a failing sink never blocks others. */
export class TeeAuditSink implements AuditSink {
  constructor(private readonly sinks: AuditSink[]) {}
  async write(event: AuditEvent): Promise<void> {
    await Promise.allSettled(this.sinks.map((s) => s.write(event)));
  }
  async close(): Promise<void> {
    await Promise.allSettled(this.sinks.map((s) => s.close()));
  }
}

const MAX_LOG_BYTES = 50 * 1024 * 1024; // 50 MB per file

export class FileAuditSink implements AuditSink {
  private readonly filePath: string;
  private readonly maxBytes: number;
  private queue: Promise<void> = Promise.resolve();
  private handle: FileHandle | null = null;
  private written = 0;

  constructor(filePath: string, maxBytes = MAX_LOG_BYTES) {
    this.filePath = filePath;
    this.maxBytes = maxBytes;
  }

  async write(event: AuditEvent): Promise<void> {
    const line = `${JSON.stringify(redact(event))}\n`;
    this.queue = this.queue
      .then(() => this.append(line))
      .catch((err) => {
        // Audit failures must not break tool execution, but they must be visible.
        process.stderr.write(`audit-write-failed: ${(err as Error).message}\n`);
      });
    await this.queue;
  }

  private async append(line: string): Promise<void> {
    if (!this.handle) {
      try {
        this.handle = await open(this.filePath, "a");
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw err;
        // Parent directory missing: create it (time-boxed — never hang on
        // exotic filesystems), then retry once.
        const parent = path.dirname(this.filePath);
        await Promise.race([
          mkdir(parent, { recursive: true }),
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error(`audit: mkdir timed out for ${parent}`)), 2000),
          ),
        ]).catch((e) => {
          throw e instanceof Error ? e : new Error(String(e));
        });
        this.handle = await open(this.filePath, "a");
      }
      const s = await stat(this.filePath).catch(() => null);
      this.written = s?.size ?? 0;
    }
    if (this.written + line.length > this.maxBytes) await this.rotate();
    await this.handle.write(line);
    this.written += line.length;
  }

  private async rotate(): Promise<void> {
    await this.handle?.close();
    this.handle = null;
    await rename(this.filePath, `${this.filePath}.1`).catch(() => undefined);
  }

  async close(): Promise<void> {
    await this.queue;
    await this.handle?.close();
    this.handle = null;
  }
}

/** In-memory sink for tests. */
export class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];
  async write(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
  async close(): Promise<void> {}
}

/**
 * Stable, non-reversible actor identifier from a bearer token.
 * Never store or log the token itself.
 */
export async function actorFingerprint(token: string): Promise<string> {
  const hash = createHash("sha256").update(token).digest("hex");
  return `tok:${hash.slice(0, 12)}`;
}

export function newRequestId(): string {
  return randomUUID();
}
