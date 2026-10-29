/**
 * Two-layer authentication model:
 *
 *   MCP client ──(layer 1: bearer token from MCP_ACCESS_TOKENS)──> Remote MCP
 *   Remote MCP ──(layer 2: shared CNB personal access token)─────> CNB OpenAPI
 *
 * Layer-1 identity is resolved per request; the layer-2 credential never
 * leaves the server process and is never logged.
 */

export interface AuthContext {
  /** Stable, non-reversible identity used in logs/audit (never the raw token). */
  actor: string;
  /** How the client authenticated. */
  mode: "pat" | "oauth";
  /** CNB credential used for upstream OpenAPI calls (layer 2). */
  cnbToken: string;
  /** Human-readable subject (CNB username when known). */
  subject?: string;
}

/** Result of verifying a layer-1 credential. */
export type VerifyResult = { ok: true; ctx: AuthContext } | { ok: false; reason: string };
