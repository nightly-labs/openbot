import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { AgentClient } from "../src/backend/agent-client";
import { resolveOpencodeCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { CustomProviderConfig } from "../src/backend/opencode-config";
import { getArray, getRecord, getString, isRecord } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { runTurn, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-tools-lost");
const ENDPOINT = "spark";
const MODEL = "agent-model";
const LONG_TURN_MS = 31_000;
const TOOLS_NOT_LOADED = "ran this message without OpenBot's tools";
const run = promisify(execFile);

interface Report {
  passed: boolean;
  openCodeVersion?: string;
  bridgeConnects: number;
  refusedConnects: number;
  toolCalls: string[];
  toolResults: string[];
  turns: Array<{ reply: string; error: string | null; status: string | null }>;
  error?: string;
}

const report: Report = {
  passed: false,
  bridgeConnects: 0,
  refusedConnects: 0,
  toolCalls: [],
  toolResults: [],
  turns: [],
};

let refuse = true;
const connect = Server.prototype.connect;
Server.prototype.connect = async function (this: Server, ...args: Parameters<typeof connect>) {
  report.bridgeConnects += 1;
  if (refuse) {
    report.refusedConnects += 1;
    throw new Error("The bridge refuses the connection.");
  }
  return connect.apply(this, args);
};

interface ChatRequest {
  lastRole: string | null;
  lastContent: string;
  tools: string[];
}

async function readChatRequest(request: IncomingMessage): Promise<ChatRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  const body = text ? JSON.parse(text) : null;
  const last = getArray(body, "messages").at(-1);
  const content = isRecord(last) ? last.content : undefined;
  return {
    lastRole: getString(last, "role"),
    lastContent: typeof content === "string" ? content : JSON.stringify(content ?? ""),
    tools: getArray(body, "tools").flatMap((tool) => getString(getRecord(tool, "function"), "name") ?? []),
  };
}

function sse(response: ServerResponse, delta: unknown, finish: string): void {
  const chunk = (value: unknown, reason: string | null) =>
    `data: ${JSON.stringify({ id: "e2e", object: "chat.completion.chunk", created: 0, model: MODEL, choices: [{ index: 0, delta: value, finish_reason: reason }] })}\n\n`;
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  response.write(chunk(delta, null));
  response.write(chunk({}, finish));
  response.end("data: [DONE]\n\n");
}

let prompts = 0;
const model = createServer((request, response) => {
  void (async () => {
    const { lastRole, lastContent, tools } = await readChatRequest(request);
    if (lastRole === "tool") {
      report.toolResults.push(lastContent);
      sse(response, { role: "assistant", content: `result ${lastContent}` }, "stop");
      return;
    }
    if (!tools.includes("execute")) {
      sse(response, { role: "assistant", content: "Title" }, "stop");
      return;
    }
    prompts += 1;
    if (prompts === 1) await new Promise((wait) => setTimeout(wait, LONG_TURN_MS));
    sse(
      response,
      {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `call_${prompts}`,
            type: "function",
            function: { name: "execute", arguments: JSON.stringify({ code: "return await tools.openbot.whoami({})" }) },
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
      {
        cwd,
        model: `${ENDPOINT}/${MODEL}`,
        dynamicTools: [
          {
            type: "namespace",
            name: "openbot",
            tools: [
              {
                type: "function",
                name: "whoami",
                description: "Return the thread id.",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          },
        ],
      },
      (value) => value,
    ),
  );
  const id = getString(getRecord(response, "thread"), "id");
  if (!id) throw new Error("thread/start answers no thread id.");
  return id;
}

const root = await mkdtemp(join(tmpdir(), "openbot-opencode-tools-lost-"));
const clients: AgentClient[] = [];
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

  const cli = await runCauseEffect(resolveOpencodeCli({ bundledExecutable: process.env.OPENCODE_CLI }));
  report.openCodeVersion = cli.version;
  cliPath = cli.executable;
  await run(cli.executable, ["service", "set", "port", String(await freePort())], { env: process.env });

  const client = requireProviderDriver("opencode").createClient(cli, 120_000, {
    apiKey: () => null,
    customProviders: () => [endpoint],
    mcpServers: () => [],
    providerStateDirectory: join(root, "provider-state"),
  });
  clients.push(client);
  client.on("request", (request) => {
    if (request.method !== "item/tool/call") return;
    const threadId = getString(request.params, "threadId") ?? "";
    report.toolCalls.push(`${getString(request.params, "namespace")}.${getString(request.params, "tool")}`);
    client.respond(request.id, { success: true, contentItems: [{ type: "inputText", text: `thread=${threadId}` }] });
  });
  client.start();

  const thread = await startThread(client, workspace);
  const firstTurn = await runTurn(client, thread, { text: "Call whoami.", timeoutMs: 180_000 });
  report.turns.push(firstTurn);
  refuse = false;
  assert.ok(report.refusedConnects > 0, "The bridge must refuse the first connection.");
  assert.ok(
    firstTurn.error?.includes(TOOLS_NOT_LOADED),
    `The first turn must say that it ran without OpenBot's tools: ${firstTurn.error}`,
  );
  assert.equal(report.toolCalls.length, 0, "The first turn must not reach OpenBot's tool.");

  const secondTurn = await runTurn(client, thread, { text: "Call whoami.", timeoutMs: 180_000 });
  report.turns.push(secondTurn);
  assert.equal(secondTurn.error, null, `The second turn failed: ${secondTurn.error}`);
  assert.deepEqual(report.toolCalls, ["openbot.whoami"], "The second turn must reach OpenBot's tool.");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  Server.prototype.connect = connect;
  await stopClients(clients);
  if (cliPath) await run(cliPath, ["service", "stop"], { env: process.env }).catch(() => undefined);
  model.closeAllConnections();
  await new Promise<void>((closed) => model.close(() => closed()));
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "passed" : "failed"}: ${join(OUT, "report.json")}\n`);
}
