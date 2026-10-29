import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/http.js";
import { loadConfig } from "../../src/config.js";

const origin = "https://mcp.example.com";
const redirect = "https://chatgpt.com/connector/oauth/test-callback";
const owner = "owner-test-key-".padEnd(64, "x");
const secret = "client-test-secret-".padEnd(64, "x");
const verifier = "v".repeat(64);
const challenge = createHash("sha256").update(verifier).digest("base64url");
let base = "";
let close: () => Promise<void>;

beforeAll(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cnb-oauth-test-"));
  const config = loadConfig({
    CNB_TOKEN: "mock-upstream-token",
    MCP_ACCESS_TOKENS: owner,
    MCP_PUBLIC_BASE_URL: origin,
    MCP_OAUTH_CLIENT_ID: "chatgpt",
    MCP_OAUTH_CLIENT_SECRET: secret,
    MCP_OAUTH_REDIRECT_URIS: redirect,
    MCP_HTTP_HOST: "127.0.0.1",
    MCP_HTTP_PORT: "0",
    MCP_DATA_DIR: dir,
    MCP_LOG_LEVEL: "error",
  });
  const { httpServer, auditSink, app } = createApp(config);
  // All integration requests come directly from localhost.
  app.set("trust proxy", false);
  await new Promise<void>((resolve) => httpServer.on("listening", resolve));
  base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  close = async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await auditSink.close();
    await rm(dir, { recursive: true, force: true });
  };
});
afterAll(async () => {
  vi.restoreAllMocks();
  await close();
});

async function begin(overrides: Record<string, string> = {}) {
  const query = new URLSearchParams({
    client_id: "chatgpt",
    redirect_uri: redirect,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "test-state",
    resource: `${origin}/mcp`,
    scope: "cnb",
    ...overrides,
  });
  const res = await fetch(`${base}/authorize?${query}`, { redirect: "manual" });
  const text = await res.text();
  return {
    res,
    text,
    ticket: /name="ticket" value="([a-f0-9]+)"/.exec(text)?.[1] ?? "",
    cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}
async function approve(
  flow: Awaited<ReturnType<typeof begin>>,
  password = owner,
  cookie = flow.cookie,
  reqOrigin = origin,
) {
  return fetch(`${base}/oauth/approve`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
      Origin: reqOrigin,
    },
    body: new URLSearchParams({ ticket: flow.ticket, password }),
  });
}
async function code() {
  const flow = await begin();
  const res = await approve(flow);
  expect(res.status).toBe(303);
  const target = new URL(res.headers.get("location")!);
  expect(target.searchParams.get("state")).toBe("test-state");
  return target.searchParams.get("code")!;
}
async function exchange(code: string, overrides: Record<string, string> = {}) {
  return fetch(`${base}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: "chatgpt",
      client_secret: secret,
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirect,
      resource: `${origin}/mcp`,
      ...overrides,
    }),
  });
}
async function mcp(token: string) {
  return fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

describe("single-owner OAuth over HTTP", () => {
  it("publishes discovery and challenges unauthenticated requests", async () => {
    const meta = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`).then((r) =>
      r.json(),
    );
    expect(meta.resource).toBe(`${origin}/mcp`);
    const as = await fetch(`${base}/.well-known/oauth-authorization-server`).then((r) => r.json());
    expect(as.code_challenge_methods_supported).toContain("S256");
    expect(as.registration_endpoint).toBeUndefined();
    const res = await mcp("wrong");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("oauth-protected-resource/mcp");
  });
  it("requires explicit owner consent with browser binding and exact origin", async () => {
    const flow = await begin();
    expect(flow.res.status).toBe(200);
    expect(flow.res.headers.get("set-cookie")).toContain("Secure");
    expect(flow.res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect((await approve(flow, "wrong")).status).toBe(401);
    expect((await approve(flow, owner, "")).status).toBe(400);
    expect((await approve(flow, owner, flow.cookie, "https://evil.example")).status).toBe(400);
    expect(flow.text).not.toContain(owner);
    expect(flow.text).not.toContain("mock-upstream-token");
  });
  it("rejects unregistered redirects, resources and scopes", async () => {
    const bad = await begin({ redirect_uri: "https://evil.example/callback" });
    expect(bad.res.status).toBe(400);
    expect(bad.res.headers.get("location")).toBeNull();
    for (const override of [{ resource: "https://evil.example/mcp" }, { scope: "admin" }]) {
      const res = await begin(override);
      expect(res.ticket).toBe("");
      expect(res.res.headers.get("location")).toContain("error=");
    }
  });
  it("rejects invalid client credentials, PKCE, redirect and audience, then allows a single exchange", async () => {
    const grant = await code();
    for (const override of [
      { client_secret: "wrong" },
      { code_verifier: "z".repeat(64) },
      { redirect_uri: "https://evil.example/callback" },
      { resource: "https://evil.example/mcp" },
    ]) {
      expect((await exchange(grant, override)).status).toBe(400);
    }
    const res = await exchange(grant);
    expect(res.status).toBe(200);
    const tokens = await res.json();
    const tools = await mcp(tokens.access_token);
    expect(tools.status).toBe(200);
    expect(JSON.stringify(await tools.json())).not.toContain("code_push_files");
    expect((await exchange(grant)).status).toBe(400);
  });
  it("rotates refresh tokens, revokes a grant family and preserves static bearer access", async () => {
    const tokens = await exchange(await code()).then((r) => r.json());
    const refresh = () =>
      fetch(`${base}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: "chatgpt",
          client_secret: secret,
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
          resource: `${origin}/mcp`,
        }),
      });
    const rotated = await refresh().then((r) => r.json());
    expect(rotated.access_token).toBeTruthy();
    expect((await refresh()).status).toBe(400);
    expect((await mcp(tokens.access_token)).status).toBe(401);
    expect((await mcp(rotated.access_token)).status).toBe(200);
    await fetch(`${base}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "chatgpt",
        client_secret: secret,
        token: rotated.refresh_token,
      }),
    });
    expect((await mcp(rotated.access_token)).status).toBe(401);
    expect((await mcp(owner)).status).toBe(200);
  });
  it("expires authorization codes and access tokens", async () => {
    const tokens = await exchange(await code()).then((r) => r.json());
    const grant = await code();
    const now = Date.now();
    const time = vi.spyOn(Date, "now").mockReturnValue(now + 3_601_000);
    try {
      expect((await exchange(grant)).status).toBe(400);
      expect((await mcp(tokens.access_token)).status).toBe(401);
    } finally {
      time.mockRestore();
    }
  });
});
