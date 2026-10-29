import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AuthContext } from "./auth/types.js";
import type { AppConfig } from "./config.js";
import { toolStats } from "./tools/index.js";
import { toolsForWriteMode } from "./tools/index.js";
import { runTool, type ToolContext } from "./tools/define.js";
import { CnbClient } from "./cnb/client.js";
import {
  FileAuditSink,
  LogAuditSink,
  MemoryAuditSink,
  TeeAuditSink,
  type AuditSink,
} from "./security/audit.js";
import { createLogger, type Logger } from "./util/logger.js";
import { VERSION } from "./version.js";

/**
 * Build a configured MCP server instance bound to one authentication context.
 *
 * In stateless HTTP mode a fresh instance is created per request, which keeps
 * per-user CNB credentials isolated between requests.
 */

export interface ServerHandle {
  server: McpServer;
  toolCount: number;
  writeMode: AppConfig["writeMode"];
}

export function buildServer(
  config: AppConfig,
  auth: AuthContext,
  audit: AuditSink,
  log: Logger = createLogger(config.logLevel),
): ServerHandle {
  const client = new CnbClient({ baseUrl: config.cnbApiBaseUrl, token: auth.cnbToken });
  const ctx: ToolContext = { config, auth, client, audit, log };

  const server = new McpServer(
    { name: "cnb-remote-mcp", version: VERSION },
    {
      instructions:
        "Unofficial remote MCP server for CNB.cool. Read-only by default; write tools appear only " +
        "when the deployment enables write mode. Destructive tools require an explicit confirm=true. " +
        "Build/NPC SNs returned by trigger tools must be polled via build_status / npc_status — " +
        "a successful trigger means accepted, not finished.",
    },
  );

  const tools = toolsForWriteMode(config.writeMode);
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.meta.title,
        description: tool.description,
        inputSchema: z.object(tool.schema),
        annotations: tool.annotations,
      },
      async (args: unknown): Promise<CallToolResult> => runTool(tool, args, ctx),
    );
  }

  const stats = toolStats(config.writeMode);
  log.debug("mcp server built", {
    actor: auth.actor,
    mode: auth.mode,
    writeMode: config.writeMode,
    tools: stats.enabled,
  });

  return { server, toolCount: stats.enabled, writeMode: config.writeMode };
}

/** Audit sink factory: file + stdout log in production, memory in tests. */
export function createAuditSink(config: AppConfig, useMemory: boolean): AuditSink {
  if (useMemory) return new MemoryAuditSink();
  return new TeeAuditSink([
    new LogAuditSink(createLogger(config.logLevel)),
    new FileAuditSink(config.dataDir + "/audit.log"),
  ]);
}
