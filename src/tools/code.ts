import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { defineTool, textResult, Fragments, type AnyTool, type ToolContext } from "./define.js";
import { parseRepoSlug } from "../security/guard.js";
import { GitWorkspace } from "../git/workspace.js";

/**
 * Controlled code modification tools.
 *
 * `code_push_files` is the only path to modify repository content. It runs
 * inside an isolated, short-lived git workspace (see src/git/workspace.ts)
 * and requires write mode. Pushing to the repository default branch
 * additionally requires confirm=true.
 */

const pushFilesSchema = {
  ...Fragments.repo,
  branch: z
    .string()
    .min(1)
    .max(300)
    .describe("Branch to commit to (created from base_branch when missing)"),
  base_branch: z
    .string()
    .max(300)
    .optional()
    .describe("Start branch when `branch` does not exist yet (default: repository default branch)"),
  message: z.string().min(1).max(5000).describe("Commit message"),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(500).describe("File path inside the repository"),
        content: z.string().max(2_800_000).optional().describe("File content (utf-8 or base64)"),
        encoding: z
          .enum(["utf-8", "base64"])
          .optional()
          .describe("Content encoding (default utf-8)"),
        action: z.enum(["upsert", "delete"]).optional().describe("Default upsert"),
      }),
    )
    .min(1)
    .max(100)
    .describe("Files to upsert or delete"),
  expect_head: z
    .string()
    .regex(/^[0-9a-f]{40}$/i)
    .optional()
    .describe(
      "Current head SHA of the target branch — the push fails if the branch advanced (optimistic concurrency)",
    ),
  author_name: z.string().max(200).optional().describe("Commit author name"),
  author_email: z.string().max(200).optional().describe("Commit author email"),
  confirm: z
    .boolean()
    .optional()
    .describe("Required (true) when pushing to the repository default branch"),
} as const;

async function pushFilesHandler(
  args: z.infer<z.ZodObject<typeof pushFilesSchema>>,
  ctx: ToolContext,
): Promise<CallToolResult | string> {
  const repo = parseRepoSlug(args.repo);
  const workspace = new GitWorkspace(ctx.config, ctx.auth.cnbToken, ctx.log);

  // Guard: pushing to the default branch is high-risk and needs confirmation.
  const head = await ctx.client.get<{ default_branch?: string }>(`/${repo}/-/git/head`);
  const defaultBranch = head?.default_branch;
  if (defaultBranch && args.branch === defaultBranch && args.confirm !== true) {
    return textResult(
      `Refused: "${args.branch}" is the default branch of ${repo}. Review the change, then re-invoke with "confirm": true. ` +
        `Consider pushing to a feature branch and opening a PR instead (pr_create).`,
    );
  }

  const result = await workspace.pushFiles({
    repo,
    branch: args.branch,
    base_branch: args.base_branch,
    files: args.files,
    message: args.message,
    expect_head: args.expect_head,
    author_name: args.author_name,
    author_email: args.author_email,
  });

  if (result.unchanged) {
    return textResult(
      `No changes to commit: the resulting tree of ${repo}@${args.branch} is identical to its current state.`,
    );
  }
  return textResult(
    [
      `Pushed ${result.changedFiles} file(s) to ${repo}@${args.branch}.`,
      result.commit ? `Commit: ${result.commit}` : undefined,
      result.webUrl ? `Browse: ${result.webUrl}` : undefined,
      "Next: open a pull request with pr_create if needed.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export const codePushFiles = defineTool({
  name: "code_push_files",
  meta: { group: "code", title: "Commit and push file changes", write: true },
  description:
    "Upsert/delete files in a repository through an isolated git workspace, then commit and push. " +
    "Pushing to the default branch requires confirm=true; prefer feature branches + pr_create.",
  schema: pushFilesSchema,
  handler: pushFilesHandler,
});

export const codeTools: AnyTool[] = [codePushFiles];
