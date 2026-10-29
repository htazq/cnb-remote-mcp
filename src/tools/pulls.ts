import { z } from "zod";
import { defineTool, jsonResult, textResult, Fragments, type AnyTool } from "./define.js";
import { parseRepoSlug, parseGitRef } from "../security/guard.js";

/** Pull request tools. */

export const prList = defineTool({
  name: "pr_list",
  meta: { group: "pr", title: "List pull requests" },
  description: "List pull requests with optional filters.",
  schema: {
    ...Fragments.repo,
    state: z.enum(["open", "closed", "merged", "all"]).optional().describe("Filter by state"),
    base_ref: z.string().max(300).optional().describe("Filter by target branch"),
    author: z.string().max(100).optional().describe("Filter by author username"),
    ...Fragments.page,
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    return jsonResult(
      await ctx.client.get(`/${repo}/-/pulls`, {
        state: args.state,
        base_ref: args.base_ref ? parseGitRef(args.base_ref, "base ref") : undefined,
        authors: args.author,
        page: args.page,
        page_size: args.page_size,
      }),
    );
  },
});

export const prGet = defineTool({
  name: "pr_get",
  meta: { group: "pr", title: "Get a pull request" },
  description:
    "Get one pull request including mergeable_state (conflict/merge status) and CI statuses.",
  schema: { ...Fragments.repo, number: z.coerce.number().int().min(1).describe("PR number") },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    return jsonResult(await ctx.client.get(`/${repo}/-/pulls/${args.number}`));
  },
});

export const prCreate = defineTool({
  name: "pr_create",
  meta: { group: "pr", title: "Create a pull request", write: true },
  description: "Create a pull request from a head branch into a base branch.",
  schema: {
    ...Fragments.repo,
    title: z.string().min(1).max(500).describe("PR title"),
    head: z.string().min(1).max(300).describe("Source branch"),
    base: z.string().min(1).max(300).describe("Target branch"),
    body: z.string().max(100_000).optional().describe("PR description (Markdown)"),
    head_repo: z
      .string()
      .max(200)
      .optional()
      .describe("Source repository when the branch lives in a fork"),
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    const pr = await ctx.client.post(`/${repo}/-/pulls`, {
      title: args.title,
      head: parseGitRef(args.head, "head branch"),
      base: parseGitRef(args.base, "base branch"),
      body: args.body,
      head_repo: args.head_repo ? parseRepoSlug(args.head_repo) : undefined,
    });
    return jsonResult(pr);
  },
});

export const prUpdate = defineTool({
  name: "pr_update",
  meta: { group: "pr", title: "Update a pull request", write: true },
  description: "Update title, body or state of a pull request.",
  schema: {
    ...Fragments.repo,
    number: z.coerce.number().int().min(1).describe("PR number"),
    title: z.string().min(1).max(500).optional().describe("New title"),
    body: z.string().max(100_000).optional().describe("New body (Markdown)"),
    state: z.enum(["open", "close", "reopen"]).optional().describe("New state"),
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    return jsonResult(
      await ctx.client.patch(`/${repo}/-/pulls/${args.number}`, {
        title: args.title,
        body: args.body,
        state: args.state,
      }),
    );
  },
});

export const prFiles = defineTool({
  name: "pr_files",
  meta: { group: "pr", title: "List PR changed files" },
  description: "List files changed by a pull request with patch diffs.",
  schema: {
    ...Fragments.repo,
    number: z.coerce.number().int().min(1).describe("PR number"),
    ...Fragments.page,
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    return jsonResult(
      await ctx.client.get(`/${repo}/-/pulls/${args.number}/files`, {
        page: args.page,
        page_size: args.page_size,
      }),
    );
  },
});

export const prCommits = defineTool({
  name: "pr_commits",
  meta: { group: "pr", title: "List PR commits" },
  description: "List commits contained in a pull request.",
  schema: { ...Fragments.repo, number: z.coerce.number().int().min(1).describe("PR number") },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    return jsonResult(await ctx.client.get(`/${repo}/-/pulls/${args.number}/commits`));
  },
});

export const prChecks = defineTool({
  name: "pr_checks",
  meta: { group: "pr", title: "Get PR CI check statuses" },
  description: "Get CI check statuses attached to a pull request.",
  schema: { ...Fragments.repo, number: z.coerce.number().int().min(1).describe("PR number") },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    return jsonResult(await ctx.client.get(`/${repo}/-/pulls/${args.number}/commit-statuses`));
  },
});

export const prCommentList = defineTool({
  name: "pr_comment_list",
  meta: { group: "pr", title: "List PR comments" },
  description: "List comments on a pull request.",
  schema: {
    ...Fragments.repo,
    number: z.coerce.number().int().min(1).describe("PR number"),
    ...Fragments.page,
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    return jsonResult(
      await ctx.client.get(`/${repo}/-/pulls/${args.number}/comments`, {
        page: args.page,
        page_size: args.page_size,
      }),
    );
  },
});

export const prCommentAdd = defineTool({
  name: "pr_comment_add",
  meta: { group: "pr", title: "Comment on a pull request", write: true },
  description: "Add a comment to a pull request.",
  schema: {
    ...Fragments.repo,
    number: z.coerce.number().int().min(1).describe("PR number"),
    body: z.string().min(1).max(100_000).describe("Comment body (Markdown)"),
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    await ctx.client.post(`/${repo}/-/pulls/${args.number}/comments`, { body: args.body });
    return textResult(`Comment added to PR #${args.number} in ${repo}.`);
  },
});

export const prReviewList = defineTool({
  name: "pr_review_list",
  meta: { group: "pr", title: "List PR reviews" },
  description: "List reviews of a pull request (approve / request changes / comment).",
  schema: { ...Fragments.repo, number: z.coerce.number().int().min(1).describe("PR number") },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    return jsonResult(await ctx.client.get(`/${repo}/-/pulls/${args.number}/reviews`));
  },
});

export const prReviewSubmit = defineTool({
  name: "pr_review_submit",
  meta: { group: "pr", title: "Submit a PR review", write: true },
  description: "Submit a review decision on a pull request.",
  schema: {
    ...Fragments.repo,
    number: z.coerce.number().int().min(1).describe("PR number"),
    event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]).describe("Review decision"),
    body: z.string().max(100_000).optional().describe("Review summary (Markdown)"),
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    const review = await ctx.client.post(`/${repo}/-/pulls/${args.number}/reviews`, {
      event: args.event,
      body: args.body,
    });
    return jsonResult(review);
  },
});

export const prMerge = defineTool({
  name: "pr_merge",
  meta: { group: "pr", title: "Merge a pull request", write: true, destructive: true },
  description:
    "Merge a pull request. Destructive: requires confirm=true. Check pr_get and pr_checks first.",
  schema: {
    ...Fragments.repo,
    number: z.coerce.number().int().min(1).describe("PR number"),
    merge_style: z
      .enum(["merge", "squash", "rebase", "fast-forward"])
      .optional()
      .describe("Merge style (default: merge)"),
    commit_title: z.string().max(500).optional().describe("Custom merge commit title"),
    commit_message: z.string().max(10_000).optional().describe("Custom merge commit message"),
    ...Fragments.confirm,
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    const result = await ctx.client.put(`/${repo}/-/pulls/${args.number}/merge`, {
      merge_style: args.merge_style,
      commit_title: args.commit_title,
      commit_message: args.commit_message,
    });
    return textResult(
      `PR #${args.number} merged into ${repo}. ${result ? JSON.stringify(result) : ""}`.trim(),
    );
  },
});

export const pullTools: AnyTool[] = [
  prList,
  prGet,
  prCreate,
  prUpdate,
  prFiles,
  prCommits,
  prChecks,
  prCommentList,
  prCommentAdd,
  prReviewList,
  prReviewSubmit,
  prMerge,
];
