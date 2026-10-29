import { z } from "zod";
import { defineTool, jsonResult, textResult, Fragments, type AnyTool } from "./define.js";
import { parseRepoSlug } from "../security/guard.js";

/** Issue tools. */

export const issueList = defineTool({
  name: "issue_list",
  meta: { group: "issue", title: "List issues" },
  description: "List issues of a repository with optional filters.",
  schema: {
    ...Fragments.repo,
    state: z.enum(["open", "closed", "all"]).optional().describe("Filter by state"),
    keyword: z.string().max(200).optional().describe("Search keyword in title/body"),
    labels: z.string().max(300).optional().describe("Comma-separated label names"),
    author: z.string().max(100).optional().describe("Filter by author username"),
    ...Fragments.page,
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    return jsonResult(
      await ctx.client.get(`/${repo}/-/issues`, {
        state: args.state,
        keyword: args.keyword,
        labels: args.labels,
        authors: args.author,
        page: args.page,
        page_size: args.page_size,
      }),
    );
  },
});

export const issueGet = defineTool({
  name: "issue_get",
  meta: { group: "issue", title: "Get an issue" },
  description: "Get one issue by number.",
  schema: { ...Fragments.repo, number: z.coerce.number().int().min(1).describe("Issue number") },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    return jsonResult(await ctx.client.get(`/${repo}/-/issues/${args.number}`));
  },
});

export const issueCreate = defineTool({
  name: "issue_create",
  meta: { group: "issue", title: "Create an issue", write: true },
  description: "Create a new issue.",
  schema: {
    ...Fragments.repo,
    title: z.string().min(1).max(500).describe("Issue title"),
    body: z.string().max(100_000).optional().describe("Issue body (Markdown)"),
    labels: z.array(z.string().max(100)).max(20).optional().describe("Label names"),
    assignees: z.array(z.string().max(100)).max(20).optional().describe("Assignee usernames"),
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    const issue = await ctx.client.post(`/${repo}/-/issues`, {
      title: args.title,
      body: args.body,
      labels: args.labels,
      assignees: args.assignees,
    });
    return jsonResult(issue);
  },
});

export const issueUpdate = defineTool({
  name: "issue_update",
  meta: { group: "issue", title: "Update an issue", write: true },
  description: "Update title, body, state or priority of an existing issue.",
  schema: {
    ...Fragments.repo,
    number: z.coerce.number().int().min(1).describe("Issue number"),
    title: z.string().min(1).max(500).optional().describe("New title"),
    body: z.string().max(100_000).optional().describe("New body (Markdown)"),
    state: z.enum(["open", "closed"]).optional().describe("New state (CNB accepts open/closed)"),
    state_reason: z
      .enum(["completed", "not_planned", "reopened"])
      .optional()
      .describe("Reason accompanying the state change (CNB requires state and reason together)"),
    priority: z.enum(["0", "1", "2"]).optional().describe("Priority"),
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    let stateReason = args.state_reason;
    if (args.state && !stateReason) {
      // CNB requires state and state_reason to be sent together.
      stateReason = args.state === "open" ? "reopened" : "completed";
    }
    const updated = await ctx.client.patch(`/${repo}/-/issues/${args.number}`, {
      title: args.title,
      body: args.body,
      state: args.state,
      state_reason: stateReason,
      priority: args.priority,
    });
    return jsonResult(updated);
  },
});

export const issueCommentList = defineTool({
  name: "issue_comment_list",
  meta: { group: "issue", title: "List issue comments" },
  description: "List comments of an issue.",
  schema: {
    ...Fragments.repo,
    number: z.coerce.number().int().min(1).describe("Issue number"),
    ...Fragments.page,
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    return jsonResult(
      await ctx.client.get(`/${repo}/-/issues/${args.number}/comments`, {
        page: args.page,
        page_size: args.page_size,
      }),
    );
  },
});

export const issueCommentAdd = defineTool({
  name: "issue_comment_add",
  meta: { group: "issue", title: "Comment on an issue", write: true },
  description: "Add a comment to an issue.",
  schema: {
    ...Fragments.repo,
    number: z.coerce.number().int().min(1).describe("Issue number"),
    body: z.string().min(1).max(100_000).describe("Comment body (Markdown)"),
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    await ctx.client.post(`/${repo}/-/issues/${args.number}/comments`, { body: args.body });
    return textResult(`Comment added to issue #${args.number} in ${repo}.`);
  },
});

export const issueTools: AnyTool[] = [
  issueList,
  issueGet,
  issueCreate,
  issueUpdate,
  issueCommentList,
  issueCommentAdd,
];
