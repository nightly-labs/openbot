import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { ClaudeAgentClient } from "../src/backend/claude-client";
import { resolveClaudeCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getRecord, getString, isRecord } from "../src/backend/protocol";
import { makeGitWorkspace, removeRun } from "./claude-agent-harness";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-routine-mcp-reconnect-e2e");
const MODEL = "claude-haiku-5-5";
const FAIL_MS = 8_000;
const MARKER = "REPORT-16316-OK";
const PROMPT =
  "Call the tool get_daily_report of the MCP server named reports, then reply with its exact output. " +
  "If you cannot find or call that tool, reply UNAVAILABLE.";

interface ScenarioReport {
  scenario: "routine" | "chat";
  persistSession: boolean;
  threadStartMs: number;
  toolCalled: boolean;
  answer: string;
  failedNotices: string[];
  serverLog: string[];
  error: string | null;
}

function fakeServer(failForMs: number) {
  const startedAt = Date.now();
  const log: string[] = [];
  const note = (text: string) => log.push(`+${Date.now() - startedAt}ms ${text}`);
  const tools = [
    { name: "get_daily_report", description: "Returns the daily report.", inputSchema: { type: "object" } },
  ];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (request.method !== "POST") return new Response(null, { status: request.method === "DELETE" ? 200 : 405 });
      const body = await request.json();
      const method = getString(body, "method") ?? "";
      const id = isRecord(body) ? body.id : undefined;
      if (Date.now() - startedAt < failForMs) {
        note(`${method} 502`);
        return Response.json(
          { jsonrpc: "2.0", id: null, error: { code: -32603, message: "unreachable" } },
          { status: 502 },
        );
      }
      note(method);
      if (id === undefined) return new Response(null, { status: 202 });
      const reply = (result: unknown) =>
        Response.json({ jsonrpc: "2.0", id, result }, { headers: { "mcp-session-id": "e2e" } });
      if (method === "initialize")
        return reply({
          protocolVersion: getString(getRecord(body, "params"), "protocolVersion") ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "reports", version: "1.0.0" },
        });
      if (method === "tools/list") return reply({ tools });
      if (method === "tools/call") return reply({ content: [{ type: "text", text: MARKER }] });
      return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unknown method" } });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/mcp`, log, stop: () => server.stop(true) };
}

function httpServer(url: string): McpServerConfig {
  return {
    id: "reports",
    name: "reports",
    transport: "http",
    enabled: true,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url,
    headers: [],
  };
}

async function runScenario(root: string, scenario: ScenarioReport["scenario"]): Promise<ScenarioReport> {
  const persistSession = scenario === "chat";
  const workspace = join(root, scenario);
  mkdirSync(workspace, { recursive: true });
  await makeGitWorkspace(workspace);
  const server = fakeServer(FAIL_MS);
  const cli = await runCauseEffect(resolveClaudeCli());
  const client = new ClaudeAgentClient(
    cli,
    undefined,
    undefined,
    120_000,
    () => [httpServer(server.url)],
    undefined,
    undefined,
    undefined,
    join(root, `${scenario}-state`),
    undefined,
    undefined,
    undefined,
    () => true,
  );
  const report: ScenarioReport = {
    scenario,
    persistSession,
    threadStartMs: 0,
    toolCalled: false,
    answer: "",
    failedNotices: [],
    serverLog: server.log,
    error: null,
  };
  let finish: () => void = () => {};
  const done = new Promise<void>((resolveDone) => {
    finish = resolveDone;
  });
  client.on("notification", (notification: AppServerNotification) => {
    const params = notification.params;
    if (notification.method === "mcpServer/startupStatus/updated" && getString(params, "status") === "failed")
      report.failedNotices.push(getString(params, "name") ?? "");
    if (notification.method === "item/completed") {
      const item = getRecord(params, "item");
      if (getString(item, "type") === "agentMessage" && getString(item, "phase") === null)
        report.answer += getString(item, "text") ?? "";
    }
    if (notification.method === "turn/completed") finish();
  });
  client.on("request", (request) => client.respond(request.id, { decision: "accept" }));
  client.start();
  try {
    const startedAt = Date.now();
    const threadId = await runCauseEffect(
      client.request(
        "thread/start",
        {
          cwd: workspace,
          model: MODEL,
          developerInstructions: "You are Ada, an assistant that runs daily routines.",
          persistSession,
        },
        (value) => getString(getRecord(value, "thread"), "id") ?? "",
      ),
    );
    report.threadStartMs = Date.now() - startedAt;
    await runCauseEffect(
      client.request("turn/start", { threadId, model: MODEL, input: [{ type: "text", text: PROMPT }] }, (v) => v),
    );
    await done;
    report.toolCalled = server.log.some((line) => line.endsWith(" tools/call"));
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    await runCauseEffect(client.stop()).catch(() => undefined);
    server.stop();
  }
  return report;
}

const root = await realpath(await mkdtemp(join(tmpdir(), "openbot-claude-routine-mcp-reconnect-e2e-")));
const routine = await runScenario(root, "routine");
const chat = await runScenario(root, "chat");
await removeRun(root);
await rm(root, { recursive: true, force: true });
const passed =
  routine.error === null &&
  routine.toolCalled &&
  routine.answer.includes(MARKER) &&
  routine.failedNotices.length === 0 &&
  chat.error === null;
const result = { model: MODEL, failForMs: FAIL_MS, passed, routine, chat };
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\nReport: ${join(OUT, "report.json")}\n`);
process.exit(passed ? 0 : 1);
