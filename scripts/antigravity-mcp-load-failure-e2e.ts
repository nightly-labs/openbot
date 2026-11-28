import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { isCauseCode } from "@openbot/telemetry";
import { visibleDynamicTools } from "../src/backend/agent/tool-catalog";
import { FAILOVER_CAUSES } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { McpServerDrop } from "../src/backend/mcp-provider-shapes";
import { type AppServerRequest, getRecord, getString } from "../src/backend/protocol";
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
  openmotionDrops?: McpServerDrop[];
  error?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-mcp-load-failure-e2e-"));
const report: Report = { passed: false, turns: {} };
const clients: AgentClient[] = [];
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
  client.on("diagnostic", (message: string) => {
    const session = /error processing prompt for session (\S+)/u.exec(message)?.[1];
    if (session) void writeFile(join(release, session), "");
  });
  client.start();

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

  const foreign = await runTurn(client, thread, { text: "fail cloudflare", timeoutMs: 30_000 });
  report.turns.foreign = foreign;
  assert.equal(foreign.status, "failed", "The turn fails.");
  assert.match(foreign.error ?? "", /cloudflare/u, "The error names the server.");
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
  const stopped = sourceText("error.provider.antigravityTurnStopped");
  assert.equal(ownRefused.error, stopped, "The turn shows the plain message, not the CLI's text.");

  const failures: Record<string, TurnResult> = {};
  for (const word of ["FAIL_KEY", "FAIL_OTHER", "FAIL_QUIET"]) {
    const turn = await runTurn(refusedClient, refusedThread, { text: word, timeoutMs: 30_000 });
    failures[word] = turn;
    report.turns[word] = turn;
    assert.equal(turn.status, "failed", `The ${word} turn fails.`);
  }
  assert.equal(failures.FAIL_KEY?.error, sourceText("error.provider.geminiKeyRefused"), "A refused key is named.");
  assert.equal(failures.FAIL_OTHER?.error, stopped, "An unknown cause gives the plain message.");
  assert.equal(failures.FAIL_QUIET?.error, stopped, "A log with no cause gives the plain message.");
  assert.equal(refusedDrops.length, 1, "No server is left out for these failures.");

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

  const openmotionDrops: McpServerDrop[] = [];
  const openmotionClient = requireProviderDriver("antigravity").createClient(
    { executable: googleExecutable, version: "1.5.6", source: "managed" },
    20_000,
    {
      apiKey: () => null,
      customProviders: () => [],
      mcpServers: () => [
        httpServer("atlas", "atlas", "https://atlas.example/mcp"),
        httpServer("openmotion", "openmotion", "https://openmotion.example/mcp"),
      ],
      reportMcpDrops: (_provider, dropped) => openmotionDrops.push(...dropped),
    },
  );
  clients.push(openmotionClient);
  openmotionClient.start();
  const openmotionWorkspace = join(root, "openmotion-workspace");
  await mkdir(openmotionWorkspace, { recursive: true });
  report.openmotionDrops = openmotionDrops;
  for (const [name, text] of [
    ["googleRefusedTypelessEnum", "Reply with OK only."],
    ["googleRefusedTypelessEnumAnswer", "CLI_1_5_9 Reply with OK only."],
  ] as const) {
    const dropsBefore = openmotionDrops.length;
    const openmotionThread = await startThread(openmotionClient, { cwd: openmotionWorkspace });
    const openmotionTurn = await runTurn(openmotionClient, openmotionThread, { text, timeoutMs: 30_000 });
    report.turns[name] = openmotionTurn;
    assert.equal(openmotionTurn.error, null, "The turn that Google refused for an enum with no type has no error.");
    assert.equal(openmotionTurn.reply, "OK", "The turn answers without the server.");
    assert.deepEqual(
      openmotionDrops.slice(dropsBefore).map((drop) => drop.name),
      ["openmotion"],
      "Only the server of the tool that Google names is left out.",
    );
    assert.match(openmotionDrops.at(-1)?.detail ?? "", /openmotion_restore_version/u, "The report names the tool.");
    const openmotionPrompts = (await readJsonl<RefusedEntry>(googleLog)).filter(
      (entry) => entry.method === "session/prompt" && entry.sessionId === openmotionThread,
    );
    assert.deepEqual(
      openmotionPrompts.map((entry) => entry.refused),
      ["openmotion", null],
      "The prompt runs once more, and then without the refused server.",
    );
  }

  const coordinateClient = (server: string, drops: McpServerDrop[]) => {
    const client = requireProviderDriver("antigravity").createClient(
      { executable: googleExecutable, version: "1.5.6", source: "managed" },
      20_000,
      {
        apiKey: () => null,
        customProviders: () => [],
        mcpServers: () => [
          httpServer("atlas", "atlas", "https://atlas.example/mcp"),
          httpServer(server, server, `https://${server}.example/mcp`),
        ],
        reportMcpDrops: (_provider, dropped) => drops.push(...dropped),
      },
    );
    clients.push(client);
    client.start();
    return client;
  };
  for (const [name, server, text, tool] of [
    ["googleRefusedTupleItems", "desktop", "CODE_400 Reply with OK only.", /computer/u],
    ["googleRefusedUnionItems", "pointer", "Reply with OK only.", /move_pointer/u],
  ] as const) {
    const drops: McpServerDrop[] = [];
    const client = coordinateClient(server, drops);
    const workspace = join(root, `${server}-workspace`);
    await mkdir(workspace, { recursive: true });
    const thread = await startThread(client, { cwd: workspace });
    const turn = await runTurn(client, thread, { text, timeoutMs: 30_000 });
    report.turns[name] = turn;
    assert.equal(turn.error, null, "The turn that Google refused for a list field with no item type has no error.");
    assert.equal(turn.reply, "OK", "The turn answers without the server.");
    assert.deepEqual(
      drops.map((drop) => drop.name),
      [server],
      "Only this server is left out, not the server whose list field has a typed item.",
    );
    assert.match(drops[0]?.detail ?? "", tool, "The report names the tool.");
  }
  const blankDrops: McpServerDrop[] = [];
  const blankClient = coordinateClient("blank", blankDrops);
  const blankDiagnostics: string[] = [];
  blankClient.on("diagnostic", (message: string) => blankDiagnostics.push(message));
  const blankWorkspace = join(root, "blank-workspace");
  await mkdir(blankWorkspace, { recursive: true });
  for (const [name, text] of [
    ["googleRefusedUnknownTool", "Reply with OK only."],
    ["googleRefusedUnknownToolAnswer", "CODE_400 Reply with OK only."],
    ["googleRefusedUnknownToolReply", "RPC_400 Reply with OK only."],
  ] as const) {
    blankDiagnostics.length = 0;
    const blankThread = await startThread(blankClient, { cwd: blankWorkspace });
    const blankTurn = await runTurn(blankClient, blankThread, { text, timeoutMs: 30_000 });
    report.turns[name] = blankTurn;
    assert.equal(
      blankTurn.error,
      sourceText("error.provider.antigravityToolFormatRefused"),
      "A refused tool format that OpenBot cannot find gives the plain message, not Google's text.",
    );
    assert.ok(
      blankDiagnostics.some((message) => message.includes("properties[coordinate].items: missing field")),
      "Google's text goes to the log.",
    );
  }
  assert.deepEqual(blankDrops, [], "No server is left out when OpenBot cannot find the refused tool.");

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
    listClient.on("request", (request: AppServerRequest) => {
      if (request.method !== "item/tool/call") return;
      listClient.respond(request.id, { success: true, contentItems: [{ type: "inputText", text: "Research" }] });
    });
    listClient.on("notification", (notification: { method: string; params?: unknown }) => {
      if (notification.method !== "error") return;
      const threadId = getString(notification.params, "threadId");
      if (threadId) listCauses.set(threadId, getString(notification.params, "causeCode") ?? null);
    });
    listClient.start();
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

  const onTime = await listAgent("now", { FAKE_OPEN_LIST: "now" });
  const onTimeTurn = await runTurn(onTime.listClient, onTime.threadId, plain);
  report.turns.toolsListedOnTime = onTimeTurn;
  assert.equal(onTimeTurn.status, "completed", "A turn with OpenBot's tools completes.");
  assert.equal(onTimeTurn.error, null, "A turn with OpenBot's tools has no error.");
  const onTimeLog = await readJsonl<{ method: string; listed: number | null }>(onTime.log);
  assert.ok(
    onTimeLog.some((entry) => entry.method === "session/new" && (entry.listed ?? 0) > 0),
    "The fake listed OpenBot's tools over the bridge.",
  );

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
  const resumes = async () =>
    (await readJsonl<{ method: string }>(never.log)).filter((entry) => entry.method === "session/resume").length;
  const resumesBefore = await resumes();
  const listedTurn = await runTurn(never.listClient, never.threadId, { ...plain, text: "list the tools" });
  report.turns.toolsListedAtPrompt = listedTurn;
  assert.equal(listedTurn.status, "completed", "A prompt that lists the tools in time completes.");
  assert.equal(await resumes(), resumesBefore + 1, "The turn after the failure opens the session again.");
  const keptTurn = await runTurn(never.listClient, never.threadId, plain);
  report.turns.toolsKept = keptTurn;
  assert.equal(keptTurn.status, "completed", "The session keeps the tools for the next prompt.");

  const called = await listAgent("called", { FAKE_OPEN_LIST: "never" });
  const calledTurn = await runTurn(called.listClient, called.threadId, { ...plain, text: "call the tool" });
  report.turns.toolCalledWithoutList = calledTurn;
  assert.equal(calledTurn.status, "completed", "A turn that ran an OpenBot tool completes.");
  assert.equal(calledTurn.error, null, "A turn that ran an OpenBot tool has no error.");
  const calledLog = await readJsonl<{ method: string; listed: number | null; called?: boolean | null }>(called.log);
  assert.ok(
    calledLog.some((entry) => entry.method === "session/prompt" && entry.called === true),
    "The fake ran an OpenBot tool over the bridge with no tool list.",
  );
  assert.ok(
    calledLog.every((entry) => (entry.listed ?? 0) === 0),
    "The fake did not list OpenBot's tools.",
  );
  const afterCallTurn = await runTurn(called.listClient, called.threadId, plain);
  report.turns.toolsKeptAfterCall = afterCallTurn;
  assert.equal(afterCallTurn.status, "completed", "The session keeps the tools after a tool call.");

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
