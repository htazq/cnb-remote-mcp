import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { createLogger } from "./util/logger.js";
import { FileAuditSink, LogAuditSink, TeeAuditSink } from "./security/audit.js";
import type { AuthContext } from "./auth/types.js";
import { VERSION } from "./version.js";

/**
 * STDIO transport entry point (`cnb-remote-mcp`).
 *
 * Single-user local mode: the MCP client (IDE, Claude Desktop, Cursor…)
 * spawns this process; upstream CNB calls use CNB_TOKEN from the
 * environment. Never expose this process to a network.
 *
 * IMPORTANT: stdout is reserved for the MCP protocol — all logging goes to
 * stderr.
 */

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.logLevel);

  if (!config.cnbToken) {
    process.stderr.write(
      "fatal: CNB_TOKEN is required for stdio mode.\n" +
        "Create a personal access token on cnb.cool (Settings -> Access Tokens)\n" +
        "and export it before starting the server.\n",
    );
    process.exit(1);
  }

  const auth: AuthContext = { actor: "pat:stdio", mode: "pat", cnbToken: config.cnbToken };
  const audit = new TeeAuditSink([
    new LogAuditSink(log),
    new FileAuditSink(config.dataDir + "/audit.log"),
  ]);

  const { server, toolCount, writeMode } = buildServer(config, auth, audit, log);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info("cnb-remote-mcp stdio ready", {
    version: VERSION,
    tools: toolCount,
    writeMode,
  });

  const shutdown = (_signal: string) => {
    void audit.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    // Stdio mode must never die silently; log and keep serving.
    log.error("unhandled rejection", { error: String(reason) });
  });
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
