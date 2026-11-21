import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { visibleDynamicTools } from "../src/backend/agent/tool-catalog";
import type { AgentClient } from "../src/backend/agent-client";
import { resolvePiCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { CustomProviderConfig } from "../src/backend/opencode-config";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { runTurn, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-mcp-deferred-e2e");
const NL = String.fromCharCode(10);
const TOOL = "ping_fixture";

const STDIO_SERVER = `
const readline = require("node:readline");
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + String.fromCharCode(10));
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "stdio", version: "1" } } });
  } else if (message.method === "tools/list") {
    send({ id: message.id, result: { tools: [{ name: "${TOOL}", description: "Answers pong.", inputSchema: { type: "object", properties: {} } }] } });
  } else if (message.id !== undefined) {
    send({ id: message.id, result: {} });
  }
});
`;

interface ChatRequest {
  tools?: Array<{ function?: { name?: string } }>;
  messages?: Array<{ role?: string; content?: string | Array<{ text?: string }> }>;
}

interface Report {
  passed: boolean;
  piVersion?: string;
  requests: string[][];
  servers?: string;
  toolResults?: string;
  secondToolResult?: string;
  reply?: string;
  secondReply?: string;
  error?: string;
}

const report: Report = { passed: false, requests: [] };
const root = await mkdtemp(join(tmpdir(), "openbot-pi-deferred-e2e-"));
const clients: AgentClient[] = [];
const systems: string[] = [];

function messageText({ content }: { content?: string | Array<{ text?: string }> }): string {
  return typeof content === "string" ? content : (content ?? []).map((part) => part.text).join("");
}

async function body(request: IncomingMessage): Promise<ChatRequest> {
  const chunks: Buffer[] = [];
  for await (const part of request) chunks.push(Buffer.from(part));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

interface Delta {
  role?: "assistant";
  content?: string;
  tool_calls?: Array<{ index: number; id?: string; type?: string; function: { name?: string; arguments: string } }>;
}

function event(delta: Delta, finish: string | null): string {
  const value = {
    id: "chatcmpl-e2e",
    object: "chat.completion.chunk",
    created: 0,
    model: "fake-coder",
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  return `data: ${JSON.stringify(value)}${NL}${NL}`;
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  void (async () => {
    const parsed = await body(request);
    const names = (parsed.tools ?? []).flatMap((tool) => tool.function?.name ?? []).sort();
    if (names.length > 0) {
      report.requests.push(names);
      systems.push(
        (parsed.messages ?? [])
          .filter((message) => message.role === "system")
          .map(({ content }) =>
            typeof content === "string" ? content : (content ?? []).map((part) => part.text).join(""),
          )
          .join(NL),
      );
      const toolMessages = (parsed.messages ?? []).filter((message) => message.role === "tool");
      if (report.requests.length === 2) report.toolResults = toolMessages.map(messageText).join(NL);
      if (report.requests.length === 4) report.secondToolResult = messageText(toolMessages.at(-1) ?? {});
    }
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    if (names.length > 0 && (report.requests.length === 1 || report.requests.length === 3)) {
      const id = `call_${report.requests.length}`;
      const call = { index: 0, id, type: "function", function: { name: "tool_search", arguments: "" } };
      response.write(event({ role: "assistant", tool_calls: [call] }, null));
      const args = JSON.stringify({ query: TOOL });
      response.write(event({ tool_calls: [{ index: 0, function: { arguments: args } }] }, null));
      response.write(event({}, "tool_calls"));
    } else {
      response.write(event({ role: "assistant", content: "done" }, null));
      response.write(event({}, "stop"));
    }
    response.end(`data: [DONE]${NL}${NL}`);
  })().catch((error: unknown) => {
    response.writeHead(500);
    response.end(String(error));
  });
});

try {
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The fake endpoint has no port.");

  const agentDirectory = join(root, "agent");
  await mkdir(agentDirectory, { recursive: true });
  await writeFile(join(agentDirectory, "settings.json"), "{}\n");
  await writeFile(join(agentDirectory, "auth.json"), "{}");
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  const script = join(root, "mcp-server.cjs");
  await writeFile(script, STDIO_SERVER);

  const endpoint: CustomProviderConfig = {
    id: "spark-e2e",
    name: "Spark E2E",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "sk-e2e",
    headers: [],
    models: [{ id: "fake-coder", name: "Fake coder", contextWindow: 32_768 }],
    harness: "pi",
  };
  const fixture: McpServerConfig = {
    id: "row-fixture",
    name: "fixture",
    transport: "stdio",
    enabled: true,
    command: process.execPath,
    args: [script],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  };

  const cli = await runCauseEffect(resolvePiCli({ bundledExecutable: process.env.PI_CLI }));
  report.piVersion = cli.version;
  const client = requireProviderDriver("pi").createClient(cli, 60_000, {
    apiKey: () => null,
    customProviders: () => [endpoint],
    mcpServers: () => [fixture],
    providerStateDirectory: join(root, "state"),
  });
  clients.push(client);
  client.start();

  const started = await runCauseEffect(
    client.request(
      "thread/start",
      { cwd: workspace, model: "spark-e2e/fake-coder", dynamicTools: visibleDynamicTools("pi") },
      (value) => value,
    ),
  );
  const thread = JSON.stringify(started).match(/"id":"([^"]+)"/u)?.[1];
  assert.ok(thread, "thread/start answers no thread id.");
  const turn = await runTurn(client, thread, { text: "Find the ping tool.", timeoutMs: 60_000 });
  report.reply = turn.reply;
  assert.equal(turn.error, null, `The turn failed: ${turn.error}`);

  const [first, second] = report.requests;
  assert.ok(first && second, `Pi sent ${report.requests.length} requests, not 2.`);
  const external = (names: string[]) => names.filter((name) => name.startsWith("mcp__") && name.endsWith(TOOL));
  const bridge = (names: string[]) => names.filter((name) => name.startsWith("mcp__") && !name.endsWith(TOOL));
  assert.deepEqual(external(first), [], `The first request declares the user's tool: ${first.join(", ")}`);
  assert.ok(first.includes("tool_search"), `The first request has no tool_search: ${first.join(", ")}`);
  assert.ok(bridge(first).length > 0, `The first request declares no OpenBot tool: ${first.join(", ")}`);
  assert.equal(external(second).length, 1, `tool_search did not load the user's tool: ${second.join(", ")}`);
  const openbotSearch = bridge(first).find((name) => name.endsWith("__tool_search"));
  assert.ok(openbotSearch, `The first request has no OpenBot tool_search: ${first.join(", ")}`);
  assert.ok(
    report.toolResults?.includes(`find them with ${openbotSearch},`),
    `Pi's tool_search result does not name ${openbotSearch}: ${report.toolResults}`,
  );
  report.servers = systems[0]?.match(/<mcp_servers>[\s\S]*?<\/mcp_servers>/u)?.[0] ?? "";
  assert.match(report.servers, /\(tool_search\): fixture$/mu, "The system prompt does not name the server.");
  assert.ok(!systems.some((system) => system.includes("<docs>")), "The system prompt has Pi's <docs> section.");
  assert.equal(systems[1], systems[0], "The system prompt changed after tool_search.");
  const loadedNote = "This search does not show tools that an earlier search loaded.";
  assert.ok(
    !report.toolResults?.includes(loadedNote),
    `A search that found tools has the empty note: ${report.toolResults}`,
  );

  const again = await runTurn(client, thread, { text: "Find the ping tool again.", timeoutMs: 60_000 });
  report.secondReply = again.reply;
  assert.equal(again.error, null, `The second turn failed: ${again.error}`);
  const [, , third, fourth] = report.requests;
  assert.ok(third && fourth, `Pi sent ${report.requests.length} requests, not 4.`);
  assert.equal(external(third).length, 1, `The second turn does not declare the loaded tool: ${third.join(", ")}`);
  assert.ok(
    report.secondToolResult?.includes("No matching tools found"),
    `The second tool_search found tools: ${report.secondToolResult}`,
  );
  assert.ok(
    report.secondToolResult?.includes(loadedNote),
    `The empty tool_search result does not say that loaded tools stay loaded: ${report.secondToolResult}`,
  );
  assert.ok(
    report.secondToolResult?.includes(`find them with ${openbotSearch},`),
    `The empty tool_search result does not name ${openbotSearch}: ${report.secondToolResult}`,
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  server.close();
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}${NL}`);
  process.stdout.write(`${report.passed ? "passed" : "failed"}: ${join(OUT, "report.json")}${NL}`);
}
