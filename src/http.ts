import type { Server } from "node:http";
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, assertHttpStartable, ConfigError, type AppConfig } from "./config.js";
import { buildServer } from "./server.js";
import { createLogger, type Logger } from "./util/logger.js";
import { verifyPatAccess } from "./auth/pat.js";
import { OwnerOAuth } from "./auth/oauth.js";
import type { AuthContext } from "./auth/types.js";
import {
  FileAuditSink,
  LogAuditSink,
  TeeAuditSink,
  newRequestId,
  type AuditSink,
} from "./security/audit.js";
import { VERSION, SERVER_NAME } from "./version.js";

/**
 * Remote MCP over Streamable HTTP (stateless JSON mode).
 *
 * - POST /mcp     — MCP JSON-RPC endpoint (Bearer auth required)
 * - GET  /healthz — liveness (no auth)
 * - GET  /readyz  — readiness: configuration valid + auth configured (no auth)
 *
 * Security model:
 * - Layer 1: every /mcp request must present a configured static key
 *   (constant-time digest compare) or a valid optional OAuth access token.
 * - Layer 2: upstream CNB calls use the shared `CNB_TOKEN` PAT. The server's
 *   authority is exactly that token's authority.
 * - MCP transport is stateless; each request has its own server+transport.
 *   Optional OAuth grants live in memory: use one replica and reconnect
 *   clients after restart.
 */

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 300;

interface RateBucket {
  count: number;
  resetAt: number;
}

export async function main(): Promise<void> {
  const config = loadConfig();
  assertHttpStartable(config);
  const { httpServer, log, auditSink } = createApp(config);
  installShutdownHandlers(httpServer, auditSink, log);
  log.info("cnb-remote-mcp listening", {
    host: config.httpHost,
    port: config.httpPort,
    version: VERSION,
    writeMode: config.writeMode,
    clientTokens: config.accessTokenList.length,
  });
}

/** Build the Express app (exported for integration tests). */
export function createApp(config: AppConfig): {
  app: express.Express;
  httpServer: Server;
  log: Logger;
  auditSink: AuditSink;
} {
  const log = createLogger(config.logLevel);
  // Audit goes to stdout logs always (stateless deployments) and to a file
  // when MCP_DATA_DIR is persistent (volume-mounted).
  const auditSink = new TeeAuditSink([
    new LogAuditSink(log),
    new FileAuditSink(config.dataDir + "/audit.log"),
  ]);

  const rateBuckets = new Map<string, RateBucket>();
  const oauth = config.oauth ? new OwnerOAuth(config) : undefined;

  const app = express();
  app.disable("x-powered-by");
  // Do not trust client-supplied X-Forwarded-For for authentication rate limits.
  app.set("trust proxy", false);
  app.use(express.json({ limit: "2mb" }));

  // ── request id + access log ─────────────────────────────────────────────
  app.use((req, res, next) => {
    const requestId = newRequestId();
    res.setHeader("x-request-id", requestId);
    const started = Date.now();
    res.on("finish", () => {
      log.info("http", {
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - started,
      });
    });
    next();
  });

  // ── DNS-rebinding protection: restrict Host header when configured ──────
  const allowedHosts = new Set<string>(["localhost", "127.0.0.1", "[::1]"]);
  if (config.publicBaseUrl) {
    try {
      allowedHosts.add(new URL(config.publicBaseUrl).hostname.toLowerCase());
    } catch {
      throw new ConfigError(`MCP_PUBLIC_BASE_URL is not a valid URL: ${config.publicBaseUrl}`);
    }
  }
  app.use((req, res, next) => {
    if (config.publicBaseUrl) {
      const host = (req.headers.host ?? "").split(":")[0]!.toLowerCase();
      if (!allowedHosts.has(host)) {
        res.status(403).json({ error: "forbidden host" });
        return;
      }
    }
    next();
  });

  if (oauth) app.use(oauth.router());

  // ── health probes (unauthenticated) ─────────────────────────────────────
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", name: SERVER_NAME, version: VERSION });
  });
  app.get("/readyz", (_req, res) => {
    const ok = config.accessTokenList.length > 0;
    res.status(ok ? 200 : 503).json({
      status: ok ? "ready" : "not-configured",
      writeMode: config.writeMode,
    });
  });

  // ── auth resolution ─────────────────────────────────────────────────────
  async function resolveAuth(req: Request): Promise<AuthContext | null> {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return null;
    const bearer = header.slice(7).trim();
    if (!bearer) return null;
    const result = verifyPatAccess(bearer, config.accessTokenList, config.cnbToken ?? "");
    if (result.ok) return result.ctx;
    if (oauth) {
      try {
        const info = await oauth.verifyAccessToken(bearer);
        return { actor: String(info.extra?.actor), mode: "oauth", cnbToken: config.cnbToken! };
      } catch {
        return null;
      }
    }
    return null;
  }

  // ── MCP endpoint ────────────────────────────────────────────────────────
  const mcpRateLimiter: RequestHandler = (req, res, next) => {
    const key = req.ip ?? "anonymous";
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      next();
      return;
    }
    bucket.count++;
    if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
      res.status(429).json({ error: "rate limit exceeded" });
      return;
    }
    next();
  };

  app.post("/mcp", mcpRateLimiter, async (req, res) => {
    const auth = await resolveAuth(req);
    if (!auth) {
      if (oauth)
        res.setHeader(
          "WWW-Authenticate",
          `Bearer resource_metadata="${config.publicBaseUrl}/.well-known/oauth-protected-resource/mcp", scope="cnb"`,
        );
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: missing or invalid bearer token" },
        id: null,
      });
      return;
    }

    const { server } = buildServer(config, auth, auditSink, log);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error("mcp request failed", { error: (err as Error).message });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", (_req, res) => {
    // Stateless mode: no server-initiated SSE stream to subscribe to.
    res.status(405).json({ error: "method not allowed; use POST" });
  });
  app.delete("/mcp", (_req, res) => {
    res.status(405).json({ error: "no sessions in stateless mode" });
  });

  // ── errors ──────────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    log.error("http error", { error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ error: "internal server error" });
    }
  });

  const httpServer = app.listen(config.httpPort, config.httpHost);
  return { app, httpServer, log, auditSink };
}

/** Register process-level shutdown handlers (production entry only). */
export function installShutdownHandlers(
  httpServer: Server,
  auditSink: AuditSink,
  log: Logger,
): void {
  const shutdown = (signal: string) => {
    log.info("shutting down", { signal });
    void auditSink.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    log.error("unhandled rejection", { error: String(reason) });
  });
}

if (process.argv[1]?.endsWith("http.js")) {
  main().catch((err) => {
    process.stderr.write(`fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
