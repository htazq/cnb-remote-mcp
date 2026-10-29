import path from "node:path";
import { z } from "zod";

/**
 * Application configuration, parsed once from the environment.
 *
 * Every value is validated at startup; the process fails fast with a
 * human-readable error when configuration is invalid or unsafe
 * (e.g. a public HTTP server without any client authentication).
 */

export const WriteMode = z.enum(["read-only", "write"]);
export type WriteMode = z.infer<typeof WriteMode>;

const envSchema = z.object({
  CNB_API_BASE_URL: z.string().url().default("https://api.cnb.cool"),
  CNB_WEB_BASE_URL: z.string().url().default("https://cnb.cool"),

  /** PAT mode: CNB token used for upstream OpenAPI calls. */
  CNB_TOKEN: z.string().trim().optional(),

  /** Layer-1 bearer tokens MCP clients must present (comma separated). */
  MCP_ACCESS_TOKENS: z.string().default(""),

  MCP_HTTP_HOST: z.string().default("0.0.0.0"),
  MCP_HTTP_PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  MCP_PUBLIC_BASE_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
  MCP_OAUTH_CLIENT_ID: z.string().default(""),
  MCP_OAUTH_CLIENT_SECRET: z.string().default(""),
  MCP_OAUTH_REDIRECT_URIS: z.string().default(""),

  MCP_WRITE_MODE: WriteMode.default("read-only"),

  MCP_GIT_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(1800).default(180),
  MCP_GIT_MAX_WORKSPACES: z.coerce.number().int().min(1).max(200).default(20),

  MCP_DATA_DIR: z.string().default("./data"),
  MCP_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export interface AppConfig {
  cnbApiBaseUrl: string;
  cnbWebBaseUrl: string;
  cnbToken?: string;

  accessTokenList: string[];

  httpHost: string;
  httpPort: number;
  publicBaseUrl?: string;
  oauth?: { clientId: string; clientSecret: string; redirectUris: string[] };

  writeMode: WriteMode;

  gitTimeoutMs: number;
  gitMaxWorkspaces: number;

  dataDir: string;
  gitWorkspaceRoot: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(`Invalid configuration: ${details}`);
  }
  const e = parsed.data;
  const redirectUris = e.MCP_OAUTH_REDIRECT_URIS.split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (e.MCP_OAUTH_CLIENT_ID || e.MCP_OAUTH_CLIENT_SECRET || redirectUris.length) {
    const publicUrl = e.MCP_PUBLIC_BASE_URL && new URL(e.MCP_PUBLIC_BASE_URL);
    if (
      !e.MCP_OAUTH_CLIENT_ID ||
      e.MCP_OAUTH_CLIENT_SECRET.length < 32 ||
      !redirectUris.length ||
      !publicUrl ||
      publicUrl.protocol !== "https:" ||
      publicUrl.pathname !== "/" ||
      publicUrl.search ||
      publicUrl.hash ||
      publicUrl.username ||
      publicUrl.password ||
      !e.CNB_TOKEN ||
      !e.MCP_ACCESS_TOKENS.split(",").some((v) => v.trim().length >= 32)
    ) {
      throw new ConfigError(
        "OAuth requires an HTTPS public origin, CNB_TOKEN, a client ID, a 32+ character client secret, redirect URIs and a 32+ character MCP access token for owner consent.",
      );
    }
    for (const uri of redirectUris) {
      const url = z.string().url().safeParse(uri);
      if (
        !url.success ||
        new URL(uri).protocol !== "https:" ||
        new URL(uri).hash ||
        new URL(uri).username ||
        new URL(uri).password
      ) {
        throw new ConfigError(
          "OAuth redirect URIs must be exact HTTPS URLs without credentials or fragments.",
        );
      }
    }
  }

  if (e.MCP_WRITE_MODE === "write" && !e.CNB_TOKEN) {
    throw new ConfigError(
      "Write mode requires an upstream identity: set CNB_TOKEN (a CNB personal access token).",
    );
  }

  const dataDir = path.resolve(e.MCP_DATA_DIR);

  return {
    cnbApiBaseUrl: e.CNB_API_BASE_URL.replace(/\/+$/, ""),
    cnbWebBaseUrl: e.CNB_WEB_BASE_URL.replace(/\/+$/, ""),
    cnbToken: e.CNB_TOKEN || undefined,

    accessTokenList: e.MCP_ACCESS_TOKENS.split(",")
      .map((t) => t.trim())
      .filter(Boolean),

    httpHost: e.MCP_HTTP_HOST,
    httpPort: e.MCP_HTTP_PORT,
    publicBaseUrl: e.MCP_PUBLIC_BASE_URL?.replace(/\/+$/, ""),
    oauth: e.MCP_OAUTH_CLIENT_ID
      ? {
          clientId: e.MCP_OAUTH_CLIENT_ID,
          clientSecret: e.MCP_OAUTH_CLIENT_SECRET,
          redirectUris,
        }
      : undefined,

    writeMode: e.MCP_WRITE_MODE,

    gitTimeoutMs: e.MCP_GIT_TIMEOUT_SECONDS * 1000,
    gitMaxWorkspaces: e.MCP_GIT_MAX_WORKSPACES,

    dataDir,
    gitWorkspaceRoot: path.join(dataDir, "git-workspaces"),
    logLevel: e.MCP_LOG_LEVEL,
  };
}

/** Throws when HTTP transport cannot start safely. */
export function assertHttpStartable(config: AppConfig): void {
  if (config.accessTokenList.length === 0) {
    throw new ConfigError(
      "Refusing to start HTTP transport without client authentication: " +
        "set MCP_ACCESS_TOKENS (comma-separated bearer tokens for MCP clients).",
    );
  }
}
