import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { kiroContextWindow } from "../src/backend/acp-flavor";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { ProcessConfinement } from "../src/backend/process-confinement";
import {
  decodeAccountReadResult,
  decodeModelListResponse,
  getRecord,
  getString,
  isRecord,
} from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/kiro-live-e2e");
const MODEL = "claude-haiku-5.5";
const EFFORT = "low";
const NUMBERS = "Reply with the numbers 1 to 40, one per line, and nothing else. Do not use any tools.";
const ASK_WHOAMI =
  "Call the whoami tool of the openbot MCP server once, then answer with exactly the text that it returned.";

interface Wire {
  at: number;
  direction?: "to-agent" | "from-agent";
  event?: string;
  argv?: string[];
  method?: string;
  id?: string | number;
  response?: boolean;
  failed?: boolean;
  sessionId?: string;
  configId?: string;
  value?: string;
  update?: string;
  kind?: string;
  usagePercentage?: number;
  promptTurnSummaries?: unknown;
  models?: Record<string, string>;
}

interface Span {
  sessionId: string;
  startedAt: number;
  endedAt: number;
}

interface Report {
  passed: boolean;
  version: string;
  model: string;
  argv?: string[];
  signedOut?: { account: unknown };
  settingsFile?: { existed: boolean; changed: boolean };
  confined?: {
    status: string | null;
    error: string | null;
    started: boolean;
    contextUpdates: number;
  };
  emptyHome?: {
    unconfinedAccount: unknown;
    unconfinedWroteSettings: boolean;
    confinedAccount: unknown;
    confinedWroteSettings: boolean;
  };
  wirePrompts?: { sent: number; answered: number };
  twoFolders?: { overlapMs: number; endsApartMs: number };
  oneFolder?: { overlapMs: number; endsApartMs: number };
  modelSet?: { setConfigOption: string[]; setModelCalls: number; effortSet: string[] };
  context?: { updates: number; window: number | null; lastTokens: number | null; wirePercentages: number[] };
  mcpInOneFolder?: { threads: string[]; callers: string[]; replies: string[] };
  credits?: string[];
  failure?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-kiro-live-e2e-"));
const report: Report = { passed: false, version: "", model: MODEL };
const clients: AgentClient[] = [];

async function newFolder(name: string): Promise<string> {
  const folder = join(root, name);
  await mkdir(folder);
  await writeFile(join(folder, "README.md"), "Scratch folder of a test.\n");
  return folder;
}

const overlapMs = (first: Span, second: Span) =>
  Math.min(first.endedAt, second.endedAt) - Math.max(first.startedAt, second.startedAt);

const endsApartMs = (first: Span, second: Span) => Math.abs(first.endedAt - second.endedAt);

async function fileDigest(path: string): Promise<string | null> {
  const content = await readFile(path).catch(() => null);
  return content ? createHash("sha256").update(content).digest("hex") : null;
}

try {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const driver = requireProviderDriver("kiro");
  const realCli = await runCauseEffect(driver.resolveCli());
  report.version = realCli.version;

  const settingsFile = join(homedir(), ".kiro", "settings", "cli.json");
  const settingsBefore = await fileDigest(settingsFile);

  const proxied = async (name: string) => {
    const trace = join(root, `trace-${name}.jsonl`);
    const executable = join(root, "bin", name);
    await installFakeAgent(executable, "kiro-trace-proxy", { REAL_KIRO_CLI: realCli.executable, TRACE_LOG: trace });
    return { cli: { ...realCli, executable }, trace, wire: () => readJsonl<Wire>(trace) };
  };

  const signedOutAccount = async (home: string, confinement?: ProcessConfinement) => {
    const signedOutClient = driver.createClient(
      realCli,
      30_000,
      { ...NO_PROVIDER_CREDENTIALS, agentEnvironment: () => ({ HOME: home }) },
      confinement,
    );
    clients.push(signedOutClient);
    signedOutClient.start();
    const read = await runCauseEffect(signedOutClient.request("account/read", {}, decodeAccountReadResult));
    await runCauseEffect(signedOutClient.stop());
    return read.account;
  };
  const emptyHome = join(root, "empty-home");
  const confinedEmptyHome = join(root, "confined-empty-home");
  await mkdir(emptyHome);
  await mkdir(confinedEmptyHome);
  const emptyHomeWorkspace = await newFolder("empty-home-workspace");
  const unconfinedAccount = await signedOutAccount(emptyHome);
  const confinedAccount = await signedOutAccount(confinedEmptyHome, { writableRoots: [emptyHomeWorkspace] });
  const settingsIn = (home: string) => existsSync(join(home, ".kiro", "settings", "cli.json"));
  report.signedOut = { account: unconfinedAccount };
  report.emptyHome = {
    unconfinedAccount,
    unconfinedWroteSettings: settingsIn(emptyHome),
    confinedAccount,
    confinedWroteSettings: settingsIn(confinedEmptyHome),
  };
  assert.equal(unconfinedAccount, null, "A Kiro CLI with no sign-in reports an account.");
  assert.equal(confinedAccount, null, "A confined Kiro CLI with no sign-in reports an account or fails.");

  const confinedFolder = await newFolder("confined");
  const confinement: ProcessConfinement = { writableRoots: [confinedFolder] };
  const confinedProxy = await proxied("kiro-confined");
  const confinedClient = driver.createClient(confinedProxy.cli, 60_000, NO_PROVIDER_CREDENTIALS, confinement);
  clients.push(confinedClient);
  confinedClient.start();
  let confinedTurn: Awaited<ReturnType<typeof runTurn>> = { reply: "", error: "The turn did not run.", status: null };
  try {
    const confinedModels = (
      await runCauseEffect(confinedClient.request("model/list", {}, decodeModelListResponse))
    ).data.flatMap((model) => model.model ?? []);
    assert.ok(confinedModels.includes(MODEL), `A confined Kiro CLI does not list ${MODEL}.`);
    const confinedThread = await startThread(confinedClient, { cwd: confinedFolder, model: MODEL });
    confinedTurn = await runTurn(confinedClient, confinedThread, {
      model: MODEL,
      effort: EFFORT,
      text: NUMBERS,
      timeoutMs: 120_000,
    });
  } finally {
    await stopClients([confinedClient]);
    const confinedWire = await confinedProxy.wire();
    report.confined = {
      status: confinedTurn.status,
      error: confinedTurn.error,
      started: confinedWire.some((entry) => entry.event === "start"),
      contextUpdates: confinedWire.filter((entry) => entry.kind === "context_usage").length,
    };
  }
  assert.equal(report.confined.error, null, "A turn of a confined Kiro CLI fails.");
  assert.equal(report.confined.status, "completed", "A turn of a confined Kiro CLI does not complete.");

  const proxy = await proxied("kiro-open");
  const client = driver.createClient(proxy.cli, 60_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.on("request", (request) => {
    if (request.method === "item/tool/call") return;
    const callsWhoami = /whoami/iu.test(JSON.stringify(request.params ?? {}));
    if (request.method.endsWith("/requestApproval"))
      client.respond(request.id, { decision: callsWhoami ? "accept" : "decline" });
    else client.respondError(request.id, { code: -32601, message: `The test does not answer ${request.method}.` });
  });
  const fills: { tokens: number; window: number }[] = [];
  client.on("notification", (notification) => {
    if (notification.method !== "thread/tokenUsage/updated" || !isRecord(notification.params)) return;
    const usage = getRecord(notification.params, "tokenUsage");
    const window = usage?.modelContextWindow;
    const tokens = getRecord(usage, "last")?.totalTokens;
    if (typeof window === "number" && typeof tokens === "number") fills.push({ tokens, window });
  });
  client.start();

  const listed = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));
  assert.ok(
    listed.data.some((candidate) => candidate.model === MODEL),
    `Kiro does not list ${MODEL}: sign in with \`kiro-cli login\` first.`,
  );

  const [folderA, folderB, shared] = await Promise.all([newFolder("a"), newFolder("b"), newFolder("shared")]);

  const [first, second] = await Promise.all([
    startThread(client, { cwd: folderA, model: MODEL }),
    startThread(client, { cwd: folderB, model: MODEL }),
  ]);
  const timed = async (thread: string) => {
    const startedAt = Date.now();
    const turn = await runTurn(client, thread, { model: MODEL, effort: EFFORT, text: NUMBERS, timeoutMs: 120_000 });
    return { turn, span: { sessionId: thread, startedAt, endedAt: Date.now() } };
  };
  const twoFolders = await Promise.all([first, second].map(timed));
  for (const { turn } of twoFolders) {
    assert.equal(turn.error, null, "A turn in two folders fails.");
    assert.equal(turn.status, "completed", "A turn in two folders does not complete.");
  }
  const [spanA, spanB] = twoFolders.map(({ span }) => span);
  assert.ok(spanA && spanB, "The turns of two folders have no span.");
  report.twoFolders = { overlapMs: overlapMs(spanA, spanB), endsApartMs: endsApartMs(spanA, spanB) };
  assert.ok(report.twoFolders.overlapMs > 1_000, "The turns of two folders do not overlap.");

  const [third, fourth] = await Promise.all([
    startThread(client, { cwd: shared, model: MODEL }),
    startThread(client, { cwd: shared, model: MODEL }),
  ]);
  const oneFolder = await Promise.all([third, fourth].map(timed));
  for (const { turn } of oneFolder) {
    assert.equal(turn.error, null, "A turn in one folder fails.");
    assert.equal(turn.status, "completed", "A turn in one folder does not complete.");
  }
  const [spanC, spanD] = oneFolder.map(({ span }) => span);
  assert.ok(spanC && spanD, "The turns of one folder have no span.");
  report.oneFolder = { overlapMs: overlapMs(spanC, spanD), endsApartMs: endsApartMs(spanC, spanD) };
  assert.ok(report.oneFolder.overlapMs > 1_000, "The turns of one folder do not overlap.");

  const wire = await proxy.wire();
  report.argv = wire.find((entry) => entry.event === "start")?.argv;
  const sentPrompts = wire.filter((entry) => entry.direction === "to-agent" && entry.method === "session/prompt");
  report.wirePrompts = {
    sent: sentPrompts.length,
    answered: sentPrompts.filter((request) =>
      wire.some((entry) => entry.direction === "from-agent" && entry.response === true && entry.id === request.id),
    ).length,
  };
  assert.deepEqual(report.argv, ["acp", "--agent-engine=v3"], "Kiro CLI did not start with the V3 engine.");
  const setConfig = wire.filter(
    (entry) => entry.direction === "to-agent" && entry.method === "session/set_config_option",
  );
  report.modelSet = {
    setConfigOption: [
      ...new Set(setConfig.filter((entry) => entry.configId === "model").map((entry) => String(entry.value))),
    ],
    setModelCalls: wire.filter((entry) => entry.method === "session/set_model").length,
    effortSet: [
      ...new Set(setConfig.filter((entry) => entry.configId === "effortLevel").map((entry) => String(entry.value))),
    ],
  };
  assert.ok(report.modelSet.setConfigOption.includes(MODEL), "The model is not set with session/set_config_option.");
  assert.equal(report.modelSet.setModelCalls, 0, "The client called session/set_model, which V3 does not have.");
  assert.ok(report.modelSet.effortSet.includes(EFFORT), "The effort is not set with session/set_config_option.");

  const wirePercentages = wire.flatMap((entry) =>
    entry.kind === "context_usage" && typeof entry.usagePercentage === "number" ? [entry.usagePercentage] : [],
  );
  const description = wire.find((entry) => entry.models?.[MODEL])?.models?.[MODEL] ?? "";
  const expectedWindow = kiroContextWindow(description);
  report.context = {
    updates: fills.length,
    window: fills.at(-1)?.window ?? null,
    lastTokens: fills.at(-1)?.tokens ?? null,
    wirePercentages,
  };
  assert.ok(wirePercentages.length > 0, "Kiro CLI sent no context_usage update.");
  assert.ok(fills.length > 0, "A turn shows no context fill.");
  assert.equal(report.context.window, expectedWindow, "The context size is not the one of the model description.");
  assert.ok((report.context.lastTokens ?? 0) > 0, "The context fill has no tokens.");

  const whoami = {
    type: "namespace",
    name: "openbot",
    tools: [
      {
        type: "function",
        name: "whoami",
        description: "Returns the id of the chat that calls it. Call it once, with no arguments.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  };
  const callers: string[] = [];
  client.on("request", (request) => {
    if (request.method !== "item/tool/call" || !isRecord(request.params)) return;
    const caller = getString(request.params, "threadId") ?? "";
    callers.push(caller);
    client.respond(request.id, { success: true, contentItems: [{ type: "inputText", text: `thread-id:${caller}` }] });
  });
  const open = async () => {
    const response = await runCauseEffect(
      client.request("thread/start", { cwd: shared, model: MODEL, dynamicTools: [whoami] }, (value) => value),
    );
    const id = getString(getRecord(response, "thread"), "id");
    assert.ok(id, "thread/start answers no thread id.");
    return id;
  };
  const [bridgeA, bridgeB] = [await open(), await open()];
  const [answerA, answerB] = await Promise.all([
    runTurn(client, bridgeA, { model: MODEL, effort: EFFORT, text: ASK_WHOAMI, timeoutMs: 120_000 }),
    runTurn(client, bridgeB, { model: MODEL, effort: EFFORT, text: ASK_WHOAMI, timeoutMs: 120_000 }),
  ]);
  report.mcpInOneFolder = {
    threads: [bridgeA, bridgeB],
    callers,
    replies: [answerA.reply.trim().slice(-100), answerB.reply.trim().slice(-100)],
  };
  assert.equal(answerA.error, null, "The turn with the MCP tool of the first session fails.");
  assert.equal(answerB.error, null, "The turn with the MCP tool of the second session fails.");
  assert.deepEqual([...callers].sort(), [bridgeA, bridgeB].sort(), "A call of the tool reached the wrong chat.");
  assert.ok(answerA.reply.includes(`thread-id:${bridgeA}`), "The first session did not get its own id.");
  assert.ok(answerB.reply.includes(`thread-id:${bridgeB}`), "The second session did not get its own id.");

  report.credits = [...(await confinedProxy.wire()), ...(await proxy.wire())]
    .filter((entry) => entry.kind === "turn_completion")
    .map((entry) => JSON.stringify(entry.promptTurnSummaries).slice(0, 300));

  const settingsAfter = await fileDigest(settingsFile);
  report.settingsFile = { existed: settingsBefore !== null, changed: settingsBefore !== settingsAfter };
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  for (const name of ["kiro-confined", "kiro-open"])
    await copyFile(join(root, `trace-${name}.jsonl`), join(OUT, `trace-${name}.jsonl`)).catch(() => undefined);
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
