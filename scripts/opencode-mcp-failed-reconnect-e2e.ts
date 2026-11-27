import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import type { AgentClient } from "../src/backend/agent-client";
import { resolveOpencodeCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MCP_RECONNECT_HEADER } from "../src/backend/mcp-provider-shapes";
import type { CustomProviderConfig } from "../src/backend/opencode-config";
import { getArray, getRecord, getString, isRecord } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { runTurn, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-mcp-failed-reconnect");
const ENDPOINT = "spark";
const MODEL = "agent-model";
const SERVER = "savantlook";
const TOKEN = "e2e-token";
const TOOL_ANSWER = "stats-ok";
const run = promisify(execFile);

interface Report {
  passed: boolean;
  openCodeVersion?: string;
  whileDown: string | null;
  afterUpSameSettings: string | null;
  afterReconnect: string | null;
  toolCalls: number;
  reconnectHeaders: string[];
  error?: string;
}

const report: Report = {
  passed: false,
  whileDown: null,
  afterUpSameSettings: null,
  afterReconnect: null,
  toolCalls: 0,
  reconnectHeaders: [],
};

async function readBody(request: IncomingMessage): Promise<DynamicRecord | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  const parsed = text ? JSON.parse(text) : null;
  return isRecord(parsed) ? parsed : null;
}

function sse(response: ServerResponse, delta: unknown, finish: string): void {
  const chunk = (value: unknown, reason: string | null) =>
    `data: ${JSON.stringify({ id: "e2e", object: "chat.completion.chunk", created: 0, model: MODEL, choices: [{ index: 0, delta: value, finish_reason: reason }] })}\n\n`;
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  response.write(chunk(delta, null));
  response.write(chunk({}, finish));
  response.end("data: [DONE]\n\n");
}

const toolResults: string[] = [];
let calls = 0;
const model = createServer((request, response) => {
  void (async () => {
    const body = await readBody(request);
    const last = getArray(body, "messages").at(-1);
    const content = isRecord(last) ? last.content : undefined;
    const tools = getArray(body, "tools").flatMap((tool) => getString(getRecord(tool, "function"), "name") ?? []);
    if (getString(last, "role") === "tool") {
      toolResults.push(typeof content === "string" ? content : JSON.stringify(content ?? ""));
      sse(response, { role: "assistant", content: "done" }, "stop");
      return;
    }
    if (!tools.includes("execute")) {
      sse(response, { role: "assistant", content: "Title" }, "stop");
      return;
    }
    calls += 1;
    const code = `return JSON.stringify(await tools[${JSON.stringify(SERVER)}]["today-stats"]({}))`;
    sse(
      response,
      {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `call_${calls}`,
            type: "function",
            function: { name: "execute", arguments: JSON.stringify({ code }) },
          },
        ],
      },
      "tool_calls",
    );
  })().catch((error: unknown) => {
    response.writeHead(500);
    response.end(String(error));
  });
});

function mcpServer(): Server {
  return createServer((request, response) => {
    void (async () => {
      if (request.headers.authorization !== `Bearer ${TOKEN}`) {
        response.writeHead(401).end();
        return;
      }
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      const message = await readBody(request);
      const id = message?.id;
      if (id === undefined) {
        response.writeHead(202).end();
        return;
      }
      const method = getString(message, "method");
      const reconnect = request.headers[MCP_RECONNECT_HEADER.toLowerCase()];
      if (method === "tools/call") {
        report.toolCalls += 1;
        if (typeof reconnect === "string") report.reconnectHeaders.push(reconnect);
      }
      const result =
        method === "initialize"
          ? {
              protocolVersion: getString(getRecord(message, "params"), "protocolVersion"),
              capabilities: { tools: {} },
              serverInfo: { name: SERVER, version: "1" },
            }
          : method === "tools/list"
            ? {
                tools: [
                  {
                    name: "today-stats",
                    description: "Today's stats.",
                    inputSchema: { type: "object", properties: {} },
                  },
                ],
              }
            : method === "tools/call"
              ? { content: [{ type: "text", text: TOOL_ANSWER }] }
              : {};
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
    })().catch((error: unknown) => {
      response.writeHead(500);
      response.end(String(error));
    });
  });
}

async function freePort(): Promise<number> {
  const probe = createTcpServer();
  await new Promise<void>((listening) => probe.listen(0, "127.0.0.1", listening));
  const address = probe.address();
  await new Promise<void>((closed) => probe.close(() => closed()));
  if (!address || typeof address === "string") throw new Error("The port probe has no port.");
  return address.port;
}

async function startThread(client: AgentClient, cwd: string): Promise<string> {
  const response = await runCauseEffect(
    client.request(
      "thread/start",
      { cwd, model: `${ENDPOINT}/${MODEL}`, openbotAgentId: "agent-e2e" },
      (value) => value,
    ),
  );
  const id = getString(getRecord(response, "thread"), "id");
  if (!id) throw new Error("thread/start answers no thread id.");
  return id;
}

async function callServerTool(client: AgentClient, cwd: string): Promise<string | null> {
  const before = toolResults.length;
  const thread = await startThread(client, cwd);
  const turn = await runTurn(client, thread, { text: "Read today's stats.", timeoutMs: 120_000 });
  assert.equal(turn.error, null, `The turn failed: ${turn.error}`);
  return toolResults[before] ?? null;
}

const root = await mkdtemp(join(tmpdir(), "openbot-opencode-mcp-failed-reconnect-"));
const clients: AgentClient[] = [];
const upstream = mcpServer();
let cliPath: string | null = null;
try {
  await new Promise<void>((listening) => model.listen(0, "127.0.0.1", listening));
  const address = model.address();
  if (!address || typeof address === "string") throw new Error("The fake endpoint has no port.");
  for (const [name, folder] of [
    ["HOME", "home"],
    ["XDG_CONFIG_HOME", "config"],
    ["XDG_DATA_HOME", "data"],
    ["XDG_STATE_HOME", "state"],
    ["XDG_CACHE_HOME", "cache"],
  ] as const) {
    process.env[name] = join(root, folder);
    await mkdir(join(root, folder), { recursive: true });
  }
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  const endpoint: CustomProviderConfig = {
    id: ENDPOINT,
    name: "Spark",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: null,
    headers: [],
    models: [{ id: MODEL, name: "Agent model" }],
  };
  const mcpPort = await freePort();
  const server: McpServerConfig = {
    id: "mcp-e2e",
    name: SERVER,
    transport: "http",
    enabled: true,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: `http://127.0.0.1:${mcpPort}/mcp`,
    headers: [{ key: "Authorization", value: `Bearer ${TOKEN}` }],
  };
  let reconnects = 0;

  const cli = await runCauseEffect(resolveOpencodeCli({ bundledExecutable: process.env.OPENCODE_CLI }));
  report.openCodeVersion = cli.version;
  cliPath = cli.executable;
  await run(cli.executable, ["service", "set", "port", String(await freePort())], { env: process.env });

  const client = requireProviderDriver("opencode").createClient(cli, 120_000, {
    apiKey: () => null,
    customProviders: () => [endpoint],
    mcpServers: () => [server],
    mcpReconnect: (mcpServerId) => (mcpServerId === server.id ? reconnects : 0),
    providerStateDirectory: join(root, "provider-state"),
  });
  clients.push(client);
  client.start();

  report.whileDown = await callServerTool(client, workspace);
  assert.match(report.whileDown ?? "", /Unknown tool/, "The tool must be missing while the server is down.");

  await new Promise<void>((listening) => upstream.listen(mcpPort, "127.0.0.1", listening));
  report.afterUpSameSettings = await callServerTool(client, workspace);

  reconnects += 1;
  report.afterReconnect = await callServerTool(client, workspace);
  assert.ok(
    report.afterReconnect?.includes(TOOL_ANSWER),
    `After a reconnect the tool must answer: ${report.afterReconnect}`,
  );
  assert.deepEqual(report.reconnectHeaders, ["1"], "The answered call must carry the new reconnect value.");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  if (cliPath) await run(cliPath, ["service", "stop"], { env: process.env }).catch(() => undefined);
  model.close();
  upstream.close();
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "passed" : "failed"}: ${join(OUT, "report.json")}\n`);
}
