import { z } from "zod";
import { defineTool, jsonResult, textResult, Fragments, type AnyTool } from "./define.js";
import { parseRepoSlug, parseGitRef, truncateText } from "../security/guard.js";

/** CI/CD build tools. */

export const buildList = defineTool({
  name: "build_list",
  meta: { group: "build", title: "List build history" },
  description: "List CI build history of a repository with filters.",
  schema: {
    ...Fragments.repo,
    event: z.string().max(100).optional().describe("Filter by event, e.g. push, pull_request"),
    status: z
      .enum(["pending", "success", "error", "cancel"])
      .optional()
      .describe("Filter by status"),
    source_ref: z.string().max(300).optional().describe("Filter by source branch"),
    target_ref: z.string().max(300).optional().describe("Filter by target branch"),
    sha: z.string().max(300).optional().describe("Filter by commit"),
    create_time: z.string().max(20).optional().describe('Start date "YYYY-MM-DD"'),
    end_time: z.string().max(20).optional().describe('End date "YYYY-MM-DD"'),
    ...Fragments.page,
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    return jsonResult(
      await ctx.client.get(`/${repo}/-/build/logs`, {
        event: args.event,
        status: args.status,
        sourceRef: args.source_ref ? parseGitRef(args.source_ref, "source ref") : undefined,
        targetRef: args.target_ref ? parseGitRef(args.target_ref, "target ref") : undefined,
        sha: args.sha,
        createTime: args.create_time,
        endTime: args.end_time,
        page: args.page,
        page_size: args.page_size,
      }),
    );
  },
});

export const buildStatus = defineTool({
  name: "build_status",
  meta: { group: "build", title: "Get build status" },
  description:
    "Get the overall status and per-pipeline status of one build (by SN, e.g. cnb-xxx). SN values come from build_list / build_trigger / npc_dispatch.",
  schema: { ...Fragments.repo, sn: z.string().min(1).max(100).describe("Build SN") },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    const sn = parseBuildSn(args.sn);
    return jsonResult(await ctx.client.get(`/${repo}/-/build/status/${sn}`));
  },
});

export const buildStageLogs = defineTool({
  name: "build_stage_logs",
  meta: { group: "build", title: "Get build stage logs" },
  description:
    "Get the log of one pipeline stage. Find pipelineId/stageId via build_status first. Log output is truncated to keep responses small.",
  schema: {
    ...Fragments.repo,
    sn: z.string().min(1).max(100).describe("Build SN"),
    pipeline_id: z.string().min(1).max(200).describe("Pipeline ID from build_status"),
    stage_id: z.string().min(1).max(200).describe("Stage ID from build_status"),
    max_chars: z.coerce
      .number()
      .int()
      .min(1000)
      .max(200_000)
      .optional()
      .describe("Max log characters to return (default 60000)"),
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    const sn = parseBuildSn(args.sn);
    const pipeline = sanitizeId(args.pipeline_id, "pipeline_id");
    const stage = sanitizeId(args.stage_id, "stage_id");
    // CNB returns a JSON stage result ({ duration, content: string[], error? }).
    // Flatten only the log lines, not the serialized JSON envelope.
    const payload = await ctx.client.get<unknown>(
      `/${repo}/-/build/logs/stage/${sn}/${pipeline}/${stage}`,
    );
    const formatted = formatStageLogPayload(payload);
    const { text } = truncateText(formatted, args.max_chars ?? 60_000);
    return textResult(text);
  },
});

/**
 * Flatten CNB's stage log envelope without losing errors or silently treating
 * an empty/unexpected API response as a successful blank log.
 * Also accepts text responses from older installations.
 */
export function formatStageLogPayload(payload: unknown): string {
  if (typeof payload === "string") {
    if (!payload.trim()) throw new Error("CNB returned an empty stage log response");
    const leading = payload.trimStart();
    if (leading.startsWith("{") || leading.startsWith("[")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload) as unknown;
      } catch {
        throw new Error("CNB returned malformed JSON stage logs");
      }
      return formatStageLogPayload(parsed);
    }
    return payload;
  }
  if (Array.isArray(payload)) {
    if (!payload.every((line) => typeof line === "string")) {
      throw new Error("CNB stage log contains non-text lines");
    }
    const joined = payload.join("\n");
    if (!joined.trim()) throw new Error("CNB returned stage log without content");
    return joined;
  }
  if (payload !== null && typeof payload === "object") {
    const result = payload as Record<string, unknown>;
    let content = "";
    if (Array.isArray(result.content)) {
      if (!result.content.every((line) => typeof line === "string")) {
        throw new Error("CNB stage log contains non-text lines");
      }
      content = result.content.join("\n");
    } else if (typeof result.content === "string") {
      content = result.content;
    }
    const error = typeof result.error === "string" ? result.error.trim() : "";
    const combined = [content, error ? "CNB stage error: " + error : ""]
      .filter(Boolean)
      .join("\n");
    if (!combined.trim()) {
      throw new Error("CNB returned stage log without content or error; check build_status and web logs");
    }
    return combined;
  }
  throw new Error("Unexpected CNB stage log response type");
}

export const buildTrigger = defineTool({
  name: "build_trigger",
  meta: { group: "build", title: "Trigger a build", write: true },
  description:
    "Trigger a pipeline build by event name. The event must be configured in the repository .cnb.yml (e.g. api_trigger). Returns the build SN; use build_status to poll the result.",
  schema: {
    ...Fragments.repo,
    event: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional()
      .describe('Event name configured in .cnb.yml (default "api_trigger")'),
    branch: z.string().max(300).optional().describe("Branch to build (default: default branch)"),
    env: z
      .record(z.string().max(200), z.string().max(10_000))
      .optional()
      .refine((v) => !v || Object.keys(v).length <= 50, "env supports at most 50 variables")
      .describe("Environment variables passed to the pipeline"),
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    const body: Record<string, unknown> = {
      event: args.event ?? "api_trigger",
      env: args.env ?? {},
    };
    if (args.branch) body.branch = parseGitRef(args.branch, "branch");
    const result = await ctx.client.post<{
      sn?: string;
      buildLogUrl?: string;
      success?: boolean;
      message?: string;
    }>(`/${repo}/-/build/start`, body);
    return textResult(
      [
        result.success === false ? "Trigger rejected by CNB." : "Build triggered.",
        result.sn ? `SN: ${result.sn}` : undefined,
        result.buildLogUrl ? `Log URL: ${result.buildLogUrl}` : undefined,
        result.message ? `Message: ${result.message}` : undefined,
        result.sn
          ? "Poll build_status with this SN — triggering only means accepted, not finished."
          : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  },
});

export const buildCancel = defineTool({
  name: "build_cancel",
  meta: { group: "build", title: "Cancel a build", write: true },
  description: "Cancel a running build by SN.",
  schema: { ...Fragments.repo, sn: z.string().min(1).max(100).describe("Build SN") },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    const sn = parseBuildSn(args.sn);
    await ctx.client.post(`/${repo}/-/build/stop/${sn}`);
    return textResult(`Cancel requested for build ${sn}. Poll build_status to confirm.`);
  },
});

export const buildTools: AnyTool[] = [
  buildList,
  buildStatus,
  buildStageLogs,
  buildTrigger,
  buildCancel,
];

/** Build SN guard: CNB SNs look like `cnb-1qa-1i3f5ecau`. */
export function parseBuildSn(input: string): string {
  const sn = input.trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(sn)) {
    throw new Error(`Invalid build SN: ${JSON.stringify(input)}`);
  }
  return sn;
}

function sanitizeId(input: string, what: string): string {
  const id = input.trim();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
    throw new Error(`Invalid ${what}: ${JSON.stringify(input)}`);
  }
  return id;
}
