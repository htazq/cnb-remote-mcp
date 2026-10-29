import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createApp } from "../../src/http.js";
import { loadConfig } from "../../src/config.js";

/**
 * Full-stack integration test: real Express app + real MCP transport, with a
 * mock CNB OpenAPI. This validates the MCP protocol path end to end without
 * touching the network (Mock PASS — real-API tests are executed separately).
 */

const CLIENT_TOKEN = "client-test-token";
const CNB_TOKEN = "cnb-mock-token";

let cnbMock: Server;
let appServer: Server;
let baseUrl = "";
let dataDir = "";

/** Minimal JSON-RPC response shape used by these tests. */
interface McpTestResponse {
  status: number;
  json: {
    result?: {
      serverInfo?: { name?: string; version?: string };
      tools?: { name: string }[];
      content?: { text?: string }[];
      isError?: boolean;
    };
    error?: { code?: number; message?: string };
  };
}

function mcp(headers: Record<string, string>, body: unknown): Promise<McpTestResponse> {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, json: await res.json() }));
}

beforeAll(async () => {
  // Mock CNB OpenAPI.
  cnbMock = createServer((req, res) => {
    const auth = req.headers.authorization;
    res.setHeader("Content-Type", "application/json");
    if (auth !== `Bearer ${CNB_TOKEN}`) {
      res.statusCode = 401;
      res.end(JSON.stringify({ errcode: 16, errmsg: "user is not logged in" }));
      return;
    }
    const url = req.url ?? "";
    if (url === "/user") {
      res.end(JSON.stringify({ id: "1", username: "alice", nickname: "Alice" }));
    } else if (url.startsWith("/mock/repo/-/git/branches")) {
      res.end(JSON.stringify([{ name: "main", commit: { sha: "abc123" } }]));
    } else if (url.startsWith("/mock/repo/-/build/status/")) {
      res.end(
        JSON.stringify({ status: "success", pipelinesStatus: { p1: { status: "success" } } }),
      );
    } else if (url === "/mock/repo") {
      res.end(JSON.stringify({ name: "repo", visibility_level: "Public" }));
    } else {
      res.statusCode = 500;
      res.end(JSON.stringify({ errcode: 999, errmsg: "boom" }));
    }
  });
  await new Promise<void>((resolve) => cnbMock.listen(0, "127.0.0.1", resolve));
  const cnbPort = (cnbMock.address() as AddressInfo).port;

  dataDir = await mkdtemp(path.join(tmpdir(), "mcp-it-"));
  const config = loadConfig({
    CNB_API_BASE_URL: `http://127.0.0.1:${cnbPort}`,
    CNB_TOKEN,
    MCP_ACCESS_TOKENS: CLIENT_TOKEN,
    MCP_WRITE_MODE: "read-only",
    MCP_DATA_DIR: dataDir,
    MCP_HTTP_PORT: "0",
    MCP_HTTP_HOST: "127.0.0.1",
    MCP_LOG_LEVEL: "error",
  });
  const { httpServer } = createApp(config);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  appServer = httpServer;
  const port = (httpServer.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => appServer.close(() => resolve()));
  await new Promise<void>((resolve) => cnbMock.close(() => resolve()));
  await rm(dataDir, { recursive: true, force: true });
});

describe("auth layer", () => {
  it("rejects requests without a bearer token", async () => {
    const res = await mcp({}, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe(-32001);
  });

  it("rejects an invalid bearer token", async () => {
    const res = await mcp(
      { Authorization: "Bearer wrong-token" },
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    );
    expect(res.status).toBe(401);
  });
});

describe("mcp protocol", () => {
  it("initializes and reports server info", async () => {
    const res = await mcp(
      { Authorization: `Bearer ${CLIENT_TOKEN}` },
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      },
    );
    expect(res.status).toBe(200);
    expect(res.json.result.serverInfo.name).toBe("cnb-remote-mcp");
  });

  it("lists read-only tools only", async () => {
    const res = await mcp(
      { Authorization: `Bearer ${CLIENT_TOKEN}` },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    );
    const names: string[] = res.json.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("whoami");
    expect(names).not.toContain("code_push_files");
    expect(names).not.toContain("pr_merge");
  });

  it("calls whoami through the mock CNB API", async () => {
    const res = await mcp(
      { Authorization: `Bearer ${CLIENT_TOKEN}` },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "whoami", arguments: {} } },
    );
    expect(res.json.result.isError).toBe(false);
    expect(res.json.result.content[0].text).toContain("alice");
  });

  it("maps upstream failures to tool errors without leaking the token", async () => {
    const res = await mcp(
      { Authorization: `Bearer ${CLIENT_TOKEN}` },
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "repo_branch_list", arguments: { repo: "mock/repo" } },
      },
    );
    // The branch path works against the mock; force the 500 path instead:
    const res2 = await mcp(
      { Authorization: `Bearer ${CLIENT_TOKEN}` },
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "pr_list", arguments: { repo: "mock/repo" } },
      },
    );
    expect(res2.json.result.isError).toBe(true);
    expect(res2.json.result.content[0].text).toContain("500");
    expect(JSON.stringify(res2.json)).not.toContain(CNB_TOKEN);
    expect(res.json.result.isError).toBe(false);
    expect(res.json.result.content[0].text).toContain("main");
  });

  it("rejects invalid tool arguments", async () => {
    const res = await mcp(
      { Authorization: `Bearer ${CLIENT_TOKEN}` },
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "repo_get", arguments: { repo: "../etc/passwd" } },
      },
    );
    expect(res.json.result.isError).toBe(true);
    expect(res.json.result.content[0].text).toContain("Invalid");
  });
});

describe("health endpoints", () => {
  it("exposes liveness and readiness without auth", async () => {
    const health = await fetch(`${baseUrl}/healthz`).then((r) => r.json());
    expect(health.status).toBe("ok");
    const ready = await fetch(`${baseUrl}/readyz`).then((r) => r.json());
    expect(ready.status).toBe("ready");
  });
});
