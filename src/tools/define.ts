import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CnbClient, CnbApiError } from "../cnb/client.js";
import { describeCnbError } from "../cnb/client.js";
import type { AppConfig } from "../config.js";
import type { AuthContext } from "../auth/types.js";
import type { AuditSink } from "../security/audit.js";
import type { Logger } from "../util/logger.js";
import { redact } from "../util/logger.js";
import { truncateText } from "../security/guard.js";

/**
 * Tool definition framework.
 *
 * Each tool declares:
 * - a group (used for namespacing and docs),
 * - `write` when it mutates remote state (only registered in write mode),
 * - `destructive` when it additionally requires an explicit `confirm: true`.
 */

export type ToolGroup = "account" | "repo" | "issue" | "pr" | "build" | "npc" | "code";

export interface ToolMeta {
  group: ToolGroup;
  /** Tool title surfaced to MCP clients. */
  title: string;
  write?: boolean;
  destructive?: boolean;
}

export interface ToolContext {
  config: AppConfig;
  auth: AuthContext;
  client: CnbClient;
  audit: AuditSink;
  log: Logger;
}

export type ToolHandler<S extends z.ZodRawShape> = (
  args: z.infer<z.ZodObject<S>>,
  ctx: ToolContext,
) => Promise<CallToolResult | string>;

/** Erased tool type used for registries (avoids variance issues across shapes). */
export interface AnyTool {
  name: string;
  meta: ToolMeta;
  description: string;
  schema: z.ZodRawShape;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: true;
  };
  handler: (args: never, ctx: ToolContext) => Promise<CallToolResult | string>;
}

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  meta: ToolMeta;
  description: string;
  schema: S;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: true;
  };
  handler: ToolHandler<S>;
}

export function defineTool<S extends z.ZodRawShape>(params: {
  name: string;
  meta: ToolMeta;
  description: string;
  schema: S;
  handler: ToolHandler<S>;
}): ToolDef<S> {
  const readOnly = !params.meta.write;
  return {
    name: params.name,
    meta: params.meta,
    description: params.description,
    schema: params.schema,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: Boolean(params.meta.destructive),
      idempotentHint: readOnly,
      openWorldHint: true,
    },
    handler: params.handler,
  };
}

/** Common reusable parameter fragments. */
export const Fragments = {
  repo: {
    repo: z
      .string()
      .min(3)
      .max(200)
      .describe('Repository path, e.g. "owner/repo" or "group/subgroup/repo"'),
  },
  page: {
    page: z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .optional()
      .describe("Page number, starting at 1"),
    page_size: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Items per page (max 100)"),
  },
  confirm: {
    confirm: z
      .boolean()
      .optional()
      .describe(
        "Must be true to execute. Re-check the operation parameters carefully before confirming.",
      ),
  },
} as const;

/** Execute a handler with audit logging, confirmation gating and error mapping. */
export async function runTool(
  tool: AnyTool,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<CallToolResult> {
  const started = Date.now();
  try {
    const parsed = z.object(tool.schema).safeParse(rawArgs ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      await ctx.audit
        .write({
          ts: new Date().toISOString(),
          event: "tool_call",
          actor: ctx.auth.actor,
          action: tool.name,
          outcome: "denied",
          durationMs: Date.now() - started,
          detail: redact({ args: rawArgs, reason: "invalid-arguments" }) as Record<string, unknown>,
        })
        .catch(() => undefined);
      return errorResult(`Invalid arguments for ${tool.name}: ${issues}`);
    }

    if (tool.meta.destructive && parsed.data.confirm !== true) {
      await ctx.audit
        .write({
          ts: new Date().toISOString(),
          event: "tool_call",
          actor: ctx.auth.actor,
          action: tool.name,
          outcome: "denied",
          durationMs: Date.now() - started,
          detail: redact({ args: parsed.data, reason: "confirm-missing" }) as Record<
            string,
            unknown
          >,
        })
        .catch(() => undefined);
      return errorResult(
        `${tool.name} is a destructive operation. Review the parameters, then re-invoke with "confirm": true to proceed.`,
      );
    }

    const result = await (
      tool.handler as (a: unknown, c: ToolContext) => Promise<CallToolResult | string>
    )(parsed.data, ctx);
    const callResult: CallToolResult = typeof result === "string" ? textResult(result) : result;
    await ctx.audit.write({
      ts: new Date().toISOString(),
      event: "tool_call",
      actor: ctx.auth.actor,
      action: tool.name,
      outcome: "ok",
      durationMs: Date.now() - started,
      detail: redact({ args: parsed.data }) as Record<string, unknown>,
    });
    return callResult;
  } catch (err) {
    await ctx.audit
      .write({
        ts: new Date().toISOString(),
        event: "tool_call",
        actor: ctx.auth.actor,
        action: tool.name,
        outcome: "error",
        durationMs: Date.now() - started,
        detail: redact({ args: rawArgs, error: (err as Error)?.message }) as Record<
          string,
          unknown
        >,
      })
      .catch(() => undefined);
    const cnbErr = err as Partial<CnbApiError>;
    if (cnbErr?.status) {
      return errorResult(describeCnbError(err));
    }
    return errorResult(describeCnbError(err));
  }
}

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: false };
}

export function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** JSON result with size guard — prevents dumping unbounded payloads into the LLM context. */
export function jsonResult(value: unknown, maxChars = 60_000): CallToolResult {
  const { text, truncated } = truncateText(JSON.stringify(value, null, 2), maxChars);
  return textResult(truncated ? `${text}\n[output truncated]` : text);
}
