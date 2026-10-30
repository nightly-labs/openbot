// Runs issue #2851 end to end on the real `codex app-server`: a server in the user's own
// `config.toml` and an OpenBot server with the same name. Codex merges the two entries, so a stdio
// `command` and an http `url` under one key stop it from loading its configuration. The payload is
// the one `readCodexMcpConfig`, `codexDisabledServers`, `codexMcpServers` and `codexThreadMcpServers`
// build for a thread. A local server that speaks the Responses API stands in for the model and
// records the MCP namespaces Codex offers, so no account or key is used.
// `bun scripts/codex-mcp-name-clash-e2e.ts`. Writes .openbot-build/codex-mcp-name-clash-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";
import { join, resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { Effect, Result } from "effect";
import { readCodexMcpConfig } from "../src/backend/agent/codex-mcp-config";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { resolveCodexCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import {
  type CodexOwnTransports,
  codexDisabledServers,
  codexMcpServers,
  codexThreadMcpServers,
  toMcpShapeFailed,
  usableMcpServers,
} from "../src/backend/mcp-provider-shapes";
import { decodeRecordResponse, getRecord, getString } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-mcp-name-clash-e2e");
const NL = String.fromCharCode(10);
const DEADLINE_MS = 60_000;

// A stdio MCP server with one tool.
const STDIO_SERVER = `
const readline = require("node:readline");
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + String.fromCharCode(10));
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "stdio", version: "1" } } });
  } else if (message.method === "tools/list") {
    send({ id: message.id, result: { tools: [{ name: "ping", description: "ping", inputSchema: { type: "object", properties: {} } }] } });
  } else if (message.id !== undefined) {
    send({ id: message.id, result: {} });
  }
});
`;

interface ResponsesRequest {
  tools?: Array<{ name?: string }>;
}

interface ModelItem {
  type: string;
  id: string;
  role: string;
  content: Array<{ type: string; text: string }>;
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

/** Answers each Responses request with a short text, and records the MCP namespaces it was offered. */
async function startFakeModel() {
  const offered: string[][] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed: ResponsesRequest = JSON.parse(body || "{}");
      offered.push((parsed.tools ?? []).flatMap((tool) => (tool.name?.startsWith("mcp__") ? [tool.name] : [])).sort());
      const item: ModelItem = {
        type: "message",
        role: "assistant",
        id: "m",
        content: [{ type: "output_text", text: "done" }],
      };
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
  return { offered, ...(await listen(server)) };
}

/** A stateless SDK Streamable HTTP MCP server with one tool, as the GitHub connector's would be. */
async function startHttpMcp() {
  const server = createServer(async (request, response) => {
    const mcp = new Server({ name: "http", version: "1.0.0" }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: "ping", inputSchema: { type: "object", properties: {} } }],
    }));
    mcp.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "pong" }] }));
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    response.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(asTransport(transport));
    await transport.handleRequest(request, response);
  });
  return listen(server);
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

function row(name: string, fields: Partial<McpServerConfig>): McpServerConfig {
  return {
    id: `row-${name}-${fields.transport ?? "stdio"}`,
    name,
    transport: "stdio",
    enabled: true,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
    ...fields,
  };
}

interface Case {
  name: string;
  /** The user's own entries, as TOML. */
  user: string;
  rows: McpServerConfig[];
  /** True runs the payload as it was before the fix: the keys ignore what the user's file declares. */
  legacy?: boolean;
}

interface Outcome {
  started: boolean;
  error: string | null;
  keys: string[];
  offered: string[];
  file: string;
}

async function run(executable: string, modelPort: number, test: Case): Promise<Outcome> {
  const home = join(OUT, test.name);
  await mkdir(home, { recursive: true });
  const file = join(home, "config.toml");
  await writeFile(
    file,
    [
      'model = "fake-model"',
      'model_provider = "fake"',
      "[model_providers.fake]",
      'name = "fake"',
      `base_url = "http://127.0.0.1:${modelPort}/v1"`,
      'env_key = "FAKE_KEY"',
      'wire_api = "responses"',
      "",
      test.user,
    ].join(NL),
  );
  const client = new CodexAppServerClient(executable, 30_000, { CODEX_HOME: home, FAKE_KEY: "e2e" });
  const turnDone = new Promise<void>((done) => {
    client.on("notification", (notification) => {
      if (notification.method === "turn/completed") done();
    });
  });
  client.start();
  try {
    await runCauseEffect(
      client.request(
        "initialize",
        { clientInfo: { name: "openbot_e2e", title: "OpenBot E2E", version: "0.0.0" }, capabilities: {} },
        decodeRecordResponse,
      ),
    );
    client.notify("initialized");
    const usable = await runCauseEffect(usableMcpServers(test.rows));
    const keyed = (own: CodexOwnTransports) => codexMcpServers(usable, test.legacy ? {} : own).servers;
    const own = await runCauseEffect(
      codexDisabledServers(() => readCodexMcpConfig(client, keyed).pipe(toMcpShapeFailed)),
    );
    const servers = keyed(own.transports);
    const started = await runCauseEffect(
      Effect.result(
        client.request(
          "thread/start",
          {
            cwd: home,
            approvalPolicy: "on-request",
            sandbox: "danger-full-access",
            model: "fake-model",
            config: { mcp_servers: codexThreadMcpServers(own.disabled, servers) },
          },
          decodeRecordResponse,
        ),
      ),
    );
    const outcome = { keys: Object.keys(servers).sort(), file: await readFile(file, "utf8") };
    if (Result.isFailure(started)) {
      return { ...outcome, started: false, error: String(started.failure.cause), offered: [] };
    }
    const threadId = getString(getRecord(started.success, "thread"), "id");
    assert(threadId, "thread/start returned no thread id");
    const requests = model.offered.length;
    await runCauseEffect(
      client.request("turn/start", { threadId, input: [{ type: "text", text: "hello" }] }, decodeRecordResponse),
    );
    await Promise.race([turnDone, deadline(`the turn of ${test.name}`)]);
    return { ...outcome, started: true, error: null, offered: model.offered[requests] ?? [] };
  } finally {
    await runCauseEffect(client.stop());
  }
}

function deadline(what: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`No answer for ${what} in ${DEADLINE_MS} ms.`)), DEADLINE_MS).unref();
  });
}

/** The lines of one `[mcp_servers.<name>]` table in the user's file. */
function table(file: string, name: string): string[] {
  const lines = file.split(NL);
  const start = lines.indexOf(`[mcp_servers.${name}]`);
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith("["));
  return lines.slice(start + 1, end < 0 ? undefined : end).filter((line) => line.trim() !== "");
}

const steps: Array<{ step: string; outcome: Outcome }> = [];
async function step(name: string, test: Case, expected: (outcome: Outcome) => void): Promise<void> {
  const outcome = await run(cli.executable, model.port, test);
  steps.push({ step: name, outcome });
  try {
    expected(outcome);
  } catch (error) {
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const script = join(OUT, "mcp-server.cjs").replaceAll("\\", "/");
await writeFile(script, STDIO_SERVER);
const cli = await runCauseEffect(resolveCodexCli());
const model = await startFakeModel();
const http = await startHttpMcp();
const httpUrl = `http://127.0.0.1:${http.port}/mcp`;
const userStdio = `[mcp_servers.github]${NL}command = "node"${NL}args = ["${script}"]${NL}enabled = true${NL}`;
const userHttp = `[mcp_servers.github]${NL}url = "${httpUrl}"${NL}enabled = true${NL}`;
const connector = row("github", { id: "openbot-github", transport: "http", url: httpUrl });

try {
  await step(
    "before the fix: OpenBot's http github over the user's stdio github stops Codex",
    { name: "legacy", user: userStdio, rows: [connector], legacy: true },
    (o) => {
      assert.equal(o.started, false, "Codex started the thread");
      assert.match(o.error ?? "", /url is not supported for stdio\s+in `mcp_servers\.github`/u);
    },
  );
  await step(
    "http connector, user stdio github: the connector travels as openbot_github",
    { name: "http-over-stdio", user: userStdio, rows: [connector] },
    (o) => {
      assert.equal(o.started, true, o.error ?? "");
      assert.deepEqual(o.keys, ["openbot_github"]);
      assert.ok(o.offered.includes("mcp__openbot_github"), `offered ${o.offered.join(", ")}`);
      assert.ok(!o.offered.includes("mcp__github"), "the user's turned-off server was offered");
      assert.deepEqual(table(o.file, "github"), ['command = "node"', `args = ["${script}"]`, "enabled = true"]);
      assert.deepEqual(table(o.file, "openbot_github"), ['url = "http://127.0.0.1:1"', "enabled = false"]);
    },
  );
  await step(
    "stdio row, user http github: the row travels as openbot_github",
    { name: "stdio-over-http", user: userHttp, rows: [row("github", { command: "node", args: [script] })] },
    (o) => {
      assert.equal(o.started, true, o.error ?? "");
      assert.deepEqual(o.keys, ["openbot_github"]);
      assert.ok(o.offered.includes("mcp__openbot_github"), `offered ${o.offered.join(", ")}`);
      assert.deepEqual(table(o.file, "github"), [`url = "${httpUrl}"`, "enabled = true"]);
    },
  );
  await step(
    "same transport: the row keeps the github key",
    { name: "same-transport", user: userStdio, rows: [row("github", { command: "node", args: [script] })] },
    (o) => {
      assert.equal(o.started, true, o.error ?? "");
      assert.deepEqual(o.keys, ["github"]);
      assert.ok(o.offered.includes("mcp__github"), `offered ${o.offered.join(", ")}`);
      assert.deepEqual(table(o.file, "openbot_github"), []);
    },
  );
  await step("no clash: the connector keeps the github key", { name: "no-clash", user: "", rows: [connector] }, (o) => {
    assert.equal(o.started, true, o.error ?? "");
    assert.deepEqual(o.keys, ["github"]);
    assert.ok(o.offered.includes("mcp__github"), `offered ${o.offered.join(", ")}`);
  });
  // Its tool consent keeps a card only under this name, so a clash must never rename it.
  await step(
    "Computer Use over a user http computer_use: the key stays computer_use",
    {
      name: "computer-use",
      user: `[mcp_servers.computer_use]${NL}url = "${httpUrl}"${NL}enabled = true${NL}`,
      rows: [row("computer_use", { id: "openbot-computer-use", command: "node", args: [script] })],
    },
    (o) => {
      assert.deepEqual(o.keys, ["computer_use"]);
      assert.deepEqual(table(o.file, "openbot_computer_use"), []);
    },
  );
  await step(
    "a rename onto OpenBot's browser tools: the row is left out, and the chat starts",
    {
      name: "reserved",
      user: `[mcp_servers.browser]${NL}url = "${httpUrl}"${NL}enabled = true${NL}`,
      rows: [row("browser", { command: "node", args: [script] })],
    },
    (o) => {
      assert.equal(o.started, true, o.error ?? "");
      assert.deepEqual(o.keys, []);
      assert.ok(!o.offered.includes("mcp__openbot_browser"), `offered ${o.offered.join(", ")}`);
      assert.deepEqual(table(o.file, "openbot_browser"), []);
    },
  );

  await writeFile(
    join(OUT, "report.json"),
    `${JSON.stringify({ ok: true, codex: { version: cli.version }, steps }, null, 2)}${NL}`,
  );
  process.stdout.write(`codex-mcp-name-clash-e2e: ${steps.length} steps passed with Codex ${cli.version}${NL}`);
} catch (error) {
  await writeFile(
    join(OUT, "report.json"),
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), steps }, null, 2)}${NL}`,
  );
  process.stderr.write(
    `codex-mcp-name-clash-e2e failed: ${error instanceof Error ? error.message : String(error)}${NL}`,
  );
  process.exitCode = 1;
} finally {
  await http.close();
  await model.close();
}
