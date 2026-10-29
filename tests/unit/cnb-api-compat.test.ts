import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../src/tools/define.js";
import { repoBranchCreate } from "../../src/tools/repos.js";
import { buildStageLogs, formatStageLogPayload } from "../../src/tools/builds.js";

const repo = "example/project";
const buildArgs = {
  repo,
  sn: "cnb-abc-123",
  pipeline_id: "cnb-abc-123-001",
  stage_id: "stage-0",
};

describe("CNB create-branch response compatibility", () => {
  it("uses HEAD.name and accepts a 201 with an empty response body", async () => {
    const get = vi.fn(async () => ({ name: "develop", protected: false }));
    const post = vi.fn(async () => undefined);
    const ctx = { client: { get, post } } as unknown as ToolContext;
    const result = await repoBranchCreate.handler(
      { repo, name: "fix/branch", start_point: undefined }, ctx,
    );
    expect(get).toHaveBeenCalledWith("/example/project/-/git/head");
    expect(post).toHaveBeenCalledWith("/example/project/-/git/branches", {
      name: "fix/branch", start_point: "develop",
    });
    expect(JSON.stringify(result)).toContain("Branch fix/branch created");
    expect(JSON.stringify(result)).not.toContain("undefined");
  });

  it("uses explicit start_point without a HEAD lookup", async () => {
    const get = vi.fn();
    const post = vi.fn(async () => undefined);
    const ctx = { client: { get, post } } as unknown as ToolContext;
    const result = await repoBranchCreate.handler(
      { repo, name: "fix/other", start_point: "release" }, ctx,
    );
    expect(get).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith("/example/project/-/git/branches", {
      name: "fix/other", start_point: "release",
    });
    expect(JSON.stringify(result)).toContain("from release");
  });

  it("supports the legacy default_branch key", async () => {
    const get = vi.fn(async () => ({ default_branch: "master" }));
    const post = vi.fn(async () => undefined);
    const ctx = { client: { get, post } } as unknown as ToolContext;
    await repoBranchCreate.handler({ repo, name: "fix/legacy", start_point: undefined }, ctx);
    expect(post).toHaveBeenCalledWith("/example/project/-/git/branches", {
      name: "fix/legacy", start_point: "master",
    });
  });

  it("refuses missing or invalid upstream HEAD instead of guessing main", async () => {
    const get = vi.fn(async () => ({ name: "../invalid" }));
    const post = vi.fn(async () => undefined);
    const ctx = { client: { get, post } } as unknown as ToolContext;
    await expect(repoBranchCreate.handler(
      { repo, name: "fix/bad", start_point: undefined }, ctx,
    )).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
});

describe("CNB stage log parsing", () => {
  it("flattens content lines, preserving stage errors", () => {
    expect(formatStageLogPayload({
      duration: 100, content: ["command", "output"], error: "exit 1",
    })).toBe("command\noutput\nCNB stage error: exit 1");
  });

  it("accepts legacy plain-text logs and JSON-encoded envelopes", () => {
    expect(formatStageLogPayload("legacy log\nline")).toBe("legacy log\nline");
    expect(formatStageLogPayload('{"content":["a","b"],"duration":25}')).toBe("a\nb");
  });

  it("rejects missing, empty and malformed structured logs", () => {
    expect(() => formatStageLogPayload({})).toThrow(/without content/);
    expect(() => formatStageLogPayload({ content: [] })).toThrow(/without content/);
    expect(() => formatStageLogPayload({ content: [3] })).toThrow(/non-text/);
    expect(() => formatStageLogPayload(null)).toThrow(/Unexpected/);
    expect(() => formatStageLogPayload("{broken")).toThrow();
  });

  it("returns readable lines rather than an escaped JSON envelope", async () => {
    const get = vi.fn(async () => ({ duration: 22, content: ["hello", "world"] }));
    const ctx = { client: { get } } as unknown as ToolContext;
    const result = await buildStageLogs.handler(buildArgs, ctx);
    expect(get).toHaveBeenCalledWith(
      "/example/project/-/build/logs/stage/cnb-abc-123/cnb-abc-123-001/stage-0",
    );
    expect(result).toMatchObject({
      content: [{ type: "text", text: "hello\nworld" }],
      isError: false,
    });
  });

  it("does not silently return success on an empty stage log", async () => {
    const get = vi.fn(async () => ({}));
    const ctx = { client: { get } } as unknown as ToolContext;
    await expect(buildStageLogs.handler(buildArgs, ctx)).rejects.toThrow(/without content/);
  });

  it("truncates large logs before sending them to the LLM", async () => {
    const get = vi.fn(async () => ({ content: ["x".repeat(2000)] }));
    const ctx = { client: { get } } as unknown as ToolContext;
    const result = await buildStageLogs.handler({ ...buildArgs, max_chars: 1000 }, ctx);
    expect(JSON.stringify(result)).toContain("truncated");
  });
});