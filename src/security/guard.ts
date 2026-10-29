/**
 * Input validation and hardening helpers.
 *
 * Everything that originates from an LLM (tool arguments) or from remote
 * content must pass through these guards before it reaches the CNB API,
 * the filesystem or a child process.
 */

export class ValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * CNB repository slug: `owner/repo` or `group/subgroup/repo`.
 * Each segment: letters, digits, `.`, `_`, `-`; no `..`; no leading/trailing dot-dash tricks.
 */
const SLUG_SEGMENT_RE = /^(?!\.)(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._-]*(?<=[A-Za-z0-9])$/;

/** Parse and normalize a repository slug. Rejects `.git` suffix and traversal tricks. */
export function parseRepoSlug(input: string): string {
  const raw = input.trim();
  if (raw.length < 3 || raw.length > 200) {
    throw new ValidationError(`Invalid repo slug: ${input}`);
  }
  const withoutGit = raw.endsWith(".git") ? raw.slice(0, -4) : raw;
  const segments = withoutGit.split("/");
  if (segments.some((s) => s.length === 0)) {
    throw new ValidationError(`Invalid repo slug "${input}": empty segment`);
  }
  if (segments.length < 2 || segments.length > 4) {
    throw new ValidationError(
      `Invalid repo slug "${input}": expected owner/repo or group/subgroup/repo`,
    );
  }
  for (const seg of segments) {
    if (!SLUG_SEGMENT_RE.test(seg)) {
      throw new ValidationError(`Invalid repo slug "${input}": bad segment "${seg}"`);
    }
  }
  return segments.join("/");
}

/** Validate a group path (1-3 segments), used as the parent when creating a repository. */
export function parseGroupPath(input: string): string {
  const segments = input
    .trim()
    .split("/")
    .filter((s) => s.length > 0);
  if (segments.length < 1 || segments.length > 3) {
    throw new ValidationError(`Invalid group path "${input}": expected "group" or "group/sub"`);
  }
  for (const seg of segments) {
    if (!SLUG_SEGMENT_RE.test(seg)) {
      throw new ValidationError(`Invalid group path "${input}": bad segment "${seg}"`);
    }
  }
  return segments.join("/");
}

const GIT_REF_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._][A-Za-z0-9._/-]{0,250}$/;

/** Validate a git ref (branch, tag or commit-ish). Blocks option injection and range tricks. */
export function parseGitRef(input: string, what = "ref"): string {
  const ref = input.trim();
  if (
    !ref ||
    !GIT_REF_RE.test(ref) ||
    ref.includes("..") ||
    ref.endsWith(".lock") ||
    ref.includes("//")
  ) {
    throw new ValidationError(`Invalid git ${what}: ${JSON.stringify(input)}`);
  }
  return ref;
}

const REPO_PATH_RE = /^[^\\]*$/;

/**
 * Validate a path *inside* a repository (POSIX semantics, forward slashes only).
 * Rejects absolute paths, `..`, drive letters and backslashes.
 */
export function parseRepoPath(input: string, what = "path"): string {
  const p = input.trim();
  if (!p || p.length > 500) throw new ValidationError(`Invalid ${what}`);
  if (p.startsWith("/") || p.includes("../") || p.includes("/..") || p === "..") {
    throw new ValidationError(`Invalid ${what}: path traversal detected`);
  }
  if (p.startsWith("~") || /^[A-Za-z]:/.test(p)) {
    throw new ValidationError(`Invalid ${what}: absolute paths are not allowed`);
  }
  if (!REPO_PATH_RE.test(p) || p.includes("\0")) {
    throw new ValidationError(`Invalid ${what}`);
  }
  return p
    .split("/")
    .filter((s) => s.length > 0 && s !== ".")
    .join("/");
}

/** sha256 hex of a value — used to derive workspace dir names and token fingerprints. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Truncate long text payloads (build logs, file contents) before returning them to the LLM. */
export function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, maxChars)}\n… [truncated ${text.length - maxChars} chars]`,
    truncated: true,
  };
}
