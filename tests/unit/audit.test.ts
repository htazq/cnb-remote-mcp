import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileAuditSink } from "../../src/security/audit.js";

describe("FileAuditSink", () => {
  it("writes redacted JSONL events", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mcp-audit-"));
    const file = path.join(dir, "audit.log");
    const sink = new FileAuditSink(file);
    try {
      await sink.write({
        ts: new Date().toISOString(),
        event: "tool_call",
        actor: "tok:abc",
        action: "repo_get",
        outcome: "ok",
        detail: { args: { repo: "a/b", token: "MUST-NOT-APPEAR" } },
      });
      await sink.close();
      const raw = await readFile(file, "utf8");
      expect(raw).toContain("repo_get");
      expect(raw).toContain("a/b");
      expect(raw).not.toContain("MUST-NOT-APPEAR");
      expect(raw).toContain("[redacted]");
      expect(raw.trim().split("\n")).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("never blocks the caller on write errors", async () => {
    const sink = new FileAuditSink("/proc/nonexistent/audit.log");
    // must resolve without throwing
    await expect(
      sink.write({
        ts: new Date().toISOString(),
        event: "tool_call",
        actor: "x",
        action: "y",
        outcome: "ok",
      }),
    ).resolves.toBeUndefined();
  });
});
