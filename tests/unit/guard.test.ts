import { describe, expect, it } from "vitest";
import {
  parseGitRef,
  parseGroupPath,
  parseRepoPath,
  parseRepoSlug,
  truncateText,
} from "../../src/security/guard.js";

describe("parseRepoSlug", () => {
  it("accepts owner/repo", () => {
    expect(parseRepoSlug("cnb/cnb-mcp-server")).toBe("cnb/cnb-mcp-server");
  });
  it("accepts nested groups and normalizes .git suffix", () => {
    expect(parseRepoSlug("a/b/c/repo.git")).toBe("a/b/c/repo");
  });
  it("rejects traversal tricks", () => {
    for (const bad of ["..", "a/..", "a/../b", "../repo", "a//b", "/", "a", "repo", "a/.git"]) {
      expect(() => parseRepoSlug(bad)).toThrow();
    }
  });
  it("rejects segments starting with dash (option injection)", () => {
    expect(() => parseRepoSlug("-x/y")).toThrow();
    expect(() => parseRepoSlug("x/-y")).toThrow();
  });
});

describe("parseGroupPath", () => {
  it("accepts 1-2 segments", () => {
    expect(parseGroupPath("my-group")).toBe("my-group");
    expect(parseGroupPath("my-group/sub")).toBe("my-group/sub");
  });
  it("rejects empty and deep paths", () => {
    expect(() => parseGroupPath("")).toThrow();
    expect(() => parseGroupPath("a/b/c/d")).toThrow();
  });
});

describe("parseGitRef", () => {
  it("accepts normal refs", () => {
    expect(parseGitRef("main")).toBe("main");
    expect(parseGitRef("feature/x-1.2")).toBe("feature/x-1.2");
    expect(parseGitRef("1k5nb3ogn")).toBe("1k5nb3ogn");
  });
  it("rejects option injection and traversal", () => {
    for (const bad of ["-x", "--exec=sh", "a..b", "a/b..c", "", "ref.lock", "a//b"]) {
      expect(() => parseGitRef(bad)).toThrow();
    }
  });
});

describe("parseRepoPath", () => {
  it("normalizes simple paths", () => {
    expect(parseRepoPath("src/index.ts")).toBe("src/index.ts");
    expect(parseRepoPath("./src//a.ts")).toBe("src/a.ts");
  });
  it("rejects traversal and absolute paths", () => {
    for (const bad of [
      "../etc/passwd",
      "a/../../etc",
      "/etc/passwd",
      "C:/x",
      "~root/x",
      "a/b/..",
    ]) {
      expect(() => parseRepoPath(bad)).toThrow();
    }
  });
});

describe("truncateText", () => {
  it("keeps short text as-is", () => {
    expect(truncateText("hello", 10)).toEqual({ text: "hello", truncated: false });
  });
  it("truncates long text with notice", () => {
    const r = truncateText("x".repeat(100), 10);
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("[truncated 90 chars]");
  });
});
