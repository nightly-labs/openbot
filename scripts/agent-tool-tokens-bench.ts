// Counts the tokens that OpenBot's own tools and instructions add to each Claude and Codex request.
// Codex: the real `codex app-server` sends one turn to a local fake Responses server, which records the
// request, so the count is what the model gets. Claude: the in-process MCP server that
// `claude-client.ts` gives the Claude CLI lists its tools to an in-memory MCP client; the CLI sends
// these schemas to the model. A `tool_search` result is counted too, because it brings catalog schemas.
// No account or key is used.
//
// `bun scripts/agent-tool-tokens-bench.ts`. Writes .openbot-build/agent-tool-tokens-bench/report.json.
// Token counts use the o200k encoding when OPENBOT_O200K_TOKENIZER names the
// `gpt-tokenizer/esm/encoding/o200k_base.js` file of an installed `gpt-tokenizer`. Without it, the
// report has bytes only. o200k is the Codex encoding; for Claude it is an estimate.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { type AgentSummary, DEFAULT_AGENT_DEFAULTS } from "@openbot/contracts/ipc";
import { developerInstructions } from "../src/backend/agent/developer-instructions";
import { CODEX_FEATURES_CONFIG } from "../src/backend/agent/thread-lifecycle";
import { discoverTools, visibleDynamicTools } from "../src/backend/agent/tool-catalog";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { OPENBOT_BROWSER_NAMESPACE } from "../src/backend/browser-tools";
import { claudeBrowserTools, claudeOpenBotTools } from "../src/backend/claude-client";
import { resolveCodexCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { decodeRecordResponse, getRecord, getString } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-tool-tokens-bench");
const NL = String.fromCharCode(10);
const DEADLINE_MS = 60_000;

type Encode = (text: string) => number[];
const tokenizerPath = process.env.OPENBOT_O200K_TOKENIZER;
const encode: Encode | null = tokenizerPath ? (await import(tokenizerPath)).encode : null;

const text = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));
function count(value: unknown) {
  const written = text(value);
  return { bytes: Buffer.byteLength(written), tokens: encode ? encode(written).length : null };
}

const agent: AgentSummary = {
  id: "agent-1",
  name: "Tester",
  title: "",
  description: "",
  notifications: false,
  provider: "codex",
  model: "gpt-5.5",
  reasoningEffort: "medium",
  threadId: null,
  workspacePath: "/workspace",
  preview: "",
  updatedAt: null,
  avatarSeed: "agent-1",
  avatarHue: null,
  avatarUrl: null,
};

/** The options that `ThreadLifecycle.#instructions` passes, with nothing connected and no section. */
function instructions(provider: "claude" | "codex"): string {
  const inTurns = provider === "claude";
  return developerInstructions({ ...agent, provider }, "/shared", [], "/automation", DEFAULT_AGENT_DEFAULTS, {
    computerUseInOwnChat: false,
    sideThread: false,
    passwordVault: false,
    storedMemoryCount: 0,
    memoriesInTurns: inTurns,
    teammatesInTurns: inTurns,
    sectionTeammates: null,
    homeSkills: [],
  });
}

interface ResponsesTool {
  name?: string;
  type?: string;
}

interface OutputItem {
  type: "message";
  role: "assistant";
  id: string;
  content: Array<{ type: "output_text"; text: string }>;
}

/** One server-sent event of a streamed Responses answer. */
interface StreamEvent {
  type: string;
  output_index?: number;
  item?: OutputItem;
  response?: { id: string; status: string; output?: OutputItem[]; usage?: Record<string, number> };
}

interface Recorded {
  body: string;
  tools: ResponsesTool[];
  developer: string[];
}

function startFakeModel() {
  const requests: Recorded[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed: {
        tools?: ResponsesTool[];
        input?: Array<{ role?: string; content?: Array<{ text?: string }> }>;
      } = JSON.parse(body || "{}");
      requests.push({
        body,
        tools: parsed.tools ?? [],
        developer: (parsed.input ?? [])
          .filter((item) => item.role === "developer")
          .flatMap((item) => (item.content ?? []).map((part) => part.text ?? "")),
      });
      const item: OutputItem = {
        type: "message",
        role: "assistant",
        id: "m",
        content: [{ type: "output_text", text: "done" }],
      };
      const send = (event: StreamEvent) =>
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
  return listen(server).then((listening) => ({ requests, ...listening }));
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

function deadline(what: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`No answer for ${what} in ${DEADLINE_MS} ms.`)), DEADLINE_MS).unref();
  });
}

const OPENBOT_NAMES = new Set(visibleDynamicTools("codex").flatMap((namespace) => [namespace.name]));

/** One Codex turn with OpenBot's visible tools and instructions; returns the largest request. */
async function codexRequest(root: string) {
  const cli = await runCauseEffect(resolveCodexCli());
  const model = await startFakeModel();
  try {
    const home = join(root, "codex");
    await mkdir(home, { recursive: true });
    await writeFile(
      join(home, "config.toml"),
      [
        'model = "fake-model"',
        'model_provider = "fake"',
        "[model_providers.fake]",
        'name = "fake"',
        `base_url = "http://127.0.0.1:${model.port}/v1"`,
        'env_key = "FAKE_KEY"',
        'wire_api = "responses"',
        "",
      ].join(NL),
    );
    const client = new CodexAppServerClient(cli.executable, 30_000, { CODEX_HOME: home, FAKE_KEY: "bench" });
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
          {
            clientInfo: { name: "openbot_bench", title: "OpenBot Bench", version: "0.0.0" },
            capabilities: { experimentalApi: true },
          },
          decodeRecordResponse,
        ),
      );
      client.notify("initialized");
      const started = await runCauseEffect(
        client.request(
          "thread/start",
          {
            cwd: home,
            approvalPolicy: "on-request",
            sandbox: "danger-full-access",
            model: "fake-model",
            config: CODEX_FEATURES_CONFIG,
            developerInstructions: instructions("codex"),
            serviceName: "openbot",
            dynamicTools: visibleDynamicTools("codex"),
          },
          decodeRecordResponse,
        ),
      );
      const threadId = getString(getRecord(started, "thread"), "id");
      assert(threadId, "thread/start returned no thread id");
      await runCauseEffect(
        client.request("turn/start", { threadId, input: [{ type: "text", text: "hello" }] }, decodeRecordResponse),
      );
      await Promise.race([turnDone, deadline("the Codex turn")]);
    } finally {
      await runCauseEffect(client.stop());
    }
    const request = model.requests.sort((a, b) => b.body.length - a.body.length)[0];
    assert(request, "Codex sent no model request.");
    const openbotTools = request.tools.filter((tool) => OPENBOT_NAMES.has(tool.name ?? ""));
    assert(openbotTools.length > 0, "Codex sent no openbot tools.");
    const ownInstructions = request.developer.filter((part) => part.includes("persistent local OpenBot teammate"));
    assert(ownInstructions.length > 0, "Codex sent no OpenBot instructions.");
    await writeFile(join(OUT, "codex-openbot-tools.json"), `${JSON.stringify(openbotTools, null, 2)}${NL}`);
    return {
      codexVersion: cli.version,
      request: count(request.body),
      openbotTools: count(openbotTools),
      instructions: count(ownInstructions.join(NL)),
    };
  } finally {
    await model.close();
  }
}

/** The tools that the Claude CLI gets from OpenBot's in-process MCP servers. */
async function claudeTools() {
  const empty = async () => ({ content: [] });
  const listed = [];
  for (const [name, tools] of [
    ["openbot", claudeOpenBotTools(empty)],
    [OPENBOT_BROWSER_NAMESPACE, claudeBrowserTools(empty)],
  ] as const) {
    const server = createSdkMcpServer({ name, version: "0.1.0", tools: [...tools] });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.instance.connect(serverTransport);
    const client = new Client({ name: "openbot-bench", version: "0.0.0" });
    await client.connect(clientTransport);
    try {
      const { tools: own } = await client.listTools();
      listed.push(...own.map((tool) => ({ ...tool, name: `mcp__${name}__${tool.name}` })));
    } finally {
      await client.close();
      await server.instance.close();
    }
  }
  await writeFile(join(OUT, "claude-openbot-tools.json"), `${JSON.stringify(listed, null, 2)}${NL}`);
  const byName = Object.fromEntries(listed.map((tool) => [tool.name, count(tool).tokens ?? count(tool).bytes]));
  return {
    tools: count(listed.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))),
    byName,
  };
}

/** Searches that an agent often makes. Each result stays in the context for the rest of the task. */
const SEARCHES = ["create routine", "send email gmail", "list tables", "browser open"];

function searchResults() {
  return Object.fromEntries(
    SEARCHES.map((query) => [
      query,
      count(
        discoverTools(
          {
            threadId: "t",
            turnId: "t",
            callId: "c",
            namespace: "openbot",
            tool: "tool_search",
            arguments: { query },
          },
          "codex",
        ),
      ),
    ]),
  );
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "openbot-tool-tokens-"));
type Count = ReturnType<typeof count>;
const report: {
  passed: boolean;
  encoding: "o200k_base" | null;
  /** Each tool that every request carries: its description and input schema. */
  visibleTools?: Record<string, Count>;
  claude?: { instructions: Count } & Awaited<ReturnType<typeof claudeTools>>;
  /** A tool_search result stays in the context for the rest of the task. */
  searchResults?: Record<string, Count>;
  codex?: Awaited<ReturnType<typeof codexRequest>>;
  error?: string;
} = { passed: false, encoding: encode ? "o200k_base" : null };
try {
  const visible = visibleDynamicTools("codex")[0];
  assert(visible, "No visible tools.");
  report.visibleTools = Object.fromEntries(
    visible.tools.map((tool) => [tool.name, count({ description: tool.description, inputSchema: tool.inputSchema })]),
  );
  report.claude = { instructions: count(instructions("claude")), ...(await claudeTools()) };
  report.searchResults = searchResults();
  report.codex = await codexRequest(root);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}${NL}`);
  process.stdout.write(`${report.passed ? "passed" : "failed"}: ${join(OUT, "report.json")}${NL}`);
}
