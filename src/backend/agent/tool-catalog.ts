import type { AgentProviderId } from "@openbot/contracts/agent-providers";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { z } from "zod";
import { BROWSER_DYNAMIC_TOOLS, BROWSER_TOOL_DEFINITIONS, OPENBOT_BROWSER_NAMESPACE } from "../browser-tools";
import { CHANNEL_TOOL_DEFINITIONS } from "../channel-tools";
import type { DynamicToolNamespace } from "../local-mcp-bridge";
import { OPENBOT_DYNAMIC_TOOLS, OPENBOT_TOOL_DEFINITIONS } from "../openbot-tools";
import { type DynamicToolCallParams, isRecord, qualifiedToolName } from "../protocol";
import { advertisedJsonSchema } from "./advertised-json-schema";
import { nullStructuredItemPaths, withSchemaTypes } from "./schema-typed-arguments";
import { toolGuidance } from "./tool-guidance";

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
  "get_provider_usage",
  "send_message",
  "start_task",
  "message_task",
  "close_task",
  "search_memories",
  "routine_no_update",
  "routine_report_failure",
  "remember",
  "forget_memory",
  "react_to_user_message",
  "request_api_key",
  "suggest_marketplace_app",
  "generate_image",
  "generate_video",
]);

const BROWSER_SCRIPT_TOOL = requireTool(`${OPENBOT_BROWSER_NAMESPACE}.run_script`);

const DIRECT_BROWSER_NAMES: ReadonlySet<string> = new Set(["open", "list_tabs", "run_script"]);

export const DIRECT_BROWSER_TOOL_DEFINITIONS = BROWSER_TOOL_DEFINITIONS.filter((definition) =>
  DIRECT_BROWSER_NAMES.has(definition.name),
);

const DIRECT_BROWSER_DYNAMIC_TOOLS = BROWSER_DYNAMIC_TOOLS.map((namespace) => ({
  ...namespace,
  description: "OpenBot's private, persistent browser. Run the other openbot_browser tools with openbot.tool_call.",
  tools: namespace.tools.filter((tool) => DIRECT_BROWSER_NAMES.has(tool.name)),
}));

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

function catalogFor(provider: AgentProviderId) {
  return OWN_WEB_SEARCH_PROVIDERS.has(provider) ? OWN_WEB_SEARCH_CATALOG : BUILTIN_TOOL_CATALOG;
}

function catalogNames(catalog: typeof BUILTIN_TOOL_CATALOG): string {
  const groups = new Map<string, string[]>();
  for (const tool of catalog) groups.set(tool.namespace, [...(groups.get(tool.namespace) ?? []), tool.tool]);
  return [...groups].map(([namespace, tools]) => `${namespace}.{${tools.join(", ")}}`).join("; ");
}

const qualifiedName = z.string().trim().min(1).max(160);
const searchQuery = z.string().trim().min(1).max(200);
const searchShape = {
  queries: z.array(searchQuery).min(1).max(10).optional(),
  query: searchQuery.optional(),
  limit: z.number().int().min(1).max(10).optional(),
};
const describeShape = { names: z.array(qualifiedName).min(1).max(10).optional(), name: qualifiedName.optional() };
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

const KIMI_ARGUMENT_VALUE = { anyOf: ["string", "number", "boolean", "object", "array"].map((type) => ({ type })) };
const kimiCallShape = {
  ...callShape,
  arguments: callShape.arguments.meta({ additionalProperties: KIMI_ARGUMENT_VALUE }),
};

const TOOL_SEARCH_DESCRIPTION =
  "Find built-in tools by keywords or qualified name: queries (array) or query. Returns short descriptions, default 5, max 10; the best matches also give inputSchema and guidance. Run found tools with tool_call, not directly. Describe others before use.";

function toolDefinitions(catalog: typeof BUILTIN_TOOL_CATALOG) {
  return [
    ...OPENBOT_TOOL_DEFINITIONS.filter((tool) => DIRECT_NAMES.has(tool.name)),
    {
      name: "tool_search",
      description: `${TOOL_SEARCH_DESCRIPTION} Catalog: ${catalogNames(catalog)}`,
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
const ANTIGRAVITY_DISCOVERY_TOOLS: DynamicToolNamespace["tools"] = [
  {
    type: "function",
    name: "tool_search",
    description: "Find catalog tools by keywords.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    type: "function",
    name: "tool_describe",
    description: "Get catalog tool schemas.",
    inputSchema: {
      type: "object",
      properties: { names: { type: "array", items: { type: "string" } } },
      required: ["names"],
    },
  },
  {
    type: "function",
    name: "tool_call",
    description: "Run a catalog tool.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, arguments: { type: "object", properties: {}, additionalProperties: {} } },
      required: ["name"],
    },
  },
];

const ANTIGRAVITY_DYNAMIC_TOOLS = dynamicTools(toolDefinitions(catalogFor("antigravity"))).map((namespace) =>
  namespace.name === OPENBOT_DYNAMIC_TOOLS.name
    ? {
        ...namespace,
        tools: namespace.tools.map(
          (tool) => ANTIGRAVITY_DISCOVERY_TOOLS.find((compact) => compact.name === tool.name) ?? tool,
        ),
      }
    : namespace,
);

export function toolCatalogNames(provider: AgentProviderId): string {
  return catalogNames(catalogFor(provider));
}

export function visibleToolDefinitions(provider: AgentProviderId) {
  return OWN_WEB_SEARCH_PROVIDERS.has(provider) ? OWN_WEB_SEARCH_TOOL_DEFINITIONS : ALL_TOOL_DEFINITIONS;
}

export function visibleDynamicTools(provider: AgentProviderId) {
  if (provider === "kimi") return KIMI_DYNAMIC_TOOLS;
  if (provider === "antigravity") return ANTIGRAVITY_DYNAMIC_TOOLS;
  return OWN_WEB_SEARCH_PROVIDERS.has(provider) ? OWN_WEB_SEARCH_DYNAMIC_TOOLS : ALL_DYNAMIC_TOOLS;
}

function mcpCatalogTools(catalog: typeof BUILTIN_TOOL_CATALOG): Map<string, DynamicToolNamespace["tools"][number]> {
  const browserCore = new Set(toolGuidance(OPENBOT_BROWSER_NAMESPACE, "snapshot"));
  return new Map(
    catalog.map((entry) => {
      const guidance = toolGuidance(entry.namespace, entry.tool)
        .filter((section) => !browserCore.has(section))
        .join("\n");
      const inputSchema = {
        ...entry.inputSchema,
        type: "object" as const,
        ...(guidance ? { description: guidance } : {}),
      };
      return [entry.name, { type: "function" as const, name: entry.tool, description: entry.description, inputSchema }];
    }),
  );
}

const mcpCatalogs = new Map<typeof BUILTIN_TOOL_CATALOG, ReturnType<typeof mcpCatalogTools>>();

const OWN_SEARCH_TOOLS: ReadonlySet<string> = new Set(["tool_search", "tool_describe"]);

export function withCatalogTools(
  namespaces: readonly DynamicToolNamespace[],
  provider: AgentProviderId,
): DynamicToolNamespace[] {
  const catalog = catalogFor(provider);
  const tools = mcpCatalogs.get(catalog) ?? mcpCatalogTools(catalog);
  mcpCatalogs.set(catalog, tools);
  return namespaces.map((namespace) => {
    const listed = namespace.tools
      .filter((tool) => namespace.name !== OPENBOT_DYNAMIC_TOOLS.name || !OWN_SEARCH_TOOLS.has(tool.name))
      .map((tool) => tools.get(`${namespace.name}.${tool.name}`) ?? tool);
    const names = new Set(listed.map((tool) => tool.name));
    const added = catalog
      .filter((entry) => entry.namespace === namespace.name && !names.has(entry.tool))
      .flatMap((entry) => tools.get(entry.name) ?? []);
    return { ...namespace, tools: [...listed, ...added] };
  });
}

const CHANNEL_TOOL_NAMES: ReadonlySet<string> = new Set(
  CHANNEL_TOOL_DEFINITIONS.map((definition) => `${OPENBOT_DYNAMIC_TOOLS.name}.${definition.name}`),
);

export function withChannelTools(namespaces: readonly DynamicToolNamespace[]): DynamicToolNamespace[] {
  const tools = mcpCatalogs.get(BUILTIN_TOOL_CATALOG) ?? mcpCatalogTools(BUILTIN_TOOL_CATALOG);
  mcpCatalogs.set(BUILTIN_TOOL_CATALOG, tools);
  const channelTools = [...tools].flatMap(([name, tool]) => (CHANNEL_TOOL_NAMES.has(name) ? [tool] : []));
  return namespaces.map((namespace) => {
    if (namespace.name !== OPENBOT_DYNAMIC_TOOLS.name) return namespace;
    const names = new Set(namespace.tools.map((tool) => tool.name));
    return { ...namespace, tools: [...namespace.tools, ...channelTools.filter((tool) => !names.has(tool.name))] };
  });
}

export function claudeBridgedToolName(name: string, input: unknown): string {
  if (name !== "mcp__openbot__tool_call") return name;
  const called = bridgedName(input);
  const entry = called ? catalogEntry(BUILTIN_TOOL_CATALOG, called) : undefined;
  return entry ? `mcp__${entry.namespace}__${entry.tool}` : name;
}

function bridgedName(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const name = "name" in input ? input.name : "tool" in input ? input.tool : null;
  return typeof name === "string" ? name : null;
}

const CALL_NOTE =
  "Run each with openbot.tool_call {name, arguments}, or directly when you also have it as a direct tool.";

const BROWSER_SEARCH_NOTE =
  "No browser tool is in these results. A website or web app with no dedicated tool, such as mail or a calendar, is reached through openbot_browser. Call openbot_browser.list_tabs first: your signed-in tabs stay open across sessions.";

export const DEFERRED_MCP_NOTE =
  "The tools of the MCP servers in <mcp_servers> are not in this catalog. Load them with the separate tool named exactly tool_search, then call them directly by their mcp__ names.";

export const CODEX_DEFERRED_MCP_NOTE =
  "The tools of your MCP servers are not in this catalog. Find them with the separate tool named exactly tool_search. When you have exec instead, read ALL_TOOLS in an exec cell, where MCP tool names start with mcp__, and call the tool on tools.";

export const OPENCODE_DEFERRED_MCP_NOTE =
  "The tools of your MCP servers are not in this catalog. They are in execute: when one is not listed there, find it with search(...) inside execute and call the path that it returns.";

export const ANTIGRAVITY_DEFERRED_MCP_NOTE =
  'The tools of your MCP servers are not in this catalog. When one is not in your tool list, read its schema in <appDataDir>/mcp/<server>/<tool>.json and run it with openbot.tool_call: {"name":"<server>.<tool>","arguments":{...}}.';

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const READY_SEARCH_RESULTS = 3;

const WORKFLOW_WORDS = new Set(["workflow", "workflows"]);
const CANVAS_WORDS = new Set(["canvas", "canvases"]);
const WORKFLOW_TOOLS = BUILTIN_TOOL_CATALOG.filter(
  (entry) =>
    entry.namespace === OPENBOT_DYNAMIC_TOOLS.name && words(entry.tool).some((word) => WORKFLOW_WORDS.has(word)),
);

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

function withoutTrailingClosers(text: string): string[] {
  const trimmed = text.trimEnd();
  const closers = /[}"\s]{1,3}$/u.exec(trimmed)?.[0].length ?? 0;
  return Array.from({ length: closers }, (_, index) => trimmed.slice(0, trimmed.length - index - 1));
}

function decodeArgumentsText(text: string): DynamicRecord | null {
  const trimmed = withoutTrailingClosers(text);
  for (const candidate of [text, repairJsonText(text), ...trimmed, ...trimmed.map(repairJsonText)]) {
    try {
      const value = JSON.parse(candidate);
      return isRecord(value) ? value : null;
    } catch {}
  }
  return null;
}

function parseCall(params: DynamicToolCallParams) {
  const envelope = params.arguments;
  if (!isRecord(envelope)) return callSchema.safeParse(envelope);
  const sent = envelope.arguments;
  if (sent === undefined || sent === null || (typeof sent === "string" && /^(?:null)?$/.test(sent.trim())))
    return callSchema.safeParse({ ...envelope, arguments: {} });
  if (typeof sent !== "string") return callSchema.safeParse(envelope);
  return callSchema.safeParse({ ...envelope, arguments: decodeArgumentsText(sent) });
}

function catalogEntry(catalog: typeof BUILTIN_TOOL_CATALOG, name: string) {
  const qualified = qualifiedToolName(name);
  return catalog.find((tool) => tool.name === qualified);
}

function calledName(call: { name?: string | undefined; tool?: string | undefined }): string {
  return qualifiedToolName(call.name ?? call.tool ?? "");
}

function callsDiscoveryTool(envelope: unknown): boolean {
  const named = bridgedName(envelope);
  return named !== null && /^openbot\.tool_(?:search|describe)$/.test(qualifiedToolName(named));
}

export function deferredCallArgumentsError(
  params: DynamicToolCallParams,
  provider: AgentProviderId,
  unknownToolNote: () => string | null = () => null,
): string | null {
  if (callsDiscoveryTool(params.arguments)) return sourceText("error.agent.toolCallDiscoveryTool");
  const error = refusedCallError(params, provider);
  const named = bridgedName(params.arguments);
  if (error === null || (named !== null && catalogEntry(catalogFor(provider), named))) return error;
  const note = unknownToolNote();
  return note ? `${error} ${note}` : error;
}

function refusedCallError(params: DynamicToolCallParams, provider: AgentProviderId): string | null {
  const parsed = parseCall(params);
  if (!parsed.success) {
    const { issues } = parsed.error;
    if (issues.some(({ code }) => code === "unrecognized_keys")) return sourceText("error.agent.toolCallEnvelopeKeys");
    if (issues.some(({ code }) => code === "custom")) return sourceText("error.agent.toolCallMissingName");
    return issues.some(({ path }) => path[0] === "arguments")
      ? sourceText("error.agent.toolCallArgumentsNotObject")
      : null;
  }
  const catalog = catalogFor(provider);
  const name = calledName(parsed.data);
  const dot = name.lastIndexOf(".");
  const namespace = dot < 0 ? null : name.slice(0, dot);
  const short = namespace === null || catalog.some((tool) => tool.namespace === namespace) ? name.slice(dot + 1) : "";
  const [match, other] = short ? catalog.filter((tool) => tool.tool === short) : [];
  return match && !other
    ? sourceText("error.agent.toolCallUnknownToolSuggest", { name: match.name })
    : sourceText("error.agent.toolCallUnknownTool");
}

export function resolveDeferredTool(
  params: DynamicToolCallParams,
  provider: AgentProviderId,
): DynamicToolCallParams | null {
  const parsed = parseCall(params);
  if (!parsed.success) return null;
  const entry = catalogEntry(catalogFor(provider), calledName(parsed.data));
  if (!entry) return null;
  const args = withSchemaTypes(parsed.data.arguments, entry.inputSchema);
  return { ...params, namespace: entry.namespace, tool: entry.tool, arguments: args };
}

export function deferredNullValueError(resolved: DynamicToolCallParams, provider: AgentProviderId): string | null {
  const name = `${resolved.namespace}.${resolved.tool}`;
  const entry = catalogEntry(catalogFor(provider), name);
  if (!entry || !isRecord(resolved.arguments)) return null;
  const paths = nullStructuredItemPaths(resolved.arguments, entry.inputSchema);
  return paths.length === 0 ? null : sourceText("error.agent.toolCallNullValue", { name, paths: paths.join(", ") });
}

export function deferredCall(
  params: DynamicToolCallParams,
): { name: string; arguments: z.infer<typeof callShape.arguments> } | null {
  const parsed = parseCall(params);
  const name = parsed.success ? (parsed.data.name ?? parsed.data.tool)?.trim() : undefined;
  return parsed.success && name ? { name, arguments: parsed.data.arguments } : null;
}

function searchTerms(params: DynamicToolCallParams) {
  const parsed = searchSchema.safeParse(params.arguments);
  if (!parsed.success) return null;
  const queries = [...(parsed.data.queries ?? []), ...(parsed.data.query ? [parsed.data.query] : [])].map((query) =>
    query.toLowerCase(),
  );
  return { queries, terms: new Set(queries.flatMap(words)), limit: parsed.data.limit };
}

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
      for (const entry of ready)
        if (!matches.some((match) => match.entry === entry && match.exact)) ready.delete(entry);
    if (workflowSearch || [...terms].some((term) => CANVAS_WORDS.has(term))) {
      for (const entry of WORKFLOW_TOOLS) {
        if (!found.some((result) => result.entry === entry)) found.push({ entry, strong: true });
        ready.add(entry);
      }
    }
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
    return workflowSearch || found.some(({ entry }) => entry.namespace === OPENBOT_BROWSER_NAMESPACE)
      ? result
      : { ...result, note: BROWSER_SEARCH_NOTE };
  }
  const parsed = describeSchema.safeParse(params.arguments);
  if (!parsed.success) throw new Error(sourceText("error.agent.toolRequestInvalid"));
  const names = [...new Set([...(parsed.data.names ?? []), ...(parsed.data.name ? [parsed.data.name] : [])])];
  const entries = new Set<(typeof catalog)[number]>();
  const notFound: string[] = [];
  for (const name of names) {
    const entry = catalogEntry(catalog, name);
    if (entry) entries.add(entry);
    else notFound.push(name);
  }
  if (entries.size === 0) throw new UnknownToolNamesError(notFound);
  return {
    call: CALL_NOTE,
    tools: [...entries].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    guidance: toolGuidanceFor([...entries]),
    ...(notFound.length > 0 ? { notFound, note: unknownToolNamesText(notFound) } : {}),
  };
}

function isDiscoveryTool(name: string): boolean {
  return /^openbot\.tool_(?:search|describe|call)$/.test(qualifiedToolName(name));
}

export function mayNameMcpTool(names: readonly string[]): boolean {
  return names.some((name) => !isDiscoveryTool(name));
}

export class UnknownToolNamesError extends Error {
  constructor(readonly names: readonly string[]) {
    super(unknownToolNamesText(names));
  }
}

function unknownToolNamesText(names: readonly string[]): string {
  const discovery = names.filter(isDiscoveryTool);
  const other = names.filter((name) => !isDiscoveryTool(name));
  return [
    ...(other.length > 0 ? [sourceText("error.agent.toolDescribeUnknownNames", { names: other.join(", ") })] : []),
    ...(discovery.length > 0
      ? [sourceText("error.agent.toolDescribeDiscoveryNames", { names: discovery.join(", ") })]
      : []),
  ].join(" ");
}
