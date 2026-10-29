import { describe, expect, it } from "vitest";
import { createLogger, redact } from "../../src/util/logger.js";

describe("redact", () => {
  it("redacts sensitive keys recursively", () => {
    const input = {
      token: "super-secret",
      nested: { apiKey: "k", safe: 1 },
      list: [{ password: "p" }],
      Authorization: "Bearer x",
    };
    const out = redact(input) as Record<string, unknown>;
    expect(out.token).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).apiKey).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).safe).toBe(1);
    expect((out.list as unknown[])[0]).toEqual({ password: "[redacted]" });
    expect(out.Authorization).toBe("[redacted]");
  });

  it("masks bearer tokens embedded in strings", () => {
    const out = redact({ msg: "auth failed for Bearer abcdefghijklmno" }) as Record<
      string,
      unknown
    >;
    expect(out.msg).not.toContain("abcdefghijklmno");
    expect(out.msg).toContain("Bearer [redacted]");
  });
});

describe("createLogger", () => {
  it("emits valid JSON lines to stderr for warn/error", () => {
    const lines: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((s: string) => {
      lines.push(s);
      return true;
    }) as typeof process.stderr.write;
    const log = createLogger("warn");
    log.warn("test-warn", { token: "leak-me" });
    log.debug("should-not-appear");
    process.stderr.write = origWrite;
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]!);
    expect(rec.msg).toBe("test-warn");
    expect(rec.token).toBe("[redacted]");
  });

  it("child loggers inherit bound fields", () => {
    const lines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => {
      lines.push(s);
      return true;
    }) as typeof process.stdout.write;
    const log = createLogger("info", { actor: "pat:test" });
    log.info("hello");
    process.stdout.write = origWrite;
    expect(JSON.parse(lines[0]!).actor).toBe("pat:test");
  });
});
