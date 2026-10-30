// Runs issue #2897 end to end on the real `codex app-server`: a code-mode-only model, as Codex
// describes GPT-6, and an OpenBot MCP server. Codex defers such a model's MCP tools into its `exec`
// cell, and the prompt does not name them, so the model does not find them. OpenBot sends their
// namespaces as direct-only, beside its own. The payload is the one `codexDisabledServers`,
// `codexMcpServers`, `codexThreadMcpServers` and `codexMcpNamespaces` build for a thread. A local
// server that speaks the Responses API stands in for the model: it records the top-level namespaces
// and calls the MCP tool when Codex offers it, so no account or key is used. A thread started with
// the list keeps it on `thread/resume`. Codex 0.164 does not add the list to a thread started
// without it, so `CODEX_MCP_ADAPTER_VERSION` 8 replaces those sessions.
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
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { readCodexMcpConfig } from "../src/backend/agent/codex-mcp-config";
import { VISIBLE_DYNAMIC_TOOLS } from "../src/backend/agent/tool-catalog";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { resolveCodexCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import {
  type CodexOwnTransports,
  codexDisabledServers,
  codexMcpNamespaces,
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
const TOOL = "list_calendars";
const RESULT = "calendar_fixture_result";
const STRUCTURED = "calendar_fixture_structured";
// A 1 × 1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// The fields Codex reads to route tools, as its model cache has them for GPT-6.
const MODEL_CATALOG = {
  models: [
    {
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
    },
  ],
};

interface ModelTool {
  name?: string;
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
  /** Whether the request carries the MCP tool's result back. */
  hasResult: boolean;
  /** Whether the tool output carries the result's `structuredContent`. */
  hasStructured: boolean;
  /** Whether the tool output carries an image. */
  hasImage: boolean;
}

/**
 * Calls the MCP tool once when a top-level namespace offers it, then answers with a short text.
 * Records what each request offered.
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
      const output = JSON.stringify(input.filter((item) => item.type === "function_call_output"));
      offers.push({
        names: tools.flatMap((tool) => (tool.name ? [tool.name] : [])).sort(),
        mentionsTool: body.includes(TOOL),
        hasResult: JSON.stringify(input).includes(RESULT),
        hasStructured: output.includes(STRUCTURED),
        hasImage: output.includes('"input_image"'),
      });
      const called = input.some((item) => item.type === "function_call");
      const namespace = tools.find(
        (tool) => tool.name?.startsWith("mcp__") && tool.tools?.some((t) => t.name === TOOL),
      );
      const item: ModelItem =
        !called && namespace?.name
          ? { type: "function_call", id: "c", call_id: "c", name: TOOL, namespace: namespace.name, arguments: "{}" }
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

interface Case {
  name: string;
  /** The user's own entries, as TOML. */
  user?: string;
  rows: McpServerConfig[];
  /** True sends the direct-only list as it was before the fix: OpenBot's own namespace alone. */
  legacy?: boolean;
  /** True starts the thread with the fix, then resumes it in a new app-server. */
  resume?: boolean;
}

interface Outcome {
  keys: string[];
  directOnly: string[];
  offered: string[];
  mentionsTool: boolean;
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
      `model = "${MODEL}"`,
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
    const legacy = VISIBLE_DYNAMIC_TOOLS.map((namespace) => namespace.name);
    const fixed = [...legacy, ...codexMcpNamespaces(servers)];
    const params = (directOnly: string[]) => ({
      cwd: home,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      model: MODEL,
      config: {
        mcp_servers: codexThreadMcpServers(own.disabled, servers),
        "features.code_mode.direct_only_tool_namespaces": directOnly,
      },
      dynamicTools: VISIBLE_DYNAMIC_TOOLS,
    });
    const started = await runCauseEffect(
      session.client.request("thread/start", params(test.legacy ? legacy : fixed), decodeRecordResponse),
    );
    const threadId = getString(getRecord(started, "thread"), "id");
    assert(threadId, "thread/start returned no thread id");
    if (test.resume) {
      await session.turn(threadId);
      await runCauseEffect(session.client.stop());
      session = await open(home);
      await runCauseEffect(
        session.client.request("thread/resume", { threadId, ...params(fixed) }, decodeRecordResponse),
      );
    }
    const firstOffer = model.offers.length;
    const firstCall = http.calls.length;
    await session.turn(threadId);
    const offers = model.offers.slice(firstOffer);
    return {
      keys: Object.keys(servers).sort(),
      directOnly: test.legacy ? legacy : fixed,
      offered: (offers[0]?.names ?? []).filter((name) => name.startsWith("mcp__")),
      mentionsTool: offers[0]?.mentionsTool ?? false,
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
    "before the fix: the prompt does not name the deferred MCP tool, and the model makes no call",
    { name: "legacy", rows: [row("composio")], legacy: true },
    (o) => {
      assert.deepEqual(o.keys, ["composio"]);
      assert.deepEqual(o.offered, []);
      assert.equal(o.mentionsTool, false, "the request named the MCP tool");
      assert.deepEqual(o.calls, []);
    },
  );
  await step(
    "the MCP namespace is direct-only: the model sees it and its call returns the result",
    { name: "fixed", rows: [row("composio")] },
    (o) => {
      assert.ok(o.directOnly.includes("mcp__composio"), `direct-only ${o.directOnly.join(", ")}`);
      assert.deepEqual(o.offered, ["mcp__composio"]);
      assert.deepEqual(o.calls, [TOOL]);
      assert.equal(o.resultReturned, true, "the model did not get the MCP result");
    },
  );
  await step(
    "a thread started with the fix keeps the namespace when it resumes",
    { name: "resumed", rows: [row("composio")], resume: true },
    // The call is in the first turn; the history holds it, so the fake model does not call again.
    (o) => assert.deepEqual(o.offered, ["mcp__composio"]),
  );
  await step(
    "a user stdio composio renames the row: the renamed namespace is direct-only",
    {
      name: "renamed",
      user: `[mcp_servers.composio]${NL}command = "node"${NL}enabled = true${NL}`,
      rows: [row("composio")],
    },
    (o) => {
      assert.deepEqual(o.keys, ["openbot_composio"]);
      assert.deepEqual(o.offered, ["mcp__openbot_composio"]);
      assert.ok(!o.directOnly.includes("mcp__composio"), "the user's turned-off server is direct-only");
      assert.deepEqual(o.calls, [TOOL]);
    },
  );
  await step(
    "a key that starts with mcp__ keeps one prefix",
    { name: "prefixed", rows: [row("mcp__calendar")] },
    (o) => {
      assert.deepEqual(o.offered, ["mcp__calendar"]);
      assert.deepEqual(o.calls, [TOOL]);
    },
  );
  await step(
    "a hyphen in the key becomes an underscore, as Codex names the namespace",
    { name: "hyphen", rows: [row("google-calendar")] },
    (o) => {
      assert.deepEqual(o.keys, ["google-calendar"]);
      assert.deepEqual(o.offered, ["mcp__google_calendar"]);
      assert.ok(o.directOnly.includes("mcp__google_calendar"), `direct-only ${o.directOnly.join(", ")}`);
      assert.deepEqual(o.calls, [TOOL]);
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
    "an MCP image without structuredContent reaches the model with the text",
    { name: "image", rows: [row("gallery", { url: `${httpOrigin}/image` })] },
    (o) => {
      assert.deepEqual(o.calls, [TOOL]);
      assert.equal(o.resultReturned, true, "the model did not get the text");
      assert.equal(o.imageReturned, true, "the model did not get the image");
    },
  );
  await step(
    "issue #3265: beside structuredContent, Codex gives the model the structured JSON alone",
    { name: "structured-image", rows: [row("gallery", { url: `${httpOrigin}/structured-image` })] },
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
