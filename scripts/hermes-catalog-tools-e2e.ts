// Runs the real LocalMcpBridge with the tools that a Hermes Agent session gets, lists them with the MCP SDK
// client, and gives them to the tool search of a Hermes Agent checkout. Hermes hides all MCP tools behind
// its own tool_search, tool_describe, and tool_call. Its tool_call refused `openbot.channel_result`, and a
// channel member could not send its result (#9312). Each catalog tool must now be a Hermes tool that its
// search finds, its describe gives with the guidance, and its tool_call runs through the bridge.
// HERMES_REPO=<hermes-agent checkout> HERMES_PYTHON=<python 3.11+ with its dependencies>
// `bun run test:hermes-catalog-tools`. Writes .openbot-build/hermes-catalog-tools-e2e/report.json.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Effect } from "effect";
import { z } from "zod";
import { isDynamicToolNamespace } from "../src/backend/acp-client";
import { customAgentFlavor, HERMES_ACP_FLAVOR } from "../src/backend/acp-flavor";
import { visibleDynamicTools, withCatalogTools } from "../src/backend/agent/tool-catalog";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { LocalMcpBridge, type LocalMcpSession } from "../src/backend/local-mcp-bridge";
import type { DynamicToolCallParams } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/hermes-catalog-tools-e2e");
const HERMES_REPO = process.env.HERMES_REPO;
const HERMES_PYTHON = process.env.HERMES_PYTHON ?? "python3";

/** Queries that a model sends for the channel result, and the tool that each must find. */
const SEARCHES: ReadonlyArray<[string, string]> = [
  ["channel_result", "channel_result"],
  ["openbot.channel_result", "channel_result"],
  ["channel result", "channel_result"],
  ["create workflow", "edit_workflow"],
  ["list agents", "list_agents"],
  ["click", "click"],
];

// Hermes Agent's own code: its editor server names, its tool registry, and its tool search.
const HERMES_SEARCH = `
import json, sys
repo, tools_path = sys.argv[1], sys.argv[2]
sys.path.insert(0, repo)
from gateway.session_local_mcp import _server_names
from tools.registry import registry
from tools.mcp_tool_schema import mcp_prefixed_tool_name
import tools.tool_search as ts
listed = json.load(open(tools_path))
names = _server_names("editor-session:e2e", [{"name": server} for server in listed["servers"]])
defs, servers = [], {}
for index, server in enumerate(listed["servers"]):
    servers[names[index]] = server
    for tool in listed["tools"][server]:
        name = mcp_prefixed_tool_name(names[index], tool["name"])
        schema = {"name": name, "description": tool.get("description", ""), "parameters": tool["inputSchema"]}
        registry.register(name, "mcp-" + names[index], schema, lambda args, **kw: "{}")
        defs.append({"type": "function", "function": schema})
config = ts.ToolSearchConfig.from_raw(None)
assembled = ts.assemble_tool_defs(defs, context_length=200000, config=config)
search_tool = next(d["function"] for d in assembled.tool_defs if d["function"]["name"] == "tool_search")
searches = {q: json.loads(ts.dispatch_tool_search({"queries": [q]}, current_tool_defs=defs, config=config))["results"][0]["matches"]
            for q in listed["queries"]}
openbot = next(n for n, s in servers.items() if s == "openbot")
described = json.loads(ts.dispatch_tool_describe(
    {"names": [f"mcp__{openbot}__channel_result", f"mcp__{openbot}__edit_workflow", f"mcp__{openbot}__send_message"]},
    current_tool_defs=defs, config=config))
session = ts.session_tool_names(defs)
call = lambda name, arguments: list(ts.resolve_underlying_call({"calls": [{"name": name, "arguments": arguments}]}, session))
print(json.dumps({
    "servers": servers,
    "activated": assembled.activated,
    "visible": [d["function"]["name"] for d in assembled.tool_defs],
    "listsChannelResult": f"mcp__{openbot}__channel_result" in search_tool["description"],
    "searches": searches,
    "described": described,
    "calls": {
        "full": call(f"mcp__{openbot}__channel_result", {"text": "Done."}),
        "dotted": call("openbot.channel_result", {"text": "Done."}),
        "bare": call("channel_result", {"text": "Done."}),
        "nested": call(f"mcp__{openbot}__tool_call", {"name": "openbot.channel_result", "arguments": {"text": "Done."}}),
    },
}))
`;

const resolvedCall = z.tuple([z.string().nullable(), z.record(z.string(), z.unknown()), z.string().nullable()]);
const hermesResult = z.object({
  servers: z.record(z.string(), z.string()),
  activated: z.boolean(),
  visible: z.array(z.string()),
  listsChannelResult: z.boolean(),
  searches: z.record(z.string(), z.array(z.string())),
  described: z.object({
    tools: z.record(
      z.string(),
      z.object({ description: z.string(), parameters: z.object({ description: z.string().optional() }) }),
    ),
  }),
  calls: z.object({ full: resolvedCall, dotted: resolvedCall, bare: resolvedCall, nested: resolvedCall }),
});
type HermesResult = z.infer<typeof hermesResult>;
type ListedTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

interface Report {
  passed: boolean;
  listed?: Record<string, number>;
  hermes?: Omit<HermesResult, "described"> & { describedNames: string[] };
  bridged?: Array<Pick<DynamicToolCallParams, "namespace" | "tool" | "arguments">>;
}

/**
 * The SDK transport classes declare their handlers and `sessionId` as `T | undefined`, which
 * `exactOptionalPropertyTypes` does not accept as a `Transport`. This one forwards to such a class.
 */
function asTransport(inner: {
  start(): Promise<void>;
  send: Transport["send"];
  close(): Promise<void>;
  onclose?: (() => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;
  onmessage?: Transport["onmessage"] | undefined;
  setProtocolVersion?: ((version: string) => void) | undefined;
}): Transport {
  const transport: Transport = {
    start: () => {
      inner.onclose = () => transport.onclose?.();
      inner.onerror = (error) => transport.onerror?.(error);
      inner.onmessage = (message, extra) => transport.onmessage?.(message, extra);
      return inner.start();
    },
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
    setProtocolVersion: (version) => inner.setProtocolVersion?.(version),
  };
  return transport;
}

async function connect(session: LocalMcpSession, server: string): Promise<Client> {
  const config = session.servers.find((candidate) => candidate.name === server);
  assert.ok(config, `The session has the ${server} server.`);
  const client = new Client({ name: "e2e-hermes", version: "1.0.0" });
  const headers = Object.fromEntries(config.headers.map((header) => [header.name, header.value]));
  await client.connect(
    asTransport(new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers } })),
  );
  return client;
}

const report: Report = { passed: false, bridged: [] };
const bridge = new LocalMcpBridge();
const clients: Client[] = [];

try {
  assert.ok(HERMES_REPO, "Set HERMES_REPO to a hermes-agent checkout.");
  assert.equal(HERMES_ACP_FLAVOR.catalogAsMcpTools, true, "The Hermes provider gets the catalog as MCP tools.");
  assert.equal(customAgentFlavor("/opt/bin/hermes").catalogAsMcpTools, true, "A custom hermes agent gets them too.");
  assert.equal(customAgentFlavor("omp").catalogAsMcpTools, undefined, "Other custom agents keep OpenBot's search.");

  // The tools that AcpClient gives the bridge for a Hermes session, through the same check.
  const sent: unknown[] = visibleDynamicTools("hermes");
  const given = sent.filter(isDynamicToolNamespace);
  assert.equal(given.length, sent.length, "AcpClient takes each namespace.");
  const namespaces = withCatalogTools(given, "hermes");
  const session = await runCauseEffect(
    bridge.createSession(
      "thread-hermes",
      namespaces,
      () => "turn-1",
      (call) =>
        Effect.sync(() => {
          report.bridged?.push({ namespace: call.namespace, tool: call.tool, arguments: call.arguments });
          return { success: true, contentItems: [{ type: "inputText" as const, text: "sent" }] };
        }),
    ),
  );
  const servers = session.servers.map((server) => server.name);
  const tools: Record<string, ListedTool[]> = {};
  const byServer = new Map<string, Client>();
  for (const server of servers) {
    const client = await connect(session, server);
    clients.push(client);
    byServer.set(server, client);
    tools[server] = (await client.listTools()).tools;
  }
  report.listed = Object.fromEntries(Object.entries(tools).map(([server, list]) => [server, list.length]));
  const openbotNames = (tools.openbot ?? []).map((tool) => tool.name);
  for (const name of ["channel_result", "channel_reply", "edit_workflow", "tool_call"])
    assert.ok(openbotNames.includes(name), `The openbot server lists ${name}.`);
  for (const name of ["tool_search", "tool_describe"])
    assert.ok(!openbotNames.includes(name), `Hermes searches with its own tool, not with OpenBot's ${name}.`);
  assert.ok(!openbotNames.includes("web_search"), "Hermes keeps its own web search.");

  await mkdir(OUT, { recursive: true });
  const toolsPath = join(OUT, "listed-tools.json");
  await writeFile(toolsPath, JSON.stringify({ servers, tools, queries: SEARCHES.map(([query]) => query) }));
  const { stdout } = await promisify(execFile)(HERMES_PYTHON, ["-I", "-c", HERMES_SEARCH, HERMES_REPO, toolsPath], {
    cwd: OUT,
    env: { ...process.env, HERMES_HOME: join(OUT, "hermes-home") },
    maxBuffer: 16 * 1024 * 1024,
  });
  const hermes = hermesResult.parse(JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}"));
  const { described, ...rest } = hermes;
  report.hermes = { ...rest, describedNames: Object.keys(described.tools) };

  assert.equal(hermes.activated, true, "Hermes hides the MCP tools behind its search.");
  assert.deepEqual(hermes.visible, ["tool_search", "tool_describe", "tool_call"], "The model sees the Hermes tools.");
  assert.ok(hermes.listsChannelResult, "The Hermes tool_search description lists the full channel_result name.");
  for (const [query, tool] of SEARCHES)
    assert.ok(
      hermes.searches[query]?.some((name) => name.endsWith(`__${tool}`)),
      `Hermes search "${query}" finds ${tool}: ${hermes.searches[query]?.join(", ")}`,
    );
  const describedTools = Object.entries(described.tools);
  assert.equal(describedTools.length, 3, "Hermes describes each tool.");
  const workflow = describedTools.find(([name]) => name.endsWith("__edit_workflow"))?.[1];
  assert.match(
    workflow?.parameters.description ?? "",
    /Read a workflow before a change/,
    "Describe gives the guidance.",
  );
  // send_message is a direct tool of every agent, and OpenBot's tool_describe is not listed for Hermes.
  const message = describedTools.find(([name]) => name.endsWith("__send_message"))?.[1];
  assert.match(message?.parameters.description ?? "", /Choose recipients/, "A direct tool gives its guidance too.");

  const [fullName, fullArguments, fullError] = hermes.calls.full;
  assert.equal(fullError, null, "Hermes tool_call accepts the full name.");
  assert.ok(hermes.calls.dotted[2]?.includes("Use tool_search"), "The dotted name gets the search hint.");
  assert.ok(hermes.calls.bare[2]?.includes(String(fullName)), "The bare name gets the full name as a hint.");
  assert.equal(hermes.calls.nested[2], null, "OpenBot's tool_call, which channel rules name, still resolves.");

  // Hermes runs the resolved tool on the MCP server it came from.
  const [, prefix, tool] = /^mcp__(.+)__([^_].*)$/.exec(String(fullName)) ?? [];
  const server = prefix ? hermes.servers[prefix] : undefined;
  assert.ok(server && tool, `Hermes resolved an MCP tool: ${fullName}`);
  await byServer.get(server)?.callTool({ name: tool, arguments: fullArguments });
  assert.deepEqual(
    report.bridged,
    [{ namespace: "openbot", tool: "channel_result", arguments: { text: "Done." } }],
    "The call reaches OpenBot as openbot.channel_result.",
  );
  report.passed = true;
} finally {
  await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
  await runCauseEffect(bridge.close());
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
