import { z } from "zod";
import { defineTool, jsonResult, textResult, Fragments, type AnyTool } from "./define.js";
import {
  parseRepoSlug,
  parseGroupPath,
  parseGitRef,
  parseRepoPath,
  truncateText,
} from "../security/guard.js";

/** Repository, branch, tag, file and commit tools (read-mostly). */

const MAX_FILE_CHARS = 200_000;

export const repoGet = defineTool({
  name: "repo_get",
  meta: { group: "repo", title: "Get repository details" },
  description: "Get metadata of a CNB repository (description, visibility, default branch, stats).",
  schema: { ...Fragments.repo },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    return jsonResult(await ctx.client.get(`/${repo}`));
  },
});

export const repoList = defineTool({
  name: "repo_list",
  meta: { group: "repo", title: "List my repositories" },
  description: "List repositories owned by the authenticated CNB user.",
  schema: {
    search: z.string().max(200).optional().describe("Filter by name keyword"),
    ...Fragments.page,
  },
  handler: async (args, ctx) => {
    return jsonResult(
      await ctx.client.get("/user/repos", {
        search: args.search,
        page: args.page,
        page_size: args.page_size,
      }),
    );
  },
});

export const repoSearch = defineTool({
  name: "repo_search",
  meta: { group: "repo", title: "Search public repositories" },
  description: "Full-text search across public CNB repositories.",
  schema: {
    key: z.string().min(1).max(200).describe("Search keyword"),
    top_n: z.coerce.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
  },
  handler: async (args, ctx) => {
    return jsonResult(
      await ctx.client.get("/search/public-repos", { key: args.key, topN: args.top_n }),
    );
  },
});

export const repoCreate = defineTool({
  name: "repo_create",
  meta: { group: "repo", title: "Create repository", write: true },
  description:
    'Create a new repository inside an owned group. `repo` is the GROUP path (e.g. "my-group"), not the new repo name.',
  schema: {
    repo: z
      .string()
      .min(1)
      .max(200)
      .describe('Group path to create the repo in, e.g. "my-group" or "my-group/sub"'),
    name: z.string().min(1).max(100).describe("New repository name (single path segment)"),
    description: z.string().max(2000).optional().describe("Repository description"),
    visibility: z.enum(["public", "private"]).describe("Repository visibility"),
  },
  handler: async (args, ctx) => {
    const group = parseGroupPath(args.repo);
    if (!/^(?!\.)[A-Za-z0-9][A-Za-z0-9._-]*$/.test(args.name) || args.name.includes("..")) {
      throw new Error(`Invalid repository name: ${JSON.stringify(args.name)}`);
    }
    const created = await ctx.client.post(`/${group}/-/repos`, {
      name: args.name,
      description: args.description,
      visibility: args.visibility,
    });
    return jsonResult(created);
  },
});

export const repoFileRead = defineTool({
  name: "repo_file_read",
  meta: { group: "repo", title: "Read a file" },
  description: "Read the raw text content of a file at a given ref (branch/tag/commit).",
  schema: {
    ...Fragments.repo,
    ref: z.string().min(1).max(300).describe("Branch, tag or commit SHA"),
    path: z.string().min(1).max(500).describe("File path inside the repository, e.g. src/index.ts"),
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    const ref = parseGitRef(args.ref, "ref");
    const file = parseRepoPath(args.path, "file path");
    const raw = await ctx.client.getText(`/${repo}/-/git/raw/${ref}/${file}`);
    const { text, truncated } = truncateText(raw, MAX_FILE_CHARS);
    return textResult(
      truncated
        ? `${text}\n[truncated: file has ${raw.length} chars; total limit ${MAX_FILE_CHARS}]`
        : text,
    );
  },
});

export const repoTreeList = defineTool({
  name: "repo_tree_list",
  meta: { group: "repo", title: "List directory contents" },
  description: "List files and directories at a path. Omit `path` to list the repository root.",
  schema: {
    ...Fragments.repo,
    ref: z.string().min(1).max(300).describe("Branch, tag or commit SHA"),
    path: z.string().max(500).optional().describe("Directory path (default: repository root)"),
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    const ref = parseGitRef(args.ref, "ref");
    const dir = args.path ? parseRepoPath(args.path, "path") : "";
    const pathSegment = dir ? `/${dir}` : "";
    return jsonResult(await ctx.client.get(`/${repo}/-/git/contents${pathSegment}`, { ref }));
  },
});

export const repoCommitsList = defineTool({
  name: "repo_commits_list",
  meta: { group: "repo", title: "List commits" },
  description: "List commit history, optionally starting from a commit-ish.",
  schema: {
    ...Fragments.repo,
    sha: z.string().max(300).optional().describe("Start from this branch/commit"),
    author: z.string().max(200).optional().describe("Filter by author username"),
    since: z.string().max(40).optional().describe("ISO 8601 start time"),
    until: z.string().max(40).optional().describe("ISO 8601 end time"),
    ...Fragments.page,
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    return jsonResult(
      await ctx.client.get(`/${repo}/-/git/commits`, {
        sha: args.sha ? parseGitRef(args.sha, "sha") : undefined,
        author: args.author,
        since: args.since,
        until: args.until,
        page: args.page,
        page_size: args.page_size,
      }),
    );
  },
});

export const repoCommitGet = defineTool({
  name: "repo_commit_get",
  meta: { group: "repo", title: "Get a commit" },
  description: "Get one commit with its changed files (patch).",
  schema: { ...Fragments.repo, sha: z.string().min(1).max(300).describe("Commit SHA or ref") },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    const ref = parseGitRef(args.sha, "commit");
    return jsonResult(await ctx.client.get(`/${repo}/-/git/commits/${ref}`));
  },
});

export const repoDiffCompare = defineTool({
  name: "repo_diff_compare",
  meta: { group: "repo", title: "Compare two refs" },
  description: "Get the diff between two refs (base and head), e.g. base=main head=feature-x.",
  schema: {
    ...Fragments.repo,
    base: z.string().min(1).max(300).describe("Base ref"),
    head: z.string().min(1).max(300).describe("Head ref"),
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    const base = parseGitRef(args.base, "base");
    const head = parseGitRef(args.head, "head");
    return jsonResult(await ctx.client.get(`/${repo}/-/git/compare/${base}...${head}`));
  },
});

export const repoCommitStatuses = defineTool({
  name: "repo_commit_statuses",
  meta: { group: "repo", title: "Get commit check statuses" },
  description: "Get CI check statuses (pipeline results) attached to a commit.",
  schema: {
    ...Fragments.repo,
    commitish: z.string().min(1).max(300).describe("Commit SHA or ref"),
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    const commitish = parseGitRef(args.commitish, "commitish");
    return jsonResult(await ctx.client.get(`/${repo}/-/git/commit-statuses/${commitish}`));
  },
});

export const repoBranchList = defineTool({
  name: "repo_branch_list",
  meta: { group: "repo", title: "List branches" },
  description: "List branches of a repository.",
  schema: { ...Fragments.repo, ...Fragments.page },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    return jsonResult(
      await ctx.client.get(`/${repo}/-/git/branches`, {
        page: args.page,
        page_size: args.page_size,
      }),
    );
  },
});

export const repoBranchGet = defineTool({
  name: "repo_branch_get",
  meta: { group: "repo", title: "Get a branch" },
  description: "Get one branch with its head commit.",
  schema: { ...Fragments.repo, branch: z.string().min(1).max(300).describe("Branch name") },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    const branch = parseGitRef(args.branch, "branch");
    return jsonResult(await ctx.client.get(`/${repo}/-/git/branches/${branch}`));
  },
});

export const repoBranchCreate = defineTool({
  name: "repo_branch_create",
  meta: { group: "repo", title: "Create a branch", write: true },
  description: "Create a new branch from an existing ref (default: repository default branch).",
  schema: {
    ...Fragments.repo,
    name: z.string().min(1).max(300).describe("New branch name"),
    start_point: z
      .string()
      .max(300)
      .optional()
      .describe("Ref to branch from (default: default branch)"),
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    const name = parseGitRef(args.name, "branch name");
    // CNB GET /git/head returns { name, protected }, not { default_branch }.
    // Keep a fallback for older installations, and honor an explicit start_point.
    let startPoint: string;
    if (args.start_point) {
      startPoint = parseGitRef(args.start_point, "start point");
    } else {
      const head = await ctx.client.get<{ name?: string; default_branch?: string }>(
        `/${repo}/-/git/head`,
      );
      const defaultName = head?.name || head?.default_branch;
      if (typeof defaultName !== "string" || !defaultName.trim()) {
        throw new Error("Could not resolve the repository default branch");
      }
      startPoint = parseGitRef(defaultName, "default branch");
    }
    // The CNB create-branch API returns HTTP 201 with no body. A successful
    // response is enough; passing undefined to jsonResult would throw.
    await ctx.client.post<void>(`/${repo}/-/git/branches`, {
      name,
      start_point: startPoint,
    });
    return textResult(`Branch ${name} created in ${repo} from ${startPoint}.`);
  },
});

export const repoBranchDelete = defineTool({
  name: "repo_branch_delete",
  meta: { group: "repo", title: "Delete a branch", write: true, destructive: true },
  description:
    "Delete a branch. Destructive: requires confirm=true. Protected/default branches are rejected by CNB itself.",
  schema: {
    ...Fragments.repo,
    branch: z.string().min(1).max(300).describe("Branch to delete"),
    ...Fragments.confirm,
  },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    const branch = parseGitRef(args.branch, "branch");
    await ctx.client.delete(`/${repo}/-/git/branches/${branch}`);
    return textResult(`Branch ${branch} deleted from ${repo}.`);
  },
});

export const repoTagList = defineTool({
  name: "repo_tag_list",
  meta: { group: "repo", title: "List tags" },
  description: "List tags of a repository.",
  schema: { ...Fragments.repo, ...Fragments.page },
  handler: async (args, ctx) => {
    const repo = parseRepoSlug(args.repo);
    return jsonResult(
      await ctx.client.get(`/${repo}/-/git/tags`, { page: args.page, page_size: args.page_size }),
    );
  },
});

export const repoTools: AnyTool[] = [
  repoGet,
  repoList,
  repoSearch,
  repoCreate,
  repoFileRead,
  repoTreeList,
  repoCommitsList,
  repoCommitGet,
  repoDiffCompare,
  repoCommitStatuses,
  repoBranchList,
  repoBranchGet,
  repoBranchCreate,
  repoBranchDelete,
  repoTagList,
];
