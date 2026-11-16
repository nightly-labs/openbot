import type { AgentProviderId } from "@openbot/contracts/agent-providers";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { z } from "zod";
import { BROWSER_DYNAMIC_TOOLS, BROWSER_TOOL_DEFINITIONS, OPENBOT_BROWSER_NAMESPACE } from "../browser-tools";
import { OPENBOT_DYNAMIC_TOOLS, OPENBOT_TOOL_DEFINITIONS } from "../openbot-tools";
import { type DynamicToolCallParams, isRecord } from "../protocol";
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

/**
 * The browser tools that each agent has directly. Haiku searched the catalog before 29 of 30 browser
 * tasks, also when its instructions named the tool, and each search cost a model turn of the full
 * context (`bun run bench:browser-tools`, 2026-11-10). The first result of a browser tool brings the
 * schemas of the others (`browserToolsPrimer`).
 */
const DIRECT_BROWSER_NAMES: ReadonlySet<string> = new Set(["open", "list_tabs", "run_script"]);

/** The direct browser tools, as Claude's in-process MCP server declares them. */
export const DIRECT_BROWSER_TOOL_DEFINITIONS = BROWSER_TOOL_DEFINITIONS.filter((definition) =>
  DIRECT_BROWSER_NAMES.has(definition.name),
);

const DIRECT_BROWSER_DYNAMIC_TOOLS = BROWSER_DYNAMIC_TOOLS.map((namespace) => ({
  ...namespace,
  description: "OpenBot's private, persistent browser. Run the other openbot_browser tools with openbot.tool_call.",
  tools: namespace.tools.filter((tool) => DIRECT_BROWSER_NAMES.has(tool.name)),
}));

/**
 * Providers whose CLI gives the model a web search tool of its own. Their agents keep it, and do not
 * get `openbot.web_search`: on Codex the side search costs about the same tokens and takes twice as
 * long as the inline search (`bun run bench:codex-web-search`). The Pi-based providers have no web search,
 * and a custom ACP agent can have none, so they get the tool. Some CLIs need a condition that the OpenBot
 * sign-in meets: an Anthropic or Grok account, `kimi login`, a Mistral key, the Cline account. OpenCode
 * asks once for consent and then searches without a key.
 */
const OWN_WEB_SEARCH_PROVIDERS: ReadonlySet<AgentProviderId> = new Set([
  "codex",
  "claude",
  "grok",
  "opencode",
  "antigravity",
  "cursor",
  "cline",
  "muse",
  "hermes",
  "kimi",
  "devin",
  "copilot",
  "mistral",
]);
const OWN_WEB_SEARCH_CATALOG = BUILTIN_TOOL_CATALOG.filter(
  (tool) => tool.name !== `${OPENBOT_DYNAMIC_TOOLS.name}.web_search`,
);

/** The deferred tools of an agent on `provider`. */
function catalogFor(provider: AgentProviderId) {
  return OWN_WEB_SEARCH_PROVIDERS.has(provider) ? OWN_WEB_SEARCH_CATALOG : BUILTIN_TOOL_CATALOG;
}

/**
 * The names of the catalog tools, grouped by namespace, such as `openbot.{list_tables, query_data}`. Names
 * give a complete, stable list without schemas; the group form keeps each name qualified and does not
 * repeat the namespace for each tool. Direct tools stay in it: a provider can hide some of them, such as
 * Pi with `request_api_key`.
 */
function catalogNames(catalog: typeof BUILTIN_TOOL_CATALOG): string {
  const groups = new Map<string, string[]>();
  for (const tool of catalog) groups.set(tool.namespace, [...(groups.get(tool.namespace) ?? []), tool.tool]);
  return [...groups].map(([namespace, tools]) => `${namespace}.{${tools.join(", ")}}`).join("; ");
}

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

/**
 * Kimi Code CLI gives each schema without a `type` the type `string` before its model reads it, so its
 * model sent numbers and arrays in `arguments` as strings, and the target tool refused them (#5742). It
 * leaves an `anyOf` as it is. Moonshot refuses a `type` next to `anyOf` and, as Hermes found, a `null`
 * branch; the call still decodes with `callSchema`, which accepts any value.
 */
const KIMI_ARGUMENT_VALUE = { anyOf: ["string", "number", "boolean", "object", "array"].map((type) => ({ type })) };
// On the value schema, Zod writes this `anyOf` as a `type` array. Moonshot takes only one type, or one
// type and `null`, in a `type` array.
const kimiCallShape = {
  ...callShape,
  arguments: callShape.arguments.meta({ additionalProperties: KIMI_ARGUMENT_VALUE }),
};

function toolDefinitions(catalog: typeof BUILTIN_TOOL_CATALOG) {
  const names = catalogNames(catalog);
  return [
    ...OPENBOT_TOOL_DEFINITIONS.filter((tool) => DIRECT_NAMES.has(tool.name)),
    {
      name: "tool_search",
      description: `Find built-in tools by keywords or qualified name: queries (array) or query. Returns short descriptions, default 5, max 10; the best matches also give inputSchema and guidance. Run found tools with tool_call, not directly. Describe others before use. Catalog: ${names}`,
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
}

function dynamicTools(definitions: ReturnType<typeof toolDefinitions>) {
  return [
    {
      type: "namespace" as const,
      name: "openbot",
      description: "OpenBot tools. Search, then call other built-in and browser tools.",
      tools: definitions.map((definition) => ({
        type: "function" as const,
        name: definition.name,
        description: definition.description,
        inputSchema: advertisedJsonSchema(z.strictObject(definition.shape)),
      })),
    },
    ...DIRECT_BROWSER_DYNAMIC_TOOLS,
  ];
}

const ALL_TOOL_DEFINITIONS = toolDefinitions(BUILTIN_TOOL_CATALOG);
const OWN_WEB_SEARCH_TOOL_DEFINITIONS = toolDefinitions(OWN_WEB_SEARCH_CATALOG);
const ALL_DYNAMIC_TOOLS = dynamicTools(ALL_TOOL_DEFINITIONS);
const OWN_WEB_SEARCH_DYNAMIC_TOOLS = dynamicTools(OWN_WEB_SEARCH_TOOL_DEFINITIONS);
const KIMI_DYNAMIC_TOOLS = dynamicTools(
  visibleToolDefinitions("kimi").map((definition) =>
    definition.name === "tool_call" ? { ...definition, shape: kimiCallShape } : definition,
  ),
);

/** The direct OpenBot tools of an agent on `provider`, as an MCP server declares them. */
export function visibleToolDefinitions(provider: AgentProviderId) {
  return OWN_WEB_SEARCH_PROVIDERS.has(provider) ? OWN_WEB_SEARCH_TOOL_DEFINITIONS : ALL_TOOL_DEFINITIONS;
}

/** The direct OpenBot tools of an agent on `provider`, as the dynamic tools of a thread. */
export function visibleDynamicTools(provider: AgentProviderId) {
  if (provider === "kimi") return KIMI_DYNAMIC_TOOLS;
  return OWN_WEB_SEARCH_PROVIDERS.has(provider) ? OWN_WEB_SEARCH_DYNAMIC_TOOLS : ALL_DYNAMIC_TOOLS;
}

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
const CALL_NOTE =
  "Run each with openbot.tool_call {name, arguments}, or directly when you also have it as a direct tool.";

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

/**
 * OpenCode 2.2.7 puts the tools of the user's MCP servers only in `execute`, and lists only some
 * tools of a large server there (#7097).
 */
export const OPENCODE_DEFERRED_MCP_NOTE =
  "The tools of your MCP servers are not in this catalog. They are in execute: when one is not listed there, find it with search(...) inside execute and call the path that it returns.";

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
/**
 * The release notes call the board of the Workflows page the Canvas, so users ask an agent for a
 * canvas. Without these words a search found no workflow tool, and the agent said that it could not
 * make one (#9367). A canvas can also be the Routines canvas or a canvas on a web page, so these words
 * add the workflow tools and keep the other results.
 */
const CANVAS_WORDS = new Set(["canvas", "canvases"]);
const WORKFLOW_TOOLS = BUILTIN_TOOL_CATALOG.filter(
  (entry) =>
    entry.namespace === OPENBOT_DYNAMIC_TOOLS.name && words(entry.tool).some((word) => WORKFLOW_WORDS.has(word)),
);

/**
 * The browser tools that most tasks use. The first browser result in a chat brings these schemas, and
 * the guidance of the browser and of the direct browser tools. A search first cost one model turn on
 * each browser task.
 */
const BROWSER_PRIMER_TOOLS = ["snapshot", "navigate", "click", "type", "wait_for"].map((tool) =>
  requireTool(`${OPENBOT_BROWSER_NAMESPACE}.${tool}`),
);
const DIRECT_BROWSER_CATALOG = [...DIRECT_BROWSER_NAMES].map((tool) =>
  requireTool(`${OPENBOT_BROWSER_NAMESPACE}.${tool}`),
);

export function browserToolsPrimer() {
  return {
    call: CALL_NOTE,
    tools: BROWSER_PRIMER_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    guidance: toolGuidanceFor([...BROWSER_PRIMER_TOOLS, ...DIRECT_BROWSER_CATALOG]),
  };
}

/** True when a search or describe result gave the agent browser schemas and their guidance. */
export function givesBrowserSchemas(result: ReturnType<typeof discoverTools>): boolean {
  return result.tools.some((tool) => "inputSchema" in tool && tool.name.startsWith(`${OPENBOT_BROWSER_NAMESPACE}.`));
}

function requireTool(name: string, catalog = BUILTIN_TOOL_CATALOG) {
  const tool = catalog.find((entry) => entry.name === name);
  if (!tool) throw new Error(sourceText("error.agent.toolRequestInvalid"));
  return tool;
}

const JSON_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t"]);
const PATH_ESCAPES = new Set(["b", "f", "n", "r", "t"]);

function startsUnicodeEscape(text: string, index: number): boolean {
  return text.charAt(index + 1) === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(index + 2, index + 6));
}

/**
 * The end of the word at `start`, up to a space or a quote, and whether it holds an escaped backslash
 * or a backslash that starts no valid escape, as a path such as `C:\Users` does. In such a word, `\n` or
 * `\t` is part of the path, such as `C:\new`.
 */
function pathWord(text: string, start: number): { end: number; path: boolean } {
  let index = start;
  let path = false;
  while (index < text.length && !/[\s"]/.test(text.charAt(index))) {
    if (text.charAt(index) === "\\") {
      const next = text.charAt(index + 1);
      if (next === "\\" || (!JSON_ESCAPES.has(next) && !startsUnicodeEscape(text, index))) path = true;
      index++;
    }
    index++;
  }
  return { end: index, path };
}

/**
 * Inside the strings of JSON text, escapes each control character and each backslash that does not
 * start a valid escape. In a word with such a backslash, it also escapes the backslash of `\b`, `\f`,
 * `\n`, `\r` and `\t`. Models write a Windows path such as `C:\Users` or a line break in `arguments`
 * text without the escape that JSON needs, so the text did not parse (#6243).
 */
function repairJsonText(text: string): string {
  let repaired = "";
  let inString = false;
  let word = { end: 0, path: false };
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (char === '"') inString = !inString;
    if (inString && index >= word.end) word = pathWord(text, index);
    if (!inString || char === '"') {
      repaired += char;
    } else if (char === "\\") {
      const next = text.charAt(index + 1);
      const path = word.path && PATH_ESCAPES.has(next);
      if (!path && (JSON_ESCAPES.has(next) || startsUnicodeEscape(text, index))) {
        repaired += char + next;
        index++;
      } else {
        repaired += "\\\\";
      }
    } else {
      const code = char.charCodeAt(0);
      repaired += code < 0x20 ? `\\u${code.toString(16).padStart(4, "0")}` : char;
    }
  }
  return repaired;
}

/**
 * The text without up to three closing braces and quotes after its end. Models close the envelope in
 * the `arguments` text, as in `{"tabId":"t1"}}` or `{"tabId":"t1"}"}`, so the text did not parse.
 */
function withoutTrailingClosers(text: string): string[] {
  const trimmed = text.trimEnd();
  const closers = /[}"\s]{1,3}$/u.exec(trimmed)?.[0].length ?? 0;
  return Array.from({ length: closers }, (_, index) => trimmed.slice(0, trimmed.length - index - 1));
}

/** The object in `arguments` text, also after a repair, or null when the text holds no object. */
function decodeArgumentsText(text: string): DynamicRecord | null {
  const trimmed = withoutTrailingClosers(text);
  for (const candidate of [text, repairJsonText(text), ...trimmed, ...trimmed.map(repairJsonText)]) {
    try {
      const value = JSON.parse(candidate);
      return isRecord(value) ? value : null;
    } catch {
      // The repaired text is tried next.
    }
  }
  return null;
}

/** Decodes a `tool_call` envelope. Models send `arguments` as JSON text, so the text is decoded first. */
function parseCall(params: DynamicToolCallParams) {
  const envelope = params.arguments;
  if (!isRecord(envelope) || typeof envelope.arguments !== "string") return callSchema.safeParse(envelope);
  return callSchema.safeParse({ ...envelope, arguments: decodeArgumentsText(envelope.arguments) });
}

/**
 * True when a `tool_call` names OpenBot's discovery tool, such as `openbot.tool_describe`. Only a qualified
 * name counts: a bare `tool_search` can mean the provider's own search for MCP tools.
 */
function callsDiscoveryTool(envelope: unknown): boolean {
  const named = bridgedName(envelope)?.trim();
  return named !== undefined && /^(?:openbot\.|openbot__|mcp__openbot__)tool_(?:search|describe)$/.test(named);
}

/**
 * The error for a `tool_call` that `resolveDeferredTool` refused because it names a discovery tool or
 * its `arguments` is not an object, or null for another reason. A general error made the agent send
 * the same text again: an agent that loaded a schema through tool_call never got it (#6754).
 */
export function deferredCallArgumentsError(params: DynamicToolCallParams): string | null {
  if (callsDiscoveryTool(params.arguments)) return sourceText("error.agent.toolCallDiscoveryTool");
  const parsed = parseCall(params);
  const sent = isRecord(params.arguments) && params.arguments.arguments !== undefined;
  return sent && !parsed.success && parsed.error.issues.some(({ path }) => path[0] === "arguments")
    ? sourceText("error.agent.toolCallArgumentsNotObject")
    : null;
}

/**
 * Returns null for an invalid envelope or a tool outside the catalog of `provider`. No supplied
 * values are echoed into errors or logs.
 */
export function resolveDeferredTool(
  params: DynamicToolCallParams,
  provider: AgentProviderId,
): DynamicToolCallParams | null {
  const parsed = parseCall(params);
  if (!parsed.success) return null;
  const name = parsed.data.name ?? parsed.data.tool;
  const entry = catalogFor(provider).find((tool) => tool.name === name);
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

export function discoverTools(params: DynamicToolCallParams, provider: AgentProviderId) {
  const catalog = catalogFor(provider);
  if (params.tool === "tool_search") {
    const search = searchTerms(params);
    if (!search) throw new Error(sourceText("error.agent.toolRequestInvalid"));
    const { queries, terms } = search;
    const matches = catalog
      .map((entry, index) => {
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
    if (workflowSearch)
      // A tool that a query names exactly keeps its schema; other ready results, such as routines, go.
      for (const entry of ready)
        if (!matches.some((match) => match.entry === entry && match.exact)) ready.delete(entry);
    if (workflowSearch || [...terms].some((term) => CANVAS_WORDS.has(term))) {
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
  const entries = [...new Set(names)].map((name) => requireTool(name, catalog));
  return {
    call: CALL_NOTE,
    tools: entries.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    guidance: toolGuidanceFor(entries),
  };
}
