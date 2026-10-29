import { z } from "zod";
import { defineTool, jsonResult, textResult, Fragments, type AnyTool } from "./define.js";
import { parseRepoSlug } from "../security/guard.js";
import { parseBuildSn } from "./builds.js";

/**
 * NPC (automated agent) tools.
 *
 * Dispatching follows the official `api_trigger_npc` spec:
 *   POST /{repo}/-/build/start
 *   { "event": "api_trigger_npc",
 *     "npc"?: { "name": "CodeBuddy", "workMode"?: bool },
 *     "env": { "role"?, "systemPrompt", "userPrompt" } }
 *
 * A successful response means the pipeline was ACCEPTED — it does NOT mean
 * the NPC finished the task. Always poll npc_status with the returned SN.
 */

const MAX_PROMPT = 30_000;

export const npcSearch = defineTool({
  name: "npc_search",
  meta: { group: "npc", title: "Search NPC characters" },
  description: "Search NPC (automated agent) characters available on CNB.",
  schema: {
    key: z.string().min(1).max(200).describe("Search keyword"),
    top_n: z.coerce.number().int().min(1).max(50).optional().describe("Max results"),
  },
  handler: async (args, ctx) => {
    return jsonResult(await ctx.client.get("/search/npc", { key: args.key, top_n: args.top_n }));
  },
});

export const npcDispatch = defineTool({
  name: "npc_dispatch",
  meta: { group: "npc", title: "Dispatch an NPC task", write: true },
  description:
    "Trigger an NPC pipeline task via the official api_trigger_npc event. Returns the build SN for tracking. Requires the repository .cnb.yml to define a pipeline for the api_trigger_npc event.",
  schema: {
    ...Fragments.repo,
    system_prompt: z
      .string()
      .min(1)
      .max(MAX_PROMPT)
      .describe("System prompt: how the NPC should behave and how it should report results back"),
    user_prompt: z.string().min(1).max(MAX_PROMPT).describe("Task description for the NPC"),
    role: z
      .string()
      .max(200)
      .optional()
      .describe("NPC role name defined in the repository .cnb/settings.yml npc.roles"),
    npc_name: z
      .enum(["CodeBuddy"])
      .optional()
      .describe('Dispatch as an NPC delegate; only "CodeBuddy" is supported by CNB'),
    work_mode: z
      .boolean()
      .optional()
      .describe(
        "Grant the NPC work-mode scope (git push / issue & PR writes). Default false (read-mostly).",
      ),
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    const env: Record<string, string> = {
      systemPrompt: args.system_prompt,
      userPrompt: args.user_prompt,
    };
    if (args.role) env.role = args.role;

    const body: Record<string, unknown> = { event: "api_trigger_npc", env };
    if (args.npc_name) {
      body.npc = {
        name: args.npc_name,
        ...(args.work_mode !== undefined ? { workMode: args.work_mode } : {}),
      };
    }

    const result = await ctx.client.post<{
      sn?: string;
      buildLogUrl?: string;
      success?: boolean;
      message?: string;
    }>(`/${repo}/-/build/start`, body);

    if (result.success === false) {
      return textResult(
        `NPC dispatch rejected by CNB. ${result.message ?? ""} Verify that .cnb.yml defines an api_trigger_npc pipeline on the target branch.`.trim(),
      );
    }
    return textResult(
      [
        "NPC task dispatched (accepted by CNB — this does NOT mean the task is finished).",
        result.sn ? `SN: ${result.sn}` : undefined,
        result.buildLogUrl ? `Log URL: ${result.buildLogUrl}` : undefined,
        result.sn ? "Track progress with npc_status using this SN." : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  },
});

export const npcStatus = defineTool({
  name: "npc_status",
  meta: { group: "npc", title: "Get NPC task status" },
  description:
    "Get the real status of a dispatched NPC task (build). Returns overall status, per-pipeline status and the NPC that triggered it. Use build_stage_logs for detailed logs.",
  schema: {
    ...Fragments.repo,
    sn: z.string().min(1).max(100).describe("Build SN from npc_dispatch"),
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    const sn = parseBuildSn(args.sn);
    const status = await ctx.client.get(`/${repo}/-/build/status/${sn}`);
    return jsonResult(status);
  },
});

export const npcActions = defineTool({
  name: "npc_actions",
  meta: { group: "npc", title: "List NPC activity" },
  description: "List recorded NPC actions (calls, pushes, PRs) in a repository.",
  schema: {
    ...Fragments.repo,
    npc_name: z.string().max(200).optional().describe("Filter by NPC name"),
    trigger_username: z.string().max(200).optional().describe("Filter by triggering user"),
    event: z.string().max(100).optional().describe("Filter by event type"),
    ...Fragments.page,
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    return jsonResult(
      await ctx.client.get(`/${repo}/-/npc-observability/actions`, {
        npc_name: args.npc_name,
        trigger_username: args.trigger_username,
        event: args.event,
        page: args.page,
        page_size: args.page_size,
      }),
    );
  },
});

export const npcTools: AnyTool[] = [npcSearch, npcDispatch, npcStatus, npcActions];
