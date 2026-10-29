import type { AnyTool } from "./define.js";
import { accountTools } from "./account.js";
import { repoTools } from "./repos.js";
import { issueTools } from "./issues.js";
import { pullTools } from "./pulls.js";
import { buildTools } from "./builds.js";
import { npcTools } from "./npc.js";
import { codeTools } from "./code.js";
import type { WriteMode } from "../config.js";

/**
 * Tool registry: every tool with its write/destructive metadata, plus the
 * write-mode filter applied when building a server instance.
 */

export function allTools(): AnyTool[] {
  return [
    ...accountTools,
    ...repoTools,
    ...issueTools,
    ...pullTools,
    ...buildTools,
    ...npcTools,
    ...codeTools,
  ];
}

/** Read-only mode exposes only non-write tools. */
export function toolsForWriteMode(mode: WriteMode): AnyTool[] {
  const tools = allTools();
  return mode === "read-only" ? tools.filter((t) => !t.meta.write) : tools;
}

export function toolStats(mode: WriteMode): { total: number; enabled: number } {
  const tools = allTools();
  return { total: tools.length, enabled: toolsForWriteMode(mode).length };
}

/** Summary used by docs generation and capability matrix reviews. */
export function toolGroupsByMode(mode: WriteMode): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const tool of toolsForWriteMode(mode)) {
    (groups[tool.meta.group] ??= []).push(tool.name);
  }
  return groups;
}

export function assertNoDuplicateToolNames(): void {
  const seen = new Set<string>();
  for (const tool of allTools()) {
    if (seen.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
    seen.add(tool.name);
  }
}
