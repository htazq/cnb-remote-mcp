import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseRepoSlug, parseGitRef, parseRepoPath } from "../security/guard.js";
import type { AppConfig } from "../config.js";

/**
 * Isolated server-side git workspaces for controlled code changes.
 *
 * Security properties:
 * - Workspace directories are derived from a hash of the repo slug plus a
 *   random UUID; user input never forms a filesystem path.
 * - Git is spawned with an argv array (no shell), so no command injection.
 * - Upstream credentials are injected via GIT_CONFIG_* environment variables
 *   (http.extraheader), keeping tokens out of argv, git config files and URLs.
 * - Every operation runs in a fresh clone and the directory is removed
 *   afterwards; a hard timeout bounds each git invocation.
 * - Pushes use --force-with-lease when an expected head SHA is provided,
 *   failing instead of overwriting concurrent upstream changes.
 */

export interface PushFile {
  path: string;
  /** New content (utf-8 or base64 depending on `encoding`). Ignored for delete. */
  content?: string;
  encoding?: "utf-8" | "base64";
  action?: "upsert" | "delete";
}

export interface PushFilesParams {
  repo: string;
  branch: string;
  /** Branch to start from when `branch` does not exist yet. Defaults to the repo default branch. */
  base_branch?: string;
  files: PushFile[];
  message: string;
  /** Optimistic concurrency: fail if remote branch head is not this SHA. */
  expect_head?: string;
  author_name?: string;
  author_email?: string;
}

export interface PushFilesResult {
  commit?: string;
  branch: string;
  unchanged: boolean;
  changedFiles: number;
  webUrl?: string;
}

const MAX_FILES = 100;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_MESSAGE = 5_000;

export class GitWorkspaceError extends Error {}

export class GitWorkspace {
  constructor(
    private readonly config: AppConfig,
    private readonly cnbToken: string,
    private readonly log: { warn(msg: string, fields?: Record<string, unknown>): void },
  ) {}

  async pushFiles(params: PushFilesParams): Promise<PushFilesResult> {
    const repo = parseRepoSlug(params.repo);
    const branch = parseGitRef(params.branch, "branch");
    const baseBranch = params.base_branch
      ? parseGitRef(params.base_branch, "base branch")
      : undefined;
    if (!params.files || params.files.length === 0)
      throw new GitWorkspaceError("`files` must not be empty");
    if (params.files.length > MAX_FILES) {
      throw new GitWorkspaceError(`Too many files in one call (max ${MAX_FILES})`);
    }
    const message = params.message.trim();
    if (!message || message.length > MAX_MESSAGE) {
      throw new GitWorkspaceError("`message` must be 1-5000 chars");
    }

    const parsedFiles = params.files.map((f) => {
      const p = parseRepoPath(f.path, "file path");
      const action = f.action ?? "upsert";
      if (action === "upsert" && typeof f.content !== "string") {
        throw new GitWorkspaceError(`File ${f.path}: content is required for upsert`);
      }
      const bytes =
        action === "upsert" ? Buffer.from(f.content ?? "", f.encoding ?? "utf-8") : Buffer.alloc(0);
      if (action === "upsert" && bytes.length > MAX_FILE_BYTES) {
        throw new GitWorkspaceError(`File ${f.path} exceeds ${MAX_FILE_BYTES} bytes`);
      }
      return { path: p, action, bytes };
    });
    const total = parsedFiles.reduce((n, f) => n + f.bytes.length, 0);
    if (total > MAX_TOTAL_BYTES) {
      throw new GitWorkspaceError(`Total change size ${total} bytes exceeds ${MAX_TOTAL_BYTES}`);
    }

    const dir = path.join(
      this.config.gitWorkspaceRoot,
      `${createHash("sha256").update(repo).digest("hex").slice(0, 16)}-${randomUUID()}`,
    );
    if (!dir.startsWith(this.config.gitWorkspaceRoot)) {
      throw new GitWorkspaceError("Internal error: workspace root escape");
    }

    try {
      await mkdir(path.dirname(dir), { recursive: true });
      const url = `${this.config.cnbWebBaseUrl.replace(/\/+$/, "")}/${repo}.git`;
      await this.git(["clone", "--filter=blob:none", url, dir], `clone ${repo}`);

      // Resolve base: requested branch if it exists remotely, else the default branch.
      let startRef: string;
      const branchExists = await this.gitOk(["rev-parse", "--verify", `origin/${branch}`], dir);
      if (branchExists) {
        if (params.base_branch && params.base_branch !== branch) {
          throw new GitWorkspaceError(
            `Branch ${branch} already exists; omit base_branch or choose a new branch name`,
          );
        }
        startRef = branch;
      } else {
        startRef = baseBranch ?? (await this.defaultBranchAfterClone(dir));
      }
      await this.git(["checkout", "-B", branch, `origin/${startRef}`], "checkout", dir);

      let changed = 0;
      for (const f of parsedFiles) {
        const target = path.join(dir, f.path);
        if (!path.resolve(target).startsWith(path.resolve(dir) + path.sep)) {
          throw new GitWorkspaceError("Internal error: file path escape");
        }
        if (f.action === "delete") {
          await rm(target, { force: true });
          changed++;
        } else {
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, f.bytes);
          changed++;
        }
      }

      await this.git(["add", "--all", "--"], "stage files", dir);
      const hasChanges = await this.gitOk(["diff", "--cached", "--quiet"], dir).then(
        (ok) => !ok,
        () => true,
      );
      if (!hasChanges) {
        return { branch, unchanged: true, changedFiles: 0 };
      }

      await this.git(
        [
          "-c",
          `user.name=${params.author_name ?? "cnb-remote-mcp"}`,
          "-c",
          `user.email=${params.author_email ?? "cnb-remote-mcp@users.noreply.cnb.cool"}`,
          "commit",
          "-m",
          message,
        ],
        "commit",
        dir,
      );
      const commit = (await this.git(["rev-parse", "HEAD"], "rev-parse", dir)).trim();

      const pushArgs = ["push", "--atomic"];
      if (params.expect_head) {
        const lease = params.expect_head.trim();
        if (!/^[0-9a-f]{40}$/i.test(lease)) {
          throw new GitWorkspaceError("expect_head must be a 40-char commit SHA");
        }
        pushArgs.push(`--force-with-lease=refs/heads/${branch}:${lease}`);
      }
      pushArgs.push("origin", branch);
      await this.git(pushArgs, "push", dir);

      return {
        commit,
        branch,
        unchanged: false,
        changedFiles: changed,
        webUrl: `${this.config.cnbWebBaseUrl}/${repo}/-/blob/${branch}/`,
      };
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 2 }).catch((err) =>
        this.log.warn("workspace cleanup failed", {
          dir: path.basename(dir),
          error: (err as Error).message,
        }),
      );
    }
  }

  private async defaultBranchAfterClone(dir: string): Promise<string> {
    const ref = await this.git(
      ["symbolic-ref", "refs/remotes/origin/HEAD"],
      "resolve default branch",
      dir,
    );
    return ref.replace("refs/remotes/origin/", "").trim();
  }

  private gitEnv(): NodeJS.ProcessEnv {
    const basic = Buffer.from(`cnb:${this.cnbToken}`).toString("base64");
    return {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "http.extraheader",
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
      GIT_CONFIG_KEY_1: "credential.helper",
      GIT_CONFIG_VALUE_1: "",
      GIT_CONFIG_NOSYSTEM: "1",
      HOME: "",
      GCM_INTERACTIVE: "never",
    };
  }

  private async git(args: string[], label: string, cwd?: string): Promise<string> {
    const res = await this.tryGit(args, cwd);
    if (res.code !== 0) {
      throw new GitWorkspaceError(
        `git ${label} failed (exit ${res.code}): ${res.stderr.slice(0, 500) || res.stdout.slice(0, 500)}`,
      );
    }
    return res.stdout;
  }

  private async gitOk(args: string[], cwd?: string): Promise<boolean> {
    const res = await this.tryGit(args, cwd);
    return res.code === 0;
  }

  private tryGit(
    args: string[],
    cwd?: string,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        cwd,
        env: this.gitEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new GitWorkspaceError(`git ${args[0]} timed out`));
      }, this.config.gitTimeoutMs);
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          code: code ?? -1,
          stdout: stdout.slice(0, 20_000),
          stderr: stderr.slice(0, 20_000),
        });
      });
    });
  }
}
