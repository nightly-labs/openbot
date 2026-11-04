// Runs issues #2897 and #4468 end to end on the real `codex app-server`: a code-mode-only model, as
// Codex describes GPT-6, and an OpenBot MCP server. Codex defers such a model's MCP tools into its
// `exec` cell. #2897 made each MCP namespace direct-only, so each request carried the schema of every
// MCP tool. Since #4468 only Computer Use stays direct; the model finds another server's tools in
// `ALL_TOOLS` inside `exec`, as the developer instructions tell it. The payload is the one
// `codexDisabledServers`, `codexMcpServers`, `codexThreadMcpServers` and `codexDirectMcpNamespaces`
// build for a thread. A local server that speaks the Responses API stands in for the model: it records
// the top-level namespaces, calls a direct MCP tool when Codex offers it, and otherwise calls the tool
// from `exec`, so no account or key is used. A thread started with every MCP namespace direct keeps
// them on `thread/resume`.
// Issue #3265: a direct call gives the model the result's `structuredContent` alone when the server
// sends it, and drops each image of `content`. A result without it keeps its images. The image steps
// record this Codex behavior, so a Codex update that changes it fails here.
// `bun scripts/codex-code-mode-mcp-e2e.ts`. Writes .openbot-build/codex-code-mode-mcp-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";
import { join, resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { COMPUTER_USE_MCP_SERVER_ID, COMPUTER_USE_MCP_SERVER_NAME, type McpServerConfig } from "@openbot/contracts/ipc";
import { readCodexMcpConfig } from "../src/backend/agent/codex-mcp-config";
import { VISIBLE_DYNAMIC_TOOLS } from "../src/backend/agent/tool-catalog";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { resolveCodexCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import {
  type CodexOwnTransports,
  codexDirectMcpNamespaces,
  codexDisabledServers,
  codexMcpServers,
  codexThreadMcpServers,
  toMcpShapeFailed,
  usableMcpServers,
} from "../src/backend/mcp-provider-shapes";
import { decodeRecordResponse, getRecord, getString } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-code-mode-mcp-e2e");
const NL = String.fromCharCode(10);
const DEADLINE_MS = 60_000;
const MODEL = "code-mode-model";
// A model that is not code-mode-only: Codex defers its MCP tools behind `tool_search`.
const SEARCH_MODEL = "tool-search-model";
const TOOL = "list_calendars";
const RESULT = "calendar_fixture_result";
const STRUCTURED = "calendar_fixture_structured";
// A 1 × 1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// The fields Codex reads to route tools, as its model cache has them for GPT-6.
const CODE_MODE_MODEL = {
  slug: MODEL,
  display_name: "Code mode model",
  description: "Local E2E model",
  default_reasoning_level: "low",
  supported_reasoning_levels: [{ effort: "low", description: "Local E2E model" }],
  shell_type: "unified_exec",
  visibility: "list",
  supported_in_api: true,
  priority: 0,
  support_verbosity: false,
  truncation_policy: { mode: "tokens", limit: 10000 },
  context_window: 272000,
  experimental_supported_tools: [],
  input_modalities: ["text", "image"],
  supports_search_tool: true,
  use_responses_lite: true,
  tool_mode: "code_mode_only",
  model_messages: { instructions_template: "Use the available tools." },
};
const { tool_mode: _toolMode, use_responses_lite: _lite, ...searchModel } = CODE_MODE_MODEL;
const MODEL_CATALOG = {
  models: [CODE_MODE_MODEL, { ...searchModel, slug: SEARCH_MODEL, display_name: "Tool search model" }],
};

interface ModelTool {
  type?: string;
  name?: string;
  description?: string;
  tools?: Array<{ name?: string }>;
}

interface ModelRequest {
  input?: Array<{ type?: string; tools?: ModelTool[] }>;
  tools?: ModelTool[];
}

interface ModelItem {
  type: string;
  id: string;
  role?: string;
  call_id?: string;
  name?: string;
  namespace?: string;
  arguments?: string;
  input?: string;
  content?: Array<{ type: string; text: string }>;
}

interface ModelEvent {
  type: string;
  response?: {
    id: string;
    status: string;
    output?: ModelItem[];
    usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  };
  output_index?: number;
  item?: ModelItem;
}

interface Offer {
  /** The top-level tool names, namespaces included. */
  names: string[];
  /** Whether the request names the MCP tool anywhere, the `exec` description included. */
  mentionsTool: boolean;
  /** The description of Codex's `tool_search`, which names the sources of deferred tools. */
  search: string;
  /** Whether the request carries the MCP tool's result back. */
  hasResult: boolean;
  /** Whether the tool output carries the result's `structuredContent`. */
  hasStructured: boolean;
  /** Whether the tool output carries an image. */
  hasImage: boolean;
}

// What a model writes in `exec` when the MCP tool is not direct: it finds the tool in `ALL_TOOLS`.
const EXEC_CALL = [
  `const tool = ALL_TOOLS.find((t) => t.name.startsWith("mcp__") && t.name.endsWith("__${TOOL}"));`,
  "const result = await tools[tool.name]({});",
  "text(JSON.stringify(result));",
].join(NL);

/**
 * Calls the MCP tool once, directly when a top-level namespace offers it and from `exec` otherwise,
 * then answers with a short text. Records what each request offered.
 */
async function startFakeModel() {
  const offers: Offer[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed: ModelRequest = JSON.parse(body || "{}");
      const input = parsed.input ?? [];
      // A Responses Lite request sends its tools in an `input` item.
      const tools = parsed.tools ?? input.find((item) => item.tools)?.tools ?? [];
      const output = JSON.stringify(
        input.filter((item) => item.type === "function_call_output" || item.type === "custom_tool_call_output"),
      );
      offers.push({
        names: tools.flatMap((tool) => (tool.name ? [tool.name] : [])).sort(),
        mentionsTool: body.includes(TOOL),
        search: tools.find((tool) => tool.type === "tool_search")?.description ?? "",
        hasResult: JSON.stringify(input).includes(RESULT),
        hasStructured: output.includes(STRUCTURED),
        hasImage: output.includes('"input_image"'),
      });
      const called = input.some((item) => item.type === "function_call" || item.type === "custom_tool_call");
      const namespace = tools.find(
        (tool) => tool.name?.startsWith("mcp__") && tool.tools?.some((t) => t.name === TOOL),
      );
      const exec = tools.some((tool) => tool.name === "functions" && tool.tools?.some((t) => t.name === "exec"));
      const item: ModelItem = called
        ? { type: "message", role: "assistant", id: "m", content: [{ type: "output_text", text: "done" }] }
        : namespace?.name
          ? { type: "function_call", id: "c", call_id: "c", name: TOOL, namespace: namespace.name, arguments: "{}" }
          : exec
            ? { type: "custom_tool_call", id: "x", call_id: "x", name: "exec", input: EXEC_CALL }
            : { type: "message", role: "assistant", id: "m", content: [{ type: "output_text", text: "done" }] };
      const send = (event: ModelEvent) =>
        response.write(`event: ${event.type}${NL}data: ${JSON.stringify(event)}${NL}${NL}`);
      response.writeHead(200, { "content-type": "text/event-stream" });
      send({ type: "response.created", response: { id: "r", status: "in_progress" } });
      send({ type: "response.output_item.done", output_index: 0, item });
      send({
        type: "response.completed",
        response: {
          id: "r",
          status: "completed",
          output: [item],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      });
      response.end();
    });
  });
  return { offers, ...(await listen(server)) };
}

/**
 * A stateless SDK Streamable HTTP MCP server with one tool, which records each call. The path chooses
 * the result: `/mcp` sends text, `/image` adds a PNG, and `/structured-image` also adds `structuredContent`.
 */
async function startHttpMcp() {
  const calls: string[] = [];
  const server = createServer(async (request, response) => {
    const image = request.url !== "/mcp";
    const structured = request.url === "/structured-image";
    const mcp = new Server({ name: "calendar", version: "1.0.0" }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: TOOL, description: "Lists calendars.", inputSchema: { type: "object", properties: {} } }],
    }));
    mcp.setRequestHandler(CallToolRequestSchema, async (message) => {
      calls.push(message.params.name);
      return {
        content: [
          { type: "text", text: RESULT },
          ...(image ? [{ type: "image", mimeType: "image/png", data: PNG }] : []),
        ],
        ...(structured ? { structuredContent: { marker: STRUCTURED, width: 1, height: 1 } } : {}),
      };
    });
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    response.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(asTransport(transport));
    await transport.handleRequest(request, response);
  });
  return { calls, ...(await listen(server)) };
}

async function listen(server: HttpServer) {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    port: address.port,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

/** The SDK transport, with its optional members spelled the way `exactOptionalPropertyTypes` wants. */
function asTransport(inner: StreamableHTTPServerTransport): Transport {
  const transport: Transport = {
    start: () => {
      inner.onclose = () => transport.onclose?.();
      inner.onerror = (error) => transport.onerror?.(error);
      inner.onmessage = (message, extra) => transport.onmessage?.(message, extra);
      return inner.start();
    },
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
  };
  return transport;
}

function row(name: string, fields: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: `row-${name}`,
    name,
    transport: "http",
    enabled: true,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: httpUrl,
    headers: [],
    ...fields,
  };
}

/** A server under Computer Use's id and name, which stays direct. */
function computerUse(url = httpUrl): McpServerConfig {
  return row(COMPUTER_USE_MCP_SERVER_NAME, { id: COMPUTER_USE_MCP_SERVER_ID, url });
}

interface Case {
  name: string;
  /** The user's own entries, as TOML. */
  user?: string;
  rows: McpServerConfig[];
  /** The model slug; the code-mode-only model when omitted. */
  model?: string;
  /** True starts the thread with the list of #2897, every MCP namespace direct, then resumes it in a new app-server. */
  resume?: boolean;
}

interface Outcome {
  keys: string[];
  directOnly: string[];
  offered: string[];
  mentionsTool: boolean;
  search: string;
  calls: string[];
  resultReturned: boolean;
  structuredReturned: boolean;
  imageReturned: boolean;
}

/** One app-server for the case's `CODEX_HOME`, initialized, and a way to run a turn to its end. */
async function open(home: string) {
  const client = new CodexAppServerClient(cli.executable, 30_000, { CODEX_HOME: home, FAKE_KEY: "e2e" });
  let turnDone = () => {};
  client.on("notification", (notification) => {
    if (notification.method === "turn/completed") turnDone();
  });
  client.start();
  try {
    await runCauseEffect(
      client.request(
        "initialize",
        {
          clientInfo: { name: "openbot_e2e", title: "OpenBot E2E", version: "0.0.0" },
          capabilities: { experimentalApi: true },
        },
        decodeRecordResponse,
      ),
    );
  } catch (error) {
    await runCauseEffect(client.stop());
    throw error;
  }
  client.notify("initialized");
  const turn = async (threadId: string) => {
    const done = new Promise<void>((resolveTurn) => {
      turnDone = resolveTurn;
    });
    await runCauseEffect(
      client.request(
        "turn/start",
        { threadId, input: [{ type: "text", text: "list calendars" }] },
        decodeRecordResponse,
      ),
    );
    await Promise.race([done, deadline(`the turn in ${home}`)]);
  };
  return { client, turn };
}

async function run(test: Case): Promise<Outcome> {
  const home = join(OUT, test.name);
  await mkdir(home, { recursive: true });
  await writeFile(
    join(home, "config.toml"),
    [
      `model = "${test.model ?? MODEL}"`,
      `model_catalog_json = ${JSON.stringify(catalog)}`,
      'model_provider = "fake"',
      "[model_providers.fake]",
      'name = "fake"',
      `base_url = "http://127.0.0.1:${model.port}/v1"`,
      'env_key = "FAKE_KEY"',
      'wire_api = "responses"',
      "",
      test.user ?? "",
    ].join(NL),
  );
  let session = await open(home);
  try {
    const usable = await runCauseEffect(usableMcpServers(test.rows));
    const keyed = (own: CodexOwnTransports) => codexMcpServers(usable, own).servers;
    const own = await runCauseEffect(
      codexDisabledServers(() => readCodexMcpConfig(session.client, keyed).pipe(toMcpShapeFailed)),
    );
    const servers = keyed(own.transports);
    const openbot = VISIBLE_DYNAMIC_TOOLS.map((namespace) => namespace.name);
    const current = [...openbot, ...codexDirectMcpNamespaces(servers)];
    // The list from #2897 to #4468: Codex's name for each server key.
    const everyServer = [
      ...openbot,
      ...Object.keys(servers).map((key) => `mcp__${key.replace(/[^A-Za-z0-9_]/gu, "_")}`),
    ];
    const params = (directOnly: string[]) => ({
      cwd: home,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      model: test.model ?? MODEL,
      config: {
        mcp_servers: codexThreadMcpServers(own.disabled, servers),
        "features.code_mode.direct_only_tool_namespaces": directOnly,
      },
      dynamicTools: VISIBLE_DYNAMIC_TOOLS,
    });
    const started = await runCauseEffect(
      session.client.request("thread/start", params(test.resume ? everyServer : current), decodeRecordResponse),
    );
    const threadId = getString(getRecord(started, "thread"), "id");
    assert(threadId, "thread/start returned no thread id");
    if (test.resume) {
      await session.turn(threadId);
      await runCauseEffect(session.client.stop());
      session = await open(home);
      await runCauseEffect(
        session.client.request("thread/resume", { threadId, ...params(current) }, decodeRecordResponse),
      );
    }
    const firstOffer = model.offers.length;
    const firstCall = http.calls.length;
    await session.turn(threadId);
    const offers = model.offers.slice(firstOffer);
    return {
      keys: Object.keys(servers).sort(),
      directOnly: current,
      offered: (offers[0]?.names ?? []).filter((name) => name.startsWith("mcp__")),
      mentionsTool: offers[0]?.mentionsTool ?? false,
      search: offers[0]?.search ?? "",
      calls: http.calls.slice(firstCall),
      resultReturned: offers.some((offer) => offer.hasResult),
      structuredReturned: offers.some((offer) => offer.hasStructured),
      imageReturned: offers.some((offer) => offer.hasImage),
    };
  } finally {
    await runCauseEffect(session.client.stop());
  }
}

function deadline(what: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`No answer for ${what} in ${DEADLINE_MS} ms.`)), DEADLINE_MS).unref();
  });
}

const steps: Array<{ step: string; outcome: Outcome }> = [];
async function step(name: string, test: Case, expected: (outcome: Outcome) => void): Promise<void> {
  const outcome = await run(test);
  steps.push({ step: name, outcome });
  try {
    expected(outcome);
  } catch (error) {
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const catalog = join(OUT, "model-catalog.json");
await writeFile(catalog, JSON.stringify(MODEL_CATALOG));
const cli = await runCauseEffect(resolveCodexCli());
const model = await startFakeModel();
const http = await startHttpMcp();
const httpOrigin = `http://127.0.0.1:${http.port}`;
const httpUrl = `${httpOrigin}/mcp`;

try {
  await step(
    "issue #4468: the request declares no MCP schema, and exec finds the tool in ALL_TOOLS and calls it",
    { name: "deferred", rows: [row("composio")] },
    (o) => {
      assert.deepEqual(o.keys, ["composio"]);
      assert.ok(!o.directOnly.includes("mcp__composio"), `direct-only ${o.directOnly.join(", ")}`);
      assert.deepEqual(o.offered, []);
      assert.equal(o.mentionsTool, false, "the request named the MCP tool");
      assert.deepEqual(o.calls, [TOOL]);
      assert.equal(o.resultReturned, true, "the model did not get the MCP result");
    },
  );
  await step(
    "issue #4468: for a model that is not code-mode-only, Codex's tool_search names the deferred server",
    { name: "tool-search", rows: [row("composio")], model: SEARCH_MODEL },
    (o) => {
      assert.deepEqual(o.offered, []);
      assert.equal(o.mentionsTool, false, "the request named the MCP tool");
      assert.ok(o.search.includes("composio"), `tool_search description: ${o.search}`);
    },
  );
  await step(
    "a thread started with every MCP namespace direct keeps them on resume",
    { name: "resumed", rows: [row("composio")], resume: true },
    // The call is in the first turn; the history holds it, so the fake model does not call again.
    (o) => assert.deepEqual(o.offered, ["mcp__composio"]),
  );
  await step(
    "a user stdio composio renames the row: exec reaches the renamed tool",
    {
      name: "renamed",
      user: `[mcp_servers.composio]${NL}command = "node"${NL}enabled = true${NL}`,
      rows: [row("composio")],
    },
    (o) => {
      assert.deepEqual(o.keys, ["openbot_composio"]);
      assert.deepEqual(o.offered, []);
      assert.deepEqual(o.calls, [TOOL]);
    },
  );
  await step(
    "Computer Use stays direct: the model sees its namespace and calls it",
    { name: "computer-use", rows: [computerUse()] },
    (o) => {
      assert.ok(
        o.directOnly.includes(`mcp__${COMPUTER_USE_MCP_SERVER_NAME}`),
        `direct-only ${o.directOnly.join(", ")}`,
      );
      assert.deepEqual(o.offered, [`mcp__${COMPUTER_USE_MCP_SERVER_NAME}`]);
      assert.deepEqual(o.calls, [TOOL]);
      assert.equal(o.resultReturned, true, "the model did not get the MCP result");
    },
  );
  await step(
    "a turned-off row adds no namespace",
    { name: "disabled", rows: [row("composio", { enabled: false })] },
    (o) => {
      assert.deepEqual(o.keys, []);
      assert.ok(!o.directOnly.some((namespace) => namespace.startsWith("mcp__")), o.directOnly.join(", "));
      assert.deepEqual(o.offered, []);
      assert.deepEqual(o.calls, []);
    },
  );
  await step(
    "a direct MCP image without structuredContent reaches the model with the text",
    { name: "image", rows: [computerUse(`${httpOrigin}/image`)] },
    (o) => {
      assert.deepEqual(o.calls, [TOOL]);
      assert.equal(o.resultReturned, true, "the model did not get the text");
      assert.equal(o.imageReturned, true, "the model did not get the image");
    },
  );
  await step(
    "issue #3265: beside structuredContent, a direct call gives the model the structured JSON alone",
    { name: "structured-image", rows: [computerUse(`${httpOrigin}/structured-image`)] },
    (o) => {
      assert.deepEqual(o.calls, [TOOL]);
      assert.equal(o.structuredReturned, true, "the model did not get structuredContent");
      // A failure below means Codex now sends `content` too, which closes #3265 upstream.
      assert.equal(o.resultReturned, false, "the model got the text of content");
      assert.equal(o.imageReturned, false, "the model got the image of content");
    },
  );

  await writeFile(
    join(OUT, "report.json"),
    `${JSON.stringify({ ok: true, codex: { version: cli.version }, steps }, null, 2)}${NL}`,
  );
  process.stdout.write(`codex-code-mode-mcp-e2e: ${steps.length} steps passed with Codex ${cli.version}${NL}`);
} catch (error) {
  await writeFile(
    join(OUT, "report.json"),
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), steps }, null, 2)}${NL}`,
  );
  process.stderr.write(
    `codex-code-mode-mcp-e2e failed: ${error instanceof Error ? error.message : String(error)}${NL}`,
  );
  process.exitCode = 1;
} finally {
  await http.close();
  await model.close();
}
