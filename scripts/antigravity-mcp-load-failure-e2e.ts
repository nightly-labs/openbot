// Adapted from the report in nightly-labs/openbot#3824: "Gemini shows MCP errors for cloudflare and
// higgsfield servers". An agent saved an http MCP server that asks for a sign-in OpenBot does not
// hold. OpenBot gives such a row to the provider as written, the server answers 401, and Antigravity
// ends every turn with "The MCP server 'higgsfield' failed to initialize". Other providers start
// without that server. Runs the real Antigravity driver for CLI 1.5.4 over a fake that sends the
// failure as 1.4.4 does, a form that OpenBot still accepts.
// Cases: the turn resumes the session without the server and answers, the server is reported as a
// drop, a new session gets the server again (a sign-in or a fix can have changed it) and leaves it
// out the same way, and a failed server that OpenBot did not give
// (the user's own `mcp_config.json`) stays the turn's error. A last case sends the failure message
// before the stderr line: the turn still goes on, and the message is not shown as an answer.
// From #7785: the user's own `mcp_config.json` has a server with the name of one that OpenBot gives.
// The CLI then starts only its own entry, so OpenBot's server travels as `openbot_<name>`.
// From #7228: the CLI 1.5.6 refuses a tool schema of a server that started, names the tool only in
// its own log, and keeps the server after a resume in the same process. The session opens again on a
// new process without the server, and the turn answers. A refused tool of the user's own server
// leaves out no server of OpenBot's, also when an OpenBot server name is the start of its name.
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

interface RefusedEntry {
  method: string;
  sessionId: string;
  pid: number;
  names?: string[];
  refused?: string | null;
}

interface Report {
  passed: boolean;
  turns: Record<string, TurnResult>;
  requests?: LogEntry[];
  drops?: McpServerDrop[];
  stdoutFirstDeltas?: string[];
  ownNames?: string[] | undefined;
  refused?: RefusedEntry[];
  refusedDrops?: McpServerDrop[];
  error?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-mcp-load-failure-e2e-"));
const report: Report = { passed: false, turns: {} };
const clients: AgentClient[] = [];
// The driver reads and writes the sign-in in the Gemini home. Keep it off the user's `~/.gemini`.
process.env.GEMINI_HOME = join(root, "gemini");

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
  const executable = join(root, "agy", "bin", "antigravity");
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
  const cli: AgentCliInfo = { executable, version: "1.5.4", source: "managed" };
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
  // The server's own reason is runtime output, such as a traceback with a path (#7046).
  assert.doesNotMatch(foreign.error ?? "", /Unauthorized|Fix the MCP server/u, "The error has no raw server output.");

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
    resumed.slice(0, 2).map((request) => request.sessionId),
    [opened[0]?.sessionId, opened[1]?.sessionId],
    "Each failed turn resumes its own session once.",
  );
  // Only one idle thread keeps its process, so the first thread can stop when the second goes idle.
  // Its next turn then resumes its session one more time.
  assert.deepEqual(
    resumed.slice(2).map((request) => request.sessionId),
    resumed.length > 2 ? [opened[0]?.sessionId] : [],
    "Only the released first thread resumes again.",
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
  const stdoutFirst = join(root, "agy-stdout-first", "bin", "antigravity");
  await installFakeAgent(stdoutFirst, "antigravity-mcp-load-failure", {
    FAKE_LOG: join(root, "stdout-first.jsonl"),
    FAKE_STDOUT_FIRST: "1",
  });
  const late = requireProviderDriver("antigravity").createClient(
    { executable: stdoutFirst, version: "1.5.4", source: "managed" },
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

  // 5. The CLI's own files name `docs` (user file) and `notes` (workspace file).
  await mkdir(join(root, "gemini", "config"), { recursive: true });
  await writeFile(join(root, "gemini", "config", "mcp_config.json"), JSON.stringify({ mcpServers: { docs: {} } }));
  const ownWorkspace = join(root, "own-workspace");
  await mkdir(join(ownWorkspace, ".agents"), { recursive: true });
  await writeFile(join(ownWorkspace, ".agents", "mcp_config.json"), JSON.stringify({ mcpServers: { notes: {} } }));
  const ownLog = join(root, "own.jsonl");
  const ownExecutable = join(root, "agy-own", "bin", "antigravity");
  await installFakeAgent(ownExecutable, "antigravity-mcp-load-failure", { FAKE_LOG: ownLog, FAKE_RELEASE: release });
  const own = requireProviderDriver("antigravity").createClient(
    { executable: ownExecutable, version: "1.5.4", source: "managed" },
    20_000,
    {
      apiKey: () => null,
      customProviders: () => [],
      mcpServers: () => [
        httpServer("docs", "docs", "https://docs.example/mcp"),
        httpServer("notes", "notes", "https://notes.example/mcp"),
        httpServer("wiki", "wiki", "https://wiki.example/mcp"),
      ],
    },
  );
  clients.push(own);
  own.start();
  const ownThread = await startThread(own, { cwd: ownWorkspace });
  const ownTurn = await runTurn(own, ownThread, { text: "Reply with OK only.", timeoutMs: 30_000 });
  report.turns.ownNames = ownTurn;
  assert.equal(ownTurn.reply, "OK", "The turn answers.");
  const ownNames = (await readJsonl<LogEntry>(ownLog)).find((request) => request.names?.includes("wiki"))?.names;
  report.ownNames = ownNames;
  for (const name of ["openbot_docs", "openbot_notes", "wiki"]) {
    assert.ok(ownNames?.includes(name), `The session gets ${name}.`);
  }
  assert.ok(!ownNames?.includes("docs") && !ownNames?.includes("notes"), "No server has a name from the CLI's files.");
  // 6. The CLI refuses the tool schema of a server that started (#7228).
  const refusedLog = join(root, "refused.jsonl");
  const refusedExecutable = join(root, "agy-refused", "bin", "antigravity");
  await installFakeAgent(refusedExecutable, "antigravity-refused-tool", { FAKE_LOG: refusedLog });
  const refusedDrops: McpServerDrop[] = [];
  const refusedClient = requireProviderDriver("antigravity").createClient(
    { executable: refusedExecutable, version: "1.5.6", source: "managed" },
    20_000,
    {
      apiKey: () => null,
      customProviders: () => [],
      mcpServers: () => [
        httpServer("resend", "resend", "https://resend.example/mcp"),
        httpServer("wiki", "wiki", "https://wiki.example/mcp"),
      ],
      reportMcpDrops: (_provider, dropped) => refusedDrops.push(...dropped),
    },
  );
  clients.push(refusedClient);
  refusedClient.start();
  const refusedWorkspace = join(root, "refused-workspace");
  await mkdir(refusedWorkspace, { recursive: true });
  const refusedThread = await startThread(refusedClient, { cwd: refusedWorkspace });
  const refusedTurn = await runTurn(refusedClient, refusedThread, { text: "Reply with OK only.", timeoutMs: 30_000 });
  report.turns.refusedTool = refusedTurn;
  report.refusedDrops = refusedDrops;
  assert.equal(refusedTurn.error, null, "The turn with a refused tool schema has no error.");
  assert.equal(refusedTurn.reply, "OK", "The turn answers without the server.");
  assert.deepEqual(
    refusedDrops.map((drop) => drop.name),
    ["resend"],
    "The server of the refused tool is reported as left out.",
  );
  assert.match(refusedDrops[0]?.detail ?? "", /get-contact/u, "The report names the tool.");
  const refused = await readJsonl<RefusedEntry>(refusedLog);
  report.refused = refused;
  const refusedPrompts = refused.filter((entry) => entry.method === "session/prompt");
  assert.deepEqual(
    refusedPrompts.map((entry) => entry.refused),
    ["mcp_resend_get-contact", null],
    "The prompt runs once more, and then without the refused tool.",
  );
  assert.notEqual(refusedPrompts[0]?.pid, refusedPrompts[1]?.pid, "The prompt runs again on a new process.");
  const refusedResume = refused.find((entry) => entry.method === "session/resume");
  assert.equal(refusedResume?.pid, refusedPrompts[1]?.pid, "The new process resumes the session.");
  assert.ok(!refusedResume?.names?.includes("resend"), "The resumed session does not get the server.");
  assert.ok(refusedResume?.names?.includes("wiki"), "The resumed session keeps the other servers.");

  // 7. A refused tool of the user's own server `wiki_extra` does not leave out OpenBot's `wiki`.
  await mkdir(join(refusedWorkspace, ".agents"), { recursive: true });
  await writeFile(
    join(refusedWorkspace, ".agents", "mcp_config.json"),
    JSON.stringify({ mcpServers: { wiki_extra: {} } }),
  );
  const ownRefused = await runTurn(refusedClient, refusedThread, {
    text: "REFUSE_TOOL=mcp_wiki_extra_search",
    timeoutMs: 30_000,
  });
  report.turns.ownRefusedTool = ownRefused;
  assert.equal(ownRefused.status, "failed", "The turn fails.");
  assert.equal(refusedDrops.length, 1, "No server of OpenBot is left out.");
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
