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
// From #9568: the CLI 1.5.9 names the refused tool in its answer, and no longer answers with the
// short text after which OpenBot reads the log. The server is left out the same way.
// From #11063: the CLI refuses the tool again from the second prompt after the resume. Each later
// turn leaves the server out again, and answers.
// From #7482: Google refuses a tool schema (an array with no `items`, an empty `enum` value) and names the
// tool only by its place in the request. OpenBot finds the tool in the schemas that the CLI saved, leaves
// out its server, and the turn answers.
// From #11746: Google refuses `items` on a field that is not an array. Its server is left out the same way.
// From #12358: the CLI sends a number `enum`, such as Aave's `limit: [10, 50]`, as empty values. Its
// server is left out the same way.
// From #12298: the CLI 1.5.11 runs a prompt without a server that did not list its tools within 5 s,
// with no error. A turn without OpenBot's own tools fails with a plain message and keeps its answer; a
// prompt that lists them in time completes, and an older CLI is not judged.
// `bun run test:antigravity-mcp-load-failure`. Writes
// .openbot-build/antigravity-mcp-load-failure-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { isCauseCode } from "@openbot/telemetry";
import { visibleDynamicTools } from "../src/backend/agent/tool-catalog";
import { FAILOVER_CAUSES } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { McpServerDrop } from "../src/backend/mcp-provider-shapes";
import { getRecord, getString } from "../src/backend/protocol";
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
  googleDrops?: McpServerDrop[];
  blingDrops?: McpServerDrop[];
  aaveDrops?: McpServerDrop[];
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

  // 8. The CLI 1.5.9 names the refused tool in its answer (#9568). The fake writes no log line for
  // it, so only the answer can name the tool.
  const dropsBefore = refusedDrops.length;
  const answerThread = await startThread(refusedClient, { cwd: refusedWorkspace });
  const answerTurn = await runTurn(refusedClient, answerThread, {
    text: "CLI_1_5_9 Reply with OK only.",
    timeoutMs: 30_000,
  });
  report.turns.refusedToolAnswer = answerTurn;
  assert.equal(answerTurn.error, null, "The turn with a refused tool in the answer has no error.");
  assert.equal(answerTurn.reply, "OK", "The turn answers without the server.");
  assert.deepEqual(
    refusedDrops.slice(dropsBefore).map((drop) => drop.name),
    ["resend"],
    "The server of the tool in the answer is reported as left out.",
  );
  const answerPrompts = (await readJsonl<RefusedEntry>(refusedLog)).filter(
    (entry) => entry.method === "session/prompt" && entry.sessionId === answerThread,
  );
  assert.deepEqual(
    answerPrompts.map((entry) => entry.refused),
    ["mcp_resend_get-contact", null],
    "The prompt runs once more, and then without the refused tool.",
  );

  // 8b. The CLI refuses the tool again from the second prompt after the resume (#11063). Each later
  // turn leaves the server out again, and answers.
  for (const name of ["refusedToolAgain", "refusedToolThird"]) {
    const again = await runTurn(refusedClient, answerThread, {
      text: "CLI_1_5_9 SERVERS_RETURN Reply with OK only.",
      timeoutMs: 30_000,
    });
    report.turns[name] = again;
    assert.equal(again.error, null, "A later turn with the refused tool again has no error.");
    assert.equal(again.reply, "OK", "A later turn answers without the server.");
  }
  const againPrompts = (await readJsonl<RefusedEntry>(refusedLog)).filter(
    (entry) => entry.method === "session/prompt" && entry.sessionId === answerThread,
  );
  assert.deepEqual(
    againPrompts.map((entry) => entry.refused),
    ["mcp_resend_get-contact", null, "mcp_resend_get-contact", null, "mcp_resend_get-contact", null],
    "Each turn runs once more, and then without the refused tool.",
  );

  // 9. Google refuses a tool schema and names the tool only by its place in the request (#7482).
  const googleLog = join(root, "google.jsonl");
  const googleExecutable = join(root, "agy-google", "bin", "antigravity");
  await installFakeAgent(googleExecutable, "antigravity-refused-tool", { FAKE_LOG: googleLog });
  const googleDrops: McpServerDrop[] = [];
  const googleClient = requireProviderDriver("antigravity").createClient(
    { executable: googleExecutable, version: "1.5.6", source: "managed" },
    20_000,
    {
      apiKey: () => null,
      customProviders: () => [],
      mcpServers: () => [
        httpServer("atlas", "atlas", "https://atlas.example/mcp"),
        httpServer("ticktick", "ticktick", "https://ticktick.example/mcp"),
      ],
      reportMcpDrops: (_provider, dropped) => googleDrops.push(...dropped),
    },
  );
  clients.push(googleClient);
  googleClient.start();
  const googleWorkspace = join(root, "google-workspace");
  await mkdir(googleWorkspace, { recursive: true });
  const googleThread = await startThread(googleClient, { cwd: googleWorkspace });
  const googleTurn = await runTurn(googleClient, googleThread, { text: "Reply with OK only.", timeoutMs: 30_000 });
  report.turns.googleRefusedTool = googleTurn;
  report.googleDrops = googleDrops;
  assert.equal(googleTurn.error, null, "The turn that Google refused has no error.");
  assert.equal(googleTurn.reply, "OK", "The turn answers without the server.");
  assert.deepEqual(
    googleDrops.map((drop) => drop.name),
    ["ticktick"],
    "Only the server whose tool has the refused fields is left out.",
  );
  assert.match(googleDrops[0]?.detail ?? "", /list_tasks|get_task/u, "The report names the tool.");
  const googlePrompts = (await readJsonl<RefusedEntry>(googleLog)).filter((entry) => entry.method === "session/prompt");
  assert.deepEqual(
    googlePrompts.map((entry) => entry.refused),
    ["ticktick", null],
    "The prompt runs once more, and then without the refused server.",
  );
  // The same refusal in the answer of the CLI 1.5.9, on a new session that gets the server again.
  const googleAnswerThread = await startThread(googleClient, { cwd: googleWorkspace });
  const googleAnswer = await runTurn(googleClient, googleAnswerThread, {
    text: "CLI_1_5_9 Reply with OK only.",
    timeoutMs: 30_000,
  });
  report.turns.googleRefusedToolAnswer = googleAnswer;
  assert.equal(googleAnswer.error, null, "The turn with Google's refusal in the answer has no error.");
  assert.equal(googleAnswer.reply, "OK", "The turn answers without the server.");
  assert.deepEqual(
    googleDrops.map((drop) => drop.name),
    ["ticktick", "ticktick"],
    "The server is left out of the new session too.",
  );

  // 10. Google refuses `items` on a field that is not an array (#11746). `atlas` has a field with the same
  // name that is an array, which Google accepts.
  const blingDrops: McpServerDrop[] = [];
  const blingClient = requireProviderDriver("antigravity").createClient(
    { executable: googleExecutable, version: "1.5.6", source: "managed" },
    20_000,
    {
      apiKey: () => null,
      customProviders: () => [],
      mcpServers: () => [
        httpServer("atlas", "atlas", "https://atlas.example/mcp"),
        httpServer("bling", "bling", "https://bling.example/mcp"),
      ],
      reportMcpDrops: (_provider, dropped) => blingDrops.push(...dropped),
    },
  );
  clients.push(blingClient);
  blingClient.start();
  const blingWorkspace = join(root, "bling-workspace");
  await mkdir(blingWorkspace, { recursive: true });
  const blingThread = await startThread(blingClient, { cwd: blingWorkspace });
  const blingTurn = await runTurn(blingClient, blingThread, { text: "Reply with OK only.", timeoutMs: 30_000 });
  report.turns.googleRefusedFieldType = blingTurn;
  report.blingDrops = blingDrops;
  assert.equal(blingTurn.error, null, "The turn that Google refused for a field type has no error.");
  assert.equal(blingTurn.reply, "OK", "The turn answers without the server.");
  assert.deepEqual(
    blingDrops.map((drop) => drop.name),
    ["bling"],
    "Only the server whose field is not an array is left out.",
  );
  assert.match(blingDrops[0]?.detail ?? "", /listAccountReceivables/u, "The report names the tool.");
  const blingPrompts = (await readJsonl<RefusedEntry>(googleLog)).filter(
    (entry) => entry.method === "session/prompt" && entry.sessionId === blingThread,
  );
  assert.deepEqual(
    blingPrompts.map((entry) => entry.refused),
    ["bling", null],
    "The prompt runs once more, and then without the refused server.",
  );

  // 11. The CLI sends a number `enum` as empty values, and Google refuses them (#12358). `atlas` has a
  // field with the same name and a text `enum`, which Google accepts.
  const aaveDrops: McpServerDrop[] = [];
  const aaveClient = requireProviderDriver("antigravity").createClient(
    { executable: googleExecutable, version: "1.5.6", source: "managed" },
    20_000,
    {
      apiKey: () => null,
      customProviders: () => [],
      mcpServers: () => [
        httpServer("atlas", "atlas", "https://atlas.example/mcp"),
        httpServer("aave", "aave", "https://aave.example/mcp"),
      ],
      reportMcpDrops: (_provider, dropped) => aaveDrops.push(...dropped),
    },
  );
  clients.push(aaveClient);
  aaveClient.start();
  const aaveWorkspace = join(root, "aave-workspace");
  await mkdir(aaveWorkspace, { recursive: true });
  const aaveThread = await startThread(aaveClient, { cwd: aaveWorkspace });
  const aaveTurn = await runTurn(aaveClient, aaveThread, { text: "Reply with OK only.", timeoutMs: 30_000 });
  report.turns.googleRefusedNumberEnum = aaveTurn;
  report.aaveDrops = aaveDrops;
  assert.equal(aaveTurn.error, null, "The turn that Google refused for a number enum has no error.");
  assert.equal(aaveTurn.reply, "OK", "The turn answers without the server.");
  assert.deepEqual(
    aaveDrops.map((drop) => drop.name),
    ["aave"],
    "Only the server whose enum holds numbers is left out.",
  );
  assert.match(aaveDrops[0]?.detail ?? "", /get_reserve_holders/u, "The report names the tool.");

  // 12. From #12298: the CLI 1.5.11 runs a prompt without a server that did not list its tools within
  // 5 s, with no error. The fake lists the tools of OpenBot's own servers over the real bridge.
  const listCauses = new Map<string, string | null>();
  const listAgent = async (name: string, env: Record<string, string>) => {
    const executable = join(root, `agy-list-${name}`, "bin", "antigravity");
    const workspace = join(root, `list-${name}`);
    await mkdir(workspace, { recursive: true });
    await installFakeAgent(executable, "antigravity-mcp-list", { FAKE_LOG: join(root, `list-${name}.jsonl`), ...env });
    const listClient = requireProviderDriver("antigravity").createClient(
      { executable, version: env.FAKE_VERSION ?? "1.5.12", source: "managed" },
      20_000,
      { apiKey: () => null, customProviders: () => [], mcpServers: () => [] },
    );
    clients.push(listClient);
    listClient.on("notification", (notification: { method: string; params?: unknown }) => {
      if (notification.method !== "error") return;
      const threadId = getString(notification.params, "threadId");
      if (threadId) listCauses.set(threadId, getString(notification.params, "causeCode") ?? null);
    });
    listClient.start();
    // As the agent service starts a thread: with OpenBot's own tools, which the bridge serves.
    const response = await runCauseEffect(
      listClient.request(
        "thread/start",
        { cwd: workspace, dynamicTools: visibleDynamicTools("antigravity") },
        (value) => value,
      ),
    );
    const threadId = getString(getRecord(response, "thread"), "id");
    assert.ok(threadId, "The thread opens.");
    return { listClient, threadId, log: join(root, `list-${name}.jsonl`) };
  };
  const plain = { text: "Reply with OK only.", timeoutMs: 30_000 };

  // 12a. The session lists the tools at once: each turn completes.
  const onTime = await listAgent("now", { FAKE_OPEN_LIST: "now" });
  const onTimeTurn = await runTurn(onTime.listClient, onTime.threadId, plain);
  report.turns.toolsListedOnTime = onTimeTurn;
  assert.equal(onTimeTurn.status, "completed", "A turn with OpenBot's tools completes.");
  assert.equal(onTimeTurn.error, null, "A turn with OpenBot's tools has no error.");
  // The model list opens a session of its own, with no OpenBot server.
  const onTimeLog = await readJsonl<{ method: string; listed: number | null }>(onTime.log);
  assert.ok(
    onTimeLog.some((entry) => entry.method === "session/new" && (entry.listed ?? 0) > 0),
    "The fake listed OpenBot's tools over the bridge.",
  );

  // 12b. The session never lists them: the turn fails with a plain message, and its answer stays. A
  // prompt that lists them in time completes, and the session keeps them for the next prompt.
  const never = await listAgent("never", { FAKE_OPEN_LIST: "never" });
  const missed = await runTurn(never.listClient, never.threadId, plain);
  report.turns.toolsNotListed = missed;
  assert.equal(missed.status, "failed", "A turn without OpenBot's tools fails.");
  assert.match(missed.error ?? "", /without OpenBot's tools/u, "The error says that the tools were missing.");
  assert.doesNotMatch(missed.error ?? "", /MCP|policy|admin/u, "The error has no protocol words.");
  assert.equal(missed.reply, "OK", "The answer of the turn stays.");
  const missedCause = listCauses.get(never.threadId) ?? null;
  assert.equal(missedCause, "unknown", "The cause is one that does not start a backup model.");
  assert.ok(
    missedCause !== null && isCauseCode(missedCause) && !FAILOVER_CAUSES.has(missedCause),
    "No backup model runs the prompt again.",
  );
  const listedTurn = await runTurn(never.listClient, never.threadId, { ...plain, text: "list the tools" });
  report.turns.toolsListedAtPrompt = listedTurn;
  assert.equal(listedTurn.status, "completed", "A prompt that lists the tools in time completes.");
  const keptTurn = await runTurn(never.listClient, never.threadId, plain);
  report.turns.toolsKept = keptTurn;
  assert.equal(keptTurn.status, "completed", "The session keeps the tools for the next prompt.");

  // 12c. The session lists them after the limit: the turn fails as in 12b.
  const lateList = await listAgent("late", { FAKE_OPEN_LIST: "late", FAKE_LATE_MS: "6500" });
  const lateListTurn = await runTurn(lateList.listClient, lateList.threadId, plain);
  report.turns.toolsListedLate = lateListTurn;
  assert.equal(lateListTurn.status, "failed", "A turn whose tools came after the limit fails.");

  // 12d. A CLI before 1.5.11 is not judged: its limit is not known.
  const older = await listAgent("older", { FAKE_OPEN_LIST: "never", FAKE_VERSION: "1.5.10" });
  const olderTurn = await runTurn(older.listClient, older.threadId, plain);
  report.turns.toolsOlderCli = olderTurn;
  assert.equal(olderTurn.status, "completed", "An older CLI's turn completes as before.");
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
