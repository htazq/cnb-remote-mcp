import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Boots the real compiled entrypoint (dist/http.js) exactly like production
 * does and asserts it listens and answers /healthz. Guards against the
 * entrypoint block being dropped from the module (it happened once — unit
 * tests kept passing because they import createApp directly).
 */

const PORT = 18410;
let dataDir = "";
let entrypointOutput = "";
let child: ReturnType<typeof spawn> | null = null;

beforeAll(async () => {
  // The suite boots dist/http.js, so the build cannot be assumed to exist
  // (fresh clone, CI). Compile here instead of ordering it before `npm test`.
  const build = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc"], {
    cwd: process.cwd(),
    stdio: "ignore",
  });
  if (build.status !== 0) {
    throw new Error(`npm run build failed (exit ${String(build.status)})`);
  }

  dataDir = await mkdtemp(path.join(tmpdir(), "mcp-entry-"));
  child = spawn("node", ["dist/http.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CNB_TOKEN: "entry-test-cnb-token",
      MCP_ACCESS_TOKENS: "entry-test-token",
      MCP_HTTP_PORT: String(PORT),
      MCP_HTTP_HOST: "127.0.0.1",
      MCP_DATA_DIR: dataDir,
      MCP_LOG_LEVEL: "error",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.on("data", (c: Buffer) => {
    if (!entrypointOutput) entrypointOutput = c.toString();
  });
  // Poll /healthz until the server is up (more robust than log parsing).
  const deadline = Date.now() + 10_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`entrypoint did not become ready: ${String(lastError)} ${entrypointOutput}`);
});

afterAll(async () => {
  child?.kill();
  await rm(dataDir, { recursive: true, force: true });
});

describe("compiled entrypoint", () => {
  it("serves /healthz without auth", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; version: string };
    expect(body.status).toBe("ok");
  });

  it("rejects unauthenticated /mcp calls (fail closed)", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});
