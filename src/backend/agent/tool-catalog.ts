import type { AgentSummary } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { z } from "zod";
import { BROWSER_DYNAMIC_TOOLS } from "../browser-tools";
import { OPENBOT_DYNAMIC_TOOLS, OPENBOT_TOOL_DEFINITIONS } from "../openbot-tools";
import type { DynamicToolCallParams } from "../protocol";
import { toolGuidance } from "./tool-guidance";

/** Discovery changes visibility only. Original definitions and execution owners stay authoritative. */
export const BUILTIN_TOOL_CATALOG = [OPENBOT_DYNAMIC_TOOLS, ...BROWSER_DYNAMIC_TOOLS].flatMap((namespace) =>
  namespace.tools.map((tool) => ({
    namespace: namespace.name,
    tool: tool.name,
    name: `${namespace.name}.${tool.name}`,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })),
);

const DIRECT_NAMES = new Set([
  "ask_user",
  "attach_files_to_response",
  "list_agents",
  "send_message",
  "search_memories",
  "routine_no_update",
  "remember",
  "forget_memory",
  "react_to_user_message",
]);

// Names keep the complete, stable catalog below 4,000 characters without schema duplication.
const INITIAL_TOOL_CATALOG = BUILTIN_TOOL_CATALOG.map((tool) => tool.name).join(", ");
const qualifiedName = z.string().trim().min(1).max(160);
const searchShape = {
  queries: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
  limit: z.number().int().min(1).max(10).optional(),
};
const describeShape = { names: z.array(qualifiedName).min(1).max(10) };
// Claude's bundled schema converter does not support the current Zod record processor.
// An object catchall has the same JSON value contract and works at both MCP boundaries.
const jsonValue: z.ZodType<z.infer<ReturnType<typeof z.json>>> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.object({}).catchall(jsonValue)]),
);
const callShape = { name: qualifiedName, arguments: z.object({}).catchall(jsonValue) };
const searchSchema = z.strictObject(searchShape);
const describeSchema = z.strictObject(describeShape);
const callSchema = z.strictObject(callShape);

export const VISIBLE_TOOL_DEFINITIONS = [
  ...OPENBOT_TOOL_DEFINITIONS.filter((tool) => DIRECT_NAMES.has(tool.name)),
  {
    name: "tool_search",
    description: `Find built-in tools by keywords or qualified name. Returns names and short descriptions, default 5, maximum 10. Describe a result before first use. Catalog: ${INITIAL_TOOL_CATALOG}`,
    shape: searchShape,
  },
  {
    name: "tool_describe",
    description: "Load exact input schemas and operating guidance for up to ten qualified built-in tool names.",
    shape: describeShape,
  },
  {
    name: "tool_call",
    description:
      "Call one original built-in tool by its qualified name and JSON arguments. Uses normal permissions and approvals. Cannot call discovery tools.",
    shape: callShape,
  },
];

export const VISIBLE_DYNAMIC_TOOLS = [
  {
    type: "namespace" as const,
    name: "openbot",
    description: "OpenBot tools. Search, describe, then call other built-in and browser capabilities.",
    tools: VISIBLE_TOOL_DEFINITIONS.map((definition) => ({
      type: "function" as const,
      name: definition.name,
      description: definition.description,
      inputSchema: z.toJSONSchema(z.strictObject(definition.shape), { target: "draft-7" }),
    })),
  },
];

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function requireTool(name: string) {
  const tool = BUILTIN_TOOL_CATALOG.find((entry) => entry.name === name);
  if (!tool) throw new Error(sourceText("error.agent.toolRequestInvalid"));
  return tool;
}

/** Returns null for an invalid envelope. No supplied values are echoed into errors or logs. */
export function resolveDeferredTool(params: DynamicToolCallParams): DynamicToolCallParams | null {
  const parsed = callSchema.safeParse(params.arguments);
  if (!parsed.success) return null;
  const entry = BUILTIN_TOOL_CATALOG.find((tool) => tool.name === parsed.data.name);
  if (!entry) return null;
  return { ...params, namespace: entry.namespace, tool: entry.tool, arguments: parsed.data.arguments };
}

export function discoverTools(params: DynamicToolCallParams, agent: AgentSummary) {
  if (params.tool === "tool_search") {
    const parsed = searchSchema.safeParse(params.arguments);
    if (!parsed.success) throw new Error(sourceText("error.agent.toolRequestInvalid"));
    const queries = parsed.data.queries.map((query) => query.toLowerCase());
    const terms = new Set(queries.flatMap(words));
    const results = BUILTIN_TOOL_CATALOG.map((entry, index) => {
      const nameWords = new Set(words(entry.name));
      const descriptionWords = new Set(words(entry.description));
      const exact = queries.some((query) => query === entry.name || query === entry.tool);
      const score = [...terms].reduce(
        (sum, term) => sum + (nameWords.has(term) ? 3 : descriptionWords.has(term) ? 1 : 0),
        0,
      );
      return { entry, index, exact, score };
    })
      .filter((result) => result.exact || result.score > 0)
      .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || a.index - b.index)
      .slice(0, parsed.data.limit ?? 5)
      .map(({ entry }) => ({ name: entry.name, description: entry.description.slice(0, 180) }));
    return { tools: results };
  }
  const parsed = describeSchema.safeParse(params.arguments);
  if (!parsed.success) throw new Error(sourceText("error.agent.toolRequestInvalid"));
  const entries = [...new Set(parsed.data.names)].map(requireTool);
  return {
    tools: entries.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    guidance: [...new Set(entries.map((entry) => toolGuidance(entry.namespace, entry.tool, agent)))].filter(Boolean),
  };
}
