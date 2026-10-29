import { describe, expect, it } from "vitest";
import { assertHttpStartable, ConfigError, loadConfig } from "../../src/config.js";

const BASE = {
  CNB_TOKEN: "cnb-token",
  MCP_ACCESS_TOKENS: "client-1,client-2",
} as Record<string, string>;

describe("loadConfig", () => {
  it("applies documented defaults", () => {
    const cfg = loadConfig({});
    expect(cfg.cnbApiBaseUrl).toBe("https://api.cnb.cool");
    expect(cfg.writeMode).toBe("read-only");
    expect(cfg.httpPort).toBe(3000);
    expect(cfg.gitWorkspaceRoot.endsWith("git-workspaces")).toBe(true);
  });

  it("parses access token lists", () => {
    const cfg = loadConfig({ ...BASE });
    expect(cfg.accessTokenList).toEqual(["client-1", "client-2"]);
  });
  it("accepts an empty optional public URL from the example env file", () => {
    expect(loadConfig({ MCP_PUBLIC_BASE_URL: "" }).publicBaseUrl).toBeUndefined();
  });
  it("fails closed for incomplete OAuth configuration", () => {
    expect(() => loadConfig({ ...BASE, MCP_OAUTH_CLIENT_ID: "chatgpt" })).toThrow(ConfigError);
  });

  it("rejects write mode without any upstream identity", () => {
    expect(() => loadConfig({ MCP_WRITE_MODE: "write" })).toThrow(ConfigError);
  });

  it("rejects invalid base URL", () => {
    expect(() => loadConfig({ CNB_API_BASE_URL: "not-a-url" })).toThrow(ConfigError);
  });
});

describe("assertHttpStartable", () => {
  it("fails closed without any client auth", () => {
    expect(() => assertHttpStartable(loadConfig({ CNB_TOKEN: "t" }))).toThrow(
      /Refusing to start HTTP transport/,
    );
  });
  it("passes with static tokens", () => {
    expect(() => assertHttpStartable(loadConfig(BASE))).not.toThrow();
  });
});
