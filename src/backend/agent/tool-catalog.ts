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
  "ask_ui",
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
  "suggest_marketplace_app",
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
// rejects recursive schemas. Arguments arrive as JSON, and the target tool validates them. Models
// sometimes send the qualified name as `tool`, and a rejected call costs a model step. The catalog
// lookup checks the alias, so its schema stays short.
const callShape = {
  name: qualifiedName.optional(),
  tool: z.string().optional(),
  arguments: z.object({}).catchall(z.unknown()),
};
const searchSchema = z
  .strictObject(searchShape)
  .refine((input) => input.queries !== undefined || input.query !== undefined);
const describeSchema = z
  .strictObject(describeShape)
  .refine((input) => input.names !== undefined || input.name !== undefined);
const callSchema = z.strictObject(callShape).refine((input) => input.name !== undefined || input.tool !== undefined);

export const VISIBLE_TOOL_DEFINITIONS = [
  ...OPENBOT_TOOL_DEFINITIONS.filter((tool) => DIRECT_NAMES.has(tool.name)),
  {
    name: "tool_search",
    description: `Find built-in tools by keywords or qualified name: queries (array) or query. Returns short descriptions, default 5, max 10; the best matches also give inputSchema and guidance. Run found tools with tool_call, not directly. Describe others before use. Catalog: ${INITIAL_TOOL_CATALOG}`,
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
  if (name !== "mcp__openbot__tool_call") return name;
  const called = bridgedName(input);
  const entry = called ? BUILTIN_TOOL_CATALOG.find((tool) => tool.name === called) : undefined;
  return entry ? `mcp__${entry.namespace}__${entry.tool}` : name;
}

/** The qualified name in the arguments of a `tool_call`, from `name` or its alias `tool`. */
function bridgedName(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const name = "name" in input ? input.name : "tool" in input ? input.tool : null;
  return typeof name === "string" ? name : null;
}

/**
 * Claude loads its own deferred tools with a search and then calls them directly. After a search here,
 * it called openbot.list_workflows as mcp__openbot__list_workflows, and each refused name cost a model step.
 */
const CALL_NOTE = "These are not direct tools: run each with tool_call {name, arguments}.";

/**
 * Search matches whole words, so a query that names a web service, such as "gmail" or "read mail",
 * finds no browser tool. Without this note the agent reports that it has no tool for that service.
 */
const BROWSER_SEARCH_NOTE =
  "No browser tool is in these results. A website or web app with no dedicated tool, such as mail or a calendar, is reached through openbot_browser. Call openbot_browser.list_tabs first: your signed-in tabs stay open across sessions.";

/**
 * Pi declares the tools of the user's MCP servers only after its own `tool_search` loads them. A model
 * that searches here instead finds none of them, and tool_call refuses their names (#4410).
 */
export const DEFERRED_MCP_NOTE =
  "The tools of the MCP servers in <mcp_servers> are not in this catalog. Load them with the separate tool named exactly tool_search, then call them directly by their mcp__ names.";

/**
 * Codex defers the tools of the user's MCP servers, except Computer Use (#4468): behind its own
 * `tool_search`, or, for a code-mode-only model, into `ALL_TOOLS` in `exec`.
 */
export const CODEX_DEFERRED_MCP_NOTE =
  "The tools of your MCP servers are not in this catalog. Find them with the separate tool named exactly tool_search. When you have exec instead, read ALL_TOOLS in an exec cell, where MCP tool names start with mcp__, and call the tool on tools.";

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Each step to describe a tool sends the full context again, so search includes the schemas of its best matches. */
const READY_SEARCH_RESULTS = 3;

/**
 * A search that names a workflow makes every workflow tool ready, and only them: an agent that builds
 * a workflow also edits, runs, reads and deletes it. A routine is not a workflow step, so a query
 * such as "create workflow routine" does not also load the routine schemas and guidance.
 */
const WORKFLOW_WORDS = new Set(["workflow", "workflows"]);
const WORKFLOW_TOOLS = BUILTIN_TOOL_CATALOG.filter(
  (entry) =>
    entry.namespace === OPENBOT_DYNAMIC_TOOLS.name && words(entry.tool).some((word) => WORKFLOW_WORDS.has(word)),
);

/**
 * The browser tools that most tasks use. An agent calls a browser tool without a search, because the
 * names are in its instructions, so the first browser result in a chat brings these schemas. A search
 * first cost one model turn on each browser task.
 */
const BROWSER_PRIMER_TOOLS = ["open", "snapshot", "navigate", "click", "type", "wait_for", "run_script"].map((tool) =>
  requireTool(`${OPENBOT_BROWSER_NAMESPACE}.${tool}`),
);

export function browserToolsPrimer() {
  return {
    call: CALL_NOTE,
    tools: BROWSER_PRIMER_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    guidance: toolGuidanceFor(BROWSER_PRIMER_TOOLS),
  };
}

/** True when a search or describe result gave the agent browser schemas and their guidance. */
export function givesBrowserSchemas(result: ReturnType<typeof discoverTools>): boolean {
  return result.tools.some((tool) => "inputSchema" in tool && tool.name.startsWith(`${OPENBOT_BROWSER_NAMESPACE}.`));
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
  const name = parsed.data.name ?? parsed.data.tool;
  const entry = BUILTIN_TOOL_CATALOG.find((tool) => tool.name === name);
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
    const workflowSearch = [...terms].some((term) => WORKFLOW_WORDS.has(term));
    if (workflowSearch) {
      // A tool that a query names exactly keeps its schema; other ready results, such as routines, go.
      for (const entry of ready)
        if (!matches.some((match) => match.entry === entry && match.exact)) ready.delete(entry);
      for (const entry of WORKFLOW_TOOLS) {
        if (!found.some((result) => result.entry === entry)) found.push({ entry, strong: true });
        ready.add(entry);
      }
    }
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
    const result = {
      ...(ready.size > 0 ? { call: CALL_NOTE } : {}),
      tools,
      ...(guidance.length > 0 ? { guidance } : {}),
    };
    // A workflow search asks for OpenBot's own workflows, not for a website.
    return workflowSearch || found.some(({ entry }) => entry.namespace === OPENBOT_BROWSER_NAMESPACE)
      ? result
      : { ...result, note: BROWSER_SEARCH_NOTE };
  }
  const parsed = describeSchema.safeParse(params.arguments);
  if (!parsed.success) throw new Error(sourceText("error.agent.toolRequestInvalid"));
  const names = [...(parsed.data.names ?? []), ...(parsed.data.name ? [parsed.data.name] : [])];
  const entries = [...new Set(names)].map(requireTool);
  return {
    call: CALL_NOTE,
    tools: entries.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    guidance: toolGuidanceFor(entries),
  };
}
