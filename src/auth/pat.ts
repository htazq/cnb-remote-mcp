import { createHash, timingSafeEqual } from "node:crypto";
import { actorFingerprint } from "../security/audit.js";
import type { VerifyResult } from "./types.js";

/**
 * PAT mode verifier: MCP clients present one of the statically configured
 * bearer tokens; upstream CNB calls use the configured CNB_TOKEN.
 *
 * Comparison is constant-time over SHA-256 digests to avoid leaking
 * token-prefix match information.
 */
export function verifyPatAccess(
  bearer: string,
  allowedTokens: string[],
  cnbToken: string,
): VerifyResult {
  if (allowedTokens.length === 0) {
    return { ok: false, reason: "server has no client tokens configured" };
  }
  const presented = sha256(bearer);
  for (const allowed of allowedTokens) {
    if (timingSafeEqualSafe(presented, sha256(allowed))) {
      return {
        ok: true,
        ctx: {
          actor: `pat:${createHash("sha256").update(bearer).digest("hex").slice(0, 12)}`,
          mode: "pat",
          cnbToken,
        },
      };
    }
  }
  return { ok: false, reason: "invalid bearer token" };
}

export async function patActorFingerprint(bearer: string): Promise<string> {
  return actorFingerprint(bearer);
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function timingSafeEqualSafe(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
