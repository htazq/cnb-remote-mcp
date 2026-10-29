import { describe, expect, it } from "vitest";
import { allTools, toolGroupsByMode, toolsForWriteMode } from "../../src/tools/index.js";
import { runTool, type ToolContext } from "../../src/tools/define.js";
import { loadConfig } from "../../src/config.js";
import { MemoryAuditSink } from "../../src/security/audit.js";
import type { AuthContext } from "../../src/auth/types.js";
import { createLogger } from "../../src/util/logger.js";
import { CnbClient } from "../../src/cnb/client.js";
import { defineTool } from "../../src/tools/define.js";
import { z } from "zod";

describe("tool registry", () => {
  const tools = allTools();

  it("has no duplicate tool names", () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("hides write tools in read-only mode", () => {
    const readOnly = toolsForWriteMode("read-only");
    const write = toolsForWriteMode("write");
    expect(readOnly.length).toBeGreaterThan(20);
    expect(write.length).toBe(tools.length);
    expect(readOnly.some((t) => t.meta.write)).toBe(false);
    expect(write.some((t) => t.name === "code_push_files")).toBe(true);
    expect(write.some((t) => t.name === "pr_merge")).toBe(true);
  });

  it("marks destructive tools correctly", () => {
    const destructive = tools.filter((t) => t.meta.destructive).map((t) => t.name);
    expect(destructive).toContain("pr_merge");
    expect(destructive).toContain("repo_branch_delete");
    expect(tools.find((t) => t.name === "whoami")!.meta.destructive).toBeFalsy();
  });

  it("groups tools by domain", () => {
    const groups = toolGroupsByMode("write");
    for (const g of ["account", "repo", "issue", "pr", "build", "npc", "code"]) {
      expect(Object.keys(groups)).toContain(g);
    }
  });
});

describe("destructive confirmation gating", () => {
  const config = loadConfig({ CNB_TOKEN: "cnb", MCP_ACCESS_TOKENS: "client" });
  const auth: AuthContext = { actor: "test", mode: "pat", cnbToken: "cnb" };
  const ctx: ToolContext = {
    config,
    auth,
    client: new CnbClient({ baseUrl: "http://127.0.0.1:1", token: "cnb" }),
    audit: new MemoryAuditSink(),
    log: createLogger("error"),
  };

  const destructive = defineTool({
    name: "fake_destructive",
    meta: { group: "repo", title: "Fake", write: true, destructive: true },
    description: "test",
    schema: { value: z.string(), confirm: z.boolean().optional() },
    handler: async (args) => `did:${args.value}`,
  });

  it("refuses without confirm=true", async () => {
    const result = await runTool(destructive, { value: "x" }, ctx);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("confirm");
  });

  it("executes with confirm=true", async () => {
    const result = await runTool(destructive, { value: "x", confirm: true }, ctx);
    expect(result.isError).toBe(false);
    expect(JSON.stringify(result)).toContain("did:x");
  });

  it("rejects invalid arguments with a clear error", async () => {
    const result = await runTool(destructive, { value: 42, confirm: true }, ctx);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("Invalid arguments");
  });

  it("audits denied and successful calls without leaking arguments", async () => {
    const sink = new MemoryAuditSink();
    const ctxA: ToolContext = { ...ctx, audit: sink };
    await runTool(destructive, { value: "abc", confirm: true }, ctxA);
    await runTool(destructive, { value: "abc" }, ctxA);
    const outcomes = sink.events.map((e) => e.outcome);
    expect(outcomes).toEqual(["ok", "denied"]);
    expect(JSON.stringify(sink.events)).not.toContain("cnb-token");
  });
});
