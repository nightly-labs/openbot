// Adapted from the report in nightly-labs/openbot#3824: "Gemini shows MCP errors for cloudflare and
// higgsfield servers". An agent saved an http MCP server that asks for a sign-in OpenBot does not
// hold. OpenBot gives such a row to the provider as written, the server answers 401, and Antigravity
// ends every turn with "The MCP server 'higgsfield' failed to initialize". Other providers start
// without that server. Runs the real Antigravity driver over a fake server that acts as 1.4.4 does.
// Cases: the turn resumes the session without the server and answers, the server is reported as a
// drop, a new session gets the server again (a sign-in or a fix can have changed it) and leaves it
// out the same way, and a failed server that OpenBot did not give
// (the user's own `mcp_config.json`) stays the turn's error. A last case sends the failure message
// before the stderr line: the turn still goes on, and the message is not shown as an answer.
// `bun run test:antigravity-mcp-load-failure`. Writes
// .openbot-build/antigravity-mcp-load-failure-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import type { McpServerDrop } from "../src/backend/mcp-provider-shapes";
import { getString } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients, type TurnResult } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-mcp-load-failure-e2e");

interface LogEntry {
  method: string;
  sessionId: string;
  names?: string[];
  failed?: string | null;
}

interface Report {
  passed: boolean;
  turns: Record<string, TurnResult>;
  requests?: LogEntry[];
  drops?: McpServerDrop[];
  stdoutFirstDeltas?: string[];
  error?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-mcp-load-failure-e2e-"));
const report: Report = { passed: false, turns: {} };
const clients: AgentClient[] = [];

function httpServer(id: string, name: string, url: string): McpServerConfig {
  return {
    id,
    name,
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

try {
  const executable = join(root, "agy", "bin", "agy_acp_server");
  const workspace = join(root, "workspace");
  const release = join(root, "release");
  const log = join(root, "requests.jsonl");
  await mkdir(workspace, { recursive: true });
  await mkdir(release, { recursive: true });
  await installFakeAgent(executable, "antigravity-mcp-load-failure", { FAKE_LOG: log, FAKE_RELEASE: release });

  const drops: McpServerDrop[] = [];
  const servers = [
    httpServer("higgsfield", "higgsfield", "https://mcp.higgsfield.example/mcp"),
    httpServer("docs", "docs", "https://docs.example/mcp"),
  ];
  const cli: AgentCliInfo = { executable, version: "1.4.4", source: "managed" };
  const client = requireProviderDriver("antigravity").createClient(cli, 20_000, {
    apiKey: () => null,
    customProviders: () => [],
    mcpServers: () => servers,
    reportMcpDrops: (_provider, dropped) => drops.push(...dropped),
  });
  clients.push(client);
  // The fake answers a failed prompt once the client has read its stderr line.
  client.on("diagnostic", (message: string) => {
    const session = /error processing prompt for session (\S+)/u.exec(message)?.[1];
    if (session) void writeFile(join(release, session), "");
  });
  client.start();

  // 1. The server that OpenBot gave fails: the session opens again without it, and the turn answers.
  const thread = await startThread(client, { cwd: workspace });
  const first = await runTurn(client, thread, { text: "Reply with OK only.", timeoutMs: 30_000 });
  report.turns.first = first;
  assert.equal(first.error, null, "The turn has no error.");
  assert.equal(first.status, "completed", "The turn completes.");
  assert.equal(first.reply, "OK", "The turn answers after the session opens again.");
  assert.deepEqual(
    drops.map((drop) => [drop.name, drop.reason]),
    [["higgsfield", "failed_to_start"]],
    "The server is reported as left out.",
  );
  assert.match(drops[0]?.detail ?? "", /Unauthorized/u, "The report gives the server's reason.");

  // 2. A new session gets the server again, and leaves it out again when it still fails.
  const second = await startThread(client, { cwd: workspace });
  const secondTurn = await runTurn(client, second, { text: "Reply with OK only.", timeoutMs: 30_000 });
  report.turns.second = secondTurn;
  assert.equal(secondTurn.error, null, "The new session's turn has no error.");
  assert.equal(secondTurn.reply, "OK", "The new session answers.");
  assert.deepEqual(
    drops.map((drop) => drop.name),
    ["higgsfield", "higgsfield"],
    "Each session reports the server that it left out.",
  );

  // 3. A server that OpenBot did not give is not OpenBot's to leave out: the turn fails as before.
  const foreign = await runTurn(client, thread, { text: "fail cloudflare", timeoutMs: 30_000 });
  report.turns.foreign = foreign;
  assert.equal(foreign.status, "failed", "The turn fails.");
  assert.match(foreign.error ?? "", /cloudflare/u, "The error names the server.");

  const requests = await readJsonl<LogEntry>(log);
  report.requests = requests;
  report.drops = drops;
  const sessionsOf = (method: string) => requests.filter((request) => request.method === method && request.names);
  const opened = sessionsOf("session/new").filter((request) => request.names?.includes("docs"));
  assert.equal(opened.length, 2, "Each thread opens one session with the user's servers.");
  assert.ok(opened[0]?.names?.includes("higgsfield"), "The first session gets every server.");
  assert.ok(opened[1]?.names?.includes("higgsfield"), "A new session gets the server again.");
  const resumed = sessionsOf("session/resume");
  assert.deepEqual(
    resumed.map((request) => request.sessionId),
    [opened[0]?.sessionId, opened[1]?.sessionId],
    "Each failed turn resumes its own session once.",
  );
  assert.ok(!resumed[0]?.names?.includes("higgsfield"), "The resumed session does not get the failed server.");
  assert.ok(resumed[0]?.names?.includes("docs"), "The resumed session keeps the other servers.");
  assert.deepEqual(
    resumed[0]?.names?.filter((name) => !opened[0]?.names?.includes(name)),
    [],
    "The resumed session keeps the same OpenBot tools.",
  );
  const prompts = requests.filter((request) => request.method === "session/prompt");
  assert.deepEqual(
    prompts.map((request) => request.failed),
    ["higgsfield", null, "higgsfield", null, "cloudflare"],
    "The failed prompt is sent once more, and only once.",
  );

  // 4. The failure message comes before the stderr line.
  const stdoutFirst = join(root, "agy-stdout-first", "bin", "agy_acp_server");
  await installFakeAgent(stdoutFirst, "antigravity-mcp-load-failure", {
    FAKE_LOG: join(root, "stdout-first.jsonl"),
    FAKE_STDOUT_FIRST: "1",
  });
  const late = requireProviderDriver("antigravity").createClient(
    { executable: stdoutFirst, version: "1.4.4", source: "managed" },
    20_000,
    { apiKey: () => null, customProviders: () => [], mcpServers: () => servers },
  );
  clients.push(late);
  const deltas: string[] = [];
  late.on("notification", (notification) => {
    if (notification.method === "item/agentMessage/delta") deltas.push(getString(notification.params, "delta") ?? "");
  });
  late.start();
  const lateThread = await startThread(late, { cwd: workspace });
  const lateTurn = await runTurn(late, lateThread, { text: "Reply with OK only.", timeoutMs: 30_000 });
  report.turns.stdoutFirst = lateTurn;
  report.stdoutFirstDeltas = deltas;
  assert.equal(lateTurn.error, null, "The turn has no error when the message comes first.");
  assert.equal(lateTurn.reply, "OK", "The turn answers when the message comes first.");
  assert.deepEqual(deltas, ["OK"], "The failure message is not shown as an answer.");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
