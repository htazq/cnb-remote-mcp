import { defineTool, jsonResult, type AnyTool } from "./define.js";

/** Account / identity tools. */

export const whoami = defineTool({
  name: "whoami",
  meta: { group: "account", title: "Get current CNB user" },
  description:
    "Return the CNB user that the upstream token belongs to. Use this first to verify authentication works.",
  schema: {},
  handler: async (_args, ctx) => {
    const user = await ctx.client.get("/user");
    return jsonResult(user);
  },
});

export const accountTools: AnyTool[] = [whoami];
