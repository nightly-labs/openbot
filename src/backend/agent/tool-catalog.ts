import { sourceText } from "@openbot/i18n/source";
import { z } from "zod";
import { BROWSER_DYNAMIC_TOOLS, OPENBOT_BROWSER_NAMESPACE } from "../browser-tools";
import { OPENBOT_DYNAMIC_TOOLS, OPENBOT_TOOL_DEFINITIONS } from "../openbot-tools";
import type { DynamicToolCallParams } from "../protocol";
import { advertisedJsonSchema } from "./advertised-json-schema";
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
  "routine_report_failure",
  "remember",
  "forget_memory",
  "react_to_user_message",
  "request_api_key",
]);

const BROWSER_SCRIPT_TOOL = requireTool(`${OPENBOT_BROWSER_NAMESPACE}.run_script`);

// Names keep the complete, stable catalog below 4,000 characters without schema duplication.
const INITIAL_TOOL_CATALOG = BUILTIN_TOOL_CATALOG.map((tool) => tool.name).join(", ");
const qualifiedName = z.string().trim().min(1).max(160);
const searchQuery = z.string().trim().min(1).max(200);
// Models often send one query string, so search accepts `query` as well as `queries`.
const searchShape = {
  queries: z.array(searchQuery).min(1).max(10).optional(),
  query: searchQuery.optional(),
  limit: z.number().int().min(1).max(10).optional(),
};
// Models often send one name, and a rejected call costs a model step, so describe accepts `name` as well as `names`.
const describeShape = { names: z.array(qualifiedName).min(1).max(10).optional(), name: qualifiedName.optional() };
// Claude's bundled schema converter does not support the current Zod record processor, and Muse
// rejects recursive schemas. Arguments arrive as JSON, and the target tool validates them.
const callShape = { name: qualifiedName, arguments: z.object({}).catchall(z.unknown()) };
const searchSchema = z
  .strictObject(searchShape)
  .refine((input) => input.queries !== undefined || input.query !== undefined);
const describeSchema = z
  .strictObject(describeShape)
  .refine((input) => input.names !== undefined || input.name !== undefined);
const callSchema = z.strictObject(callShape);

export const VISIBLE_TOOL_DEFINITIONS = [
  ...OPENBOT_TOOL_DEFINITIONS.filter((tool) => DIRECT_NAMES.has(tool.name)),
  {
    name: "tool_search",
    description: `Find built-in tools by keywords or qualified name. Pass queries (an array) or query (one string). Returns names and short descriptions, default 5, maximum 10. The strongest matches also include inputSchema and guidance, ready for tool_call. Describe other results before first use. Catalog: ${INITIAL_TOOL_CATALOG}`,
    shape: searchShape,
  },
  {
    name: "tool_describe",
    description: "Load schemas and guidance for up to ten qualified tool names. Pass names, or one name.",
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
    description: "OpenBot tools. Search, then call other built-in and browser tools.",
    tools: VISIBLE_TOOL_DEFINITIONS.map((definition) => ({
      type: "function" as const,
      name: definition.name,
      description: definition.description,
      inputSchema: advertisedJsonSchema(z.strictObject(definition.shape)),
    })),
  },
];

/**
 * Claude names a bridge call `mcp__openbot__tool_call`. Readers of its items get the name of the tool it
 * calls, in the form Claude gives a direct tool. A name outside the catalog is model text and stays out.
 */
export function claudeBridgedToolName(name: string, input: unknown): string {
  if (name !== "mcp__openbot__tool_call" || typeof input !== "object" || input === null || !("name" in input))
    return name;
  const entry = BUILTIN_TOOL_CATALOG.find((tool) => tool.name === input.name);
  return entry ? `mcp__${entry.namespace}__${entry.tool}` : name;
}

/**
 * Search matches whole words, so a query that names a web service, such as "gmail" or "read mail",
 * finds no browser tool. Without this note the agent reports that it has no tool for that service.
 */
const BROWSER_SEARCH_NOTE =
  "No browser tool is in these results. A website or web app with no dedicated tool, such as mail or a calendar, is reached through openbot_browser. Call openbot_browser.list_tabs first: your signed-in tabs stay open across sessions.";

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Each step to describe a tool sends the full context again, so search includes the schemas of its best matches. */
const READY_SEARCH_RESULTS = 3;

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

/** The lowercase queries of a tool search and their words, or `null` for invalid arguments. */
function searchTerms(params: DynamicToolCallParams) {
  const parsed = searchSchema.safeParse(params.arguments);
  if (!parsed.success) return null;
  const queries = [...(parsed.data.queries ?? []), ...(parsed.data.query ? [parsed.data.query] : [])].map((query) =>
    query.toLowerCase(),
  );
  return { queries, terms: new Set(queries.flatMap(words)), limit: parsed.data.limit };
}

/** The names that a tool search names with each of their words, such as an MCP server's name. */
export function namesInSearch(params: DynamicToolCallParams, names: readonly string[]): string[] {
  const search = params.tool === "tool_search" ? searchTerms(params) : null;
  if (!search) return [];
  return names.filter((name) => {
    const nameWords = words(name);
    return nameWords.length > 0 && nameWords.every((word) => search.terms.has(word));
  });
}

function toolGuidanceFor(entries: readonly (typeof BUILTIN_TOOL_CATALOG)[number][]): string[] {
  return [...new Set(entries.flatMap((entry) => toolGuidance(entry.namespace, entry.tool)))];
}

export function discoverTools(params: DynamicToolCallParams) {
  if (params.tool === "tool_search") {
    const search = searchTerms(params);
    if (!search) throw new Error(sourceText("error.agent.toolRequestInvalid"));
    const { queries, terms } = search;
    const matches = BUILTIN_TOOL_CATALOG.map((entry, index) => {
      const nameWords = new Set(words(entry.name));
      const descriptionWords = new Set(words(entry.description));
      const exact = queries.some((query) => query === entry.name || query === entry.tool);
      // A strong result matches each word of its tool name. Namespace words, such as "browser", match a whole
      // namespace, and one shared verb, such as "read", matches many unrelated tools.
      const strong = exact || words(entry.tool).every((word) => terms.has(word));
      const score = [...terms].reduce(
        (sum, term) => sum + (nameWords.has(term) ? 3 : descriptionWords.has(term) ? 1 : 0),
        0,
      );
      return { entry, index, exact, strong, score };
    })
      .filter((result) => result.exact || result.score > 0)
      .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || a.index - b.index);
    const found = matches.slice(0, search.limit ?? 5).map(({ entry, strong }) => ({ entry, strong }));
    const ready = new Set(
      found
        .filter((result) => result.strong)
        .slice(0, READY_SEARCH_RESULTS)
        .map(({ entry }) => entry),
    );
    // Agents search for the single actions that they know, such as click and navigate, and then use
    // one model turn per action. A browser result therefore always brings the multi-step tool.
    if ([...ready].some((entry) => entry.namespace === OPENBOT_BROWSER_NAMESPACE)) {
      if (!found.some(({ entry }) => entry === BROWSER_SCRIPT_TOOL))
        found.push({ entry: BROWSER_SCRIPT_TOOL, strong: true });
      ready.add(BROWSER_SCRIPT_TOOL);
    }
    const tools = found.map(({ entry }) =>
      ready.has(entry)
        ? { name: entry.name, description: entry.description, inputSchema: entry.inputSchema }
        : { name: entry.name, description: entry.description.slice(0, 180) },
    );
    const guidance = toolGuidanceFor([...ready]);
    const result = guidance.length > 0 ? { tools, guidance } : { tools };
    return found.some(({ entry }) => entry.namespace === OPENBOT_BROWSER_NAMESPACE)
      ? result
      : { ...result, note: BROWSER_SEARCH_NOTE };
  }
  const parsed = describeSchema.safeParse(params.arguments);
  if (!parsed.success) throw new Error(sourceText("error.agent.toolRequestInvalid"));
  const names = [...(parsed.data.names ?? []), ...(parsed.data.name ? [parsed.data.name] : [])];
  const entries = [...new Set(names)].map(requireTool);
  return {
    tools: entries.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    guidance: toolGuidanceFor(entries),
  };
}
