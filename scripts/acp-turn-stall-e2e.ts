import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { AcpAgentClient } from "../src/backend/acp-client";
import {
  type AcpCustomEndpoint,
  type AcpFlavor,
  customAgentFlavor,
  DEFAULT_ACP_FLAVOR,
} from "../src/backend/acp-flavor";
import { ANTIGRAVITY_ACP_FLAVOR } from "../src/backend/acp-flavor-antigravity";
import { OPENCODE_ACP_FLAVOR } from "../src/backend/acp-flavor-opencode";
import { type AgentClient, ProviderSessionBusyError } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { AppServerNotification } from "../src/backend/protocol";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients, type TurnResult } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/acp-turn-stall-e2e");
const STALL_MS = 1_500;
const TOOL_MS = STALL_MS * 3;
const CHUNK_GAP_MS = 500;
const FIRST_UPDATE_MS = 1_000;
const RETRY_STALL_MS = 4_000;
const RETRY_MS = RETRY_STALL_MS * 1.1;
const RATE_RETRY_MS = RETRY_STALL_MS * 0.75;

interface LogEntry {
  event: string;
  sessionId?: string;
  text?: string;
}

interface Report {
  passed: boolean;
  stall?: { status: string | null; error: string | null; elapsedMs: number; cancelSent: boolean };
  afterStall?: { status: string | null; sessionRestored: boolean };
  answerAfterCancel?: { status: string | null; reply: string; error: string | null };
  confirmedCancel?: { status: string | null; error: string | null; elapsedMs: number };
  toolAfterCancel?: { status: string | null; error: string | null };
  retry?: { status: string | null; reply: string; elapsedMs: number };
  retryForever?: { status: string | null; error: string | null; elapsedMs: number };
  rateLimitRetry?: { status: string | null; reply: string; elapsedMs: number };
  endpointStall?: { status: string | null; error: string | null };
  slowEndpoint?: { status: string | null; reply: string; elapsedMs: number };
  slowFlavor?: { quietStatus: string | null; hangStatus: string | null; hangElapsedMs: number };
  tool?: { status: string | null; elapsedMs: number };
  openTool?: { longToolStatus: string | null; hangStatus: string | null; error: string | null; elapsedMs: number };
  stop?: { status: string | null; elapsedMs: number; next: string | null };
  stream?: { deltaBeforeCompletion: boolean; reply: string };
  antigravity?: { stalled: boolean; stopStatus: string | null };
  antigravitySilent?: { status: string | null; error: string | null; elapsedMs: number };
  antigravityOpenStep?: {
    longStepStatus: string | null;
    hangStatus: string | null;
    error: string | null;
    elapsedMs: number;
  };
  antigravityLogged?: { status: string | null; error: string | null; elapsedMs: number };
  lostPrompt?: { status: string | null; reply: string; prompts: number; cancels: number; resumes: number };
  lostTwice?: { status: string | null; error: string | null; elapsedMs: number; next: string | null };
  quiet?: { status: string | null; reply: string; prompts: number };
  noLoad?: { stopStatus: string | null; next: string | null; sessionsOpened: number; loads: number };
  silentNew?: { error: string; elapsedMs: number };
  heldSession?: ActiveSessionReport;
  reasonHeldSession?: ActiveSessionReport;
  closedHeldSession?: ActiveSessionReport;
  failure?: string;
}

interface ActiveSessionReport {
  stalledStatus: string | null;
  busyWhileOpen?: boolean;
  nextStatus: string | null;
  nextReply: string;
  refusedRestores: number;
  closes: number;
  sameSession: boolean;
}

const root = await mkdtemp(join(tmpdir(), "openbot-acp-turn-stall-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];

async function open(
  provider: "opencode" | "antigravity" | "cline",
  flavor: AcpFlavor,
  log: string,
  env: Readonly<Record<string, string>> = {},
  customEndpoint?: (modelId: string | null) => AcpCustomEndpoint | null,
  firstUpdateMs?: number,
  turnStallMs: number | null = STALL_MS,
  argv: readonly string[] = ["acp"],
): Promise<AgentClient> {
  const executable = join(root, provider, "bin", provider);
  await installFakeAgent(executable, "stall", {
    FAKE_LOG: log,
    FAKE_TOOL_MS: String(TOOL_MS),
    FAKE_CHUNK_GAP_MS: String(CHUNK_GAP_MS),
    ...env,
  });
  const client = new AcpAgentClient({ executable, version: "99.0.0", source: "managed" }, 20_000, {
    provider,
    flavor,
    argv,
    env: {},
    signInMessage: "Sign in to the fake agent.",
    ...(turnStallMs !== null ? { turnStallMs } : {}),
    ...(customEndpoint ? { customEndpoint } : {}),
    ...(firstUpdateMs ? { firstUpdateMs } : {}),
  });
  clients.push(client);
  client.start();
  return client;
}

async function openStrict(name: string, env: Readonly<Record<string, string>>): Promise<AgentClient> {
  const executable = join(root, name, "bin", "strict-agent");
  await installFakeAgent(executable, "strict-session", { FAKE_LOG: join(root, `${name}.jsonl`), ...env });
  const client = new AcpAgentClient({ executable, version: "", source: "system" }, 20_000, {
    provider: "acp",
    flavor: customAgentFlavor("strict-agent"),
    label: "Strict Agent",
    allowNoModels: true,
    argv: [],
    env: {},
    signInMessage: "Sign in to the fake agent.",
    turnStallMs: STALL_MS,
  });
  clients.push(client);
  client.start();
  return client;
}

async function activeSessionReport(
  log: string,
  stalled: TurnResult,
  next: TurnResult,
  busyWhileOpen?: boolean,
): Promise<ActiveSessionReport> {
  const entries = await readJsonl<LogEntry>(log);
  const prompts = entries.filter((entry) => entry.event === "prompt");
  const session = prompts[0]?.sessionId;
  return {
    stalledStatus: stalled.status,
    ...(busyWhileOpen === undefined ? {} : { busyWhileOpen }),
    nextStatus: next.status,
    nextReply: next.reply,
    refusedRestores: entries.filter(
      (entry) => (entry.event === "session/load" || entry.event === "session/resume") && entry.text === "refused",
    ).length,
    closes: entries.filter((entry) => entry.event === "session/close" && entry.sessionId === session).length,
    sameSession: prompts.length >= 2 && prompts.every((entry) => entry.sessionId === session),
  };
}

async function timed<T>(run: () => Promise<T>): Promise<{ value: T; elapsedMs: number }> {
  const started = Date.now();
  const value = await run();
  return { value, elapsedMs: Date.now() - started };
}

async function waitForEntry(log: string, match: (entry: LogEntry) => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await readJsonl<LogEntry>(log)).some(match)) {
    if (Date.now() > deadline) throw new Error("The fake agent did not log the expected request.");
    await new Promise((settle) => setTimeout(settle, 25));
  }
}

try {
  const workspace = join(root, "workspace");
  await mkdir(workspace);

  const log = join(root, "opencode.jsonl");
  const client = await open("opencode", OPENCODE_ACP_FLAVOR, log);
  const thread = await startThread(client, { cwd: workspace });
  const stalled = await timed(() => runTurn(client, thread, { text: "hang", timeoutMs: STALL_MS * 10 }));
  const cancelSent = await waitForEntry(log, (entry) => entry.event === "cancel").then(
    () => true,
    () => false,
  );
  report.stall = {
    status: stalled.value.status,
    error: stalled.value.error,
    elapsedMs: stalled.elapsedMs,
    cancelSent,
  };
  assert.equal(stalled.value.status, "failed", "A silent turn fails.");
  assert.equal(
    stalled.value.error,
    sourceText("error.agent.turnStalled", { provider: "OpenCode" }),
    "A silent turn names the stall.",
  );
  assert.ok(stalled.elapsedMs >= STALL_MS, "The turn is not ended before the stall limit.");
  assert.equal(cancelSent, true, "The agent gets session/cancel for a stalled turn.");

  const sessionId = thread.split(":").at(-1);
  const afterStall = await runTurn(client, thread);
  const sessionRestored = (await readJsonl<LogEntry>(log)).some(
    (entry) => (entry.event === "session/load" || entry.event === "session/resume") && entry.sessionId === sessionId,
  );
  report.afterStall = { status: afterStall.status, sessionRestored };
  assert.equal(afterStall.status, "completed", "A turn after a stall completes.");
  assert.equal(sessionRestored, true, "A turn after a stall opens the session again.");

  const answered = await runTurn(client, thread, { text: "answer-after-cancel", timeoutMs: STALL_MS * 10 });
  report.answerAfterCancel = { status: answered.status, reply: answered.reply, error: answered.error };
  assert.equal(answered.status, "completed", "An answer that arrives after a stall cancel completes the turn.");
  assert.equal(answered.reply, "late answer", "The answer that arrives after a stall cancel is kept.");

  const confirmed = await timed(() => runTurn(client, thread, { text: "confirm-cancel", timeoutMs: STALL_MS * 10 }));
  report.confirmedCancel = {
    status: confirmed.value.status,
    error: confirmed.value.error,
    elapsedMs: confirmed.elapsedMs,
  };
  assert.equal(confirmed.value.status, "failed", "A stalled turn that the agent cancels still fails.");
  assert.equal(
    confirmed.value.error,
    sourceText("error.agent.turnStalled", { provider: "OpenCode" }),
    "A stalled turn that the agent cancels names the stall.",
  );
  assert.ok(confirmed.elapsedMs < STALL_MS * 2, "A confirmed cancel ends the stalled turn without the full wait.");

  const toolOnly = await runTurn(client, thread, { text: "tool-after-cancel", timeoutMs: STALL_MS * 10 });
  report.toolAfterCancel = { status: toolOnly.status, error: toolOnly.error };
  assert.equal(toolOnly.status, "failed", "A tool update after a stall cancel is not an answer.");
  assert.equal(
    toolOnly.error,
    sourceText("error.agent.turnStalled", { provider: "OpenCode" }),
    "A stalled turn with only a tool update after the cancel names the stall.",
  );

  const retrying = await open(
    "opencode",
    OPENCODE_ACP_FLAVOR,
    join(root, "retry.jsonl"),
    { FAKE_RETRY_MS: String(RETRY_MS), FAKE_RATE_RETRY_MS: String(RATE_RETRY_MS) },
    undefined,
    undefined,
    RETRY_STALL_MS,
  );
  const retryThread = await startThread(retrying, { cwd: workspace });
  const retried = await timed(() =>
    runTurn(retrying, retryThread, { text: "retry-once", timeoutMs: RETRY_STALL_MS * 10 }),
  );
  report.retry = { status: retried.value.status, reply: retried.value.reply, elapsedMs: retried.elapsedMs };
  assert.equal(retried.value.status, "completed", "A turn whose model retry comes after the plain limit goes on.");
  assert.equal(retried.value.reply, "ok", "The retried model's answer is the turn's answer.");
  assert.ok(retried.elapsedMs >= RETRY_MS * 2, "The turn waited for the retry and its answer.");

  const forever = await timed(() =>
    runTurn(retrying, retryThread, { text: "retry-forever", timeoutMs: RETRY_STALL_MS * 20 }),
  );
  report.retryForever = { status: forever.value.status, error: forever.value.error, elapsedMs: forever.elapsedMs };
  assert.equal(forever.value.status, "failed", "Retries with no answer fail the turn.");
  assert.equal(
    forever.value.error,
    sourceText("error.agent.turnStalled", { provider: "OpenCode" }),
    "Retries with no answer name the stall.",
  );
  assert.ok(forever.elapsedMs >= RETRY_MS * 2, "The first retry got the whole limit.");
  assert.ok(forever.elapsedMs < RETRY_MS * 4, "Later retries did not keep the turn open.");

  const rateThread = await startThread(retrying, { cwd: workspace });
  const rateLimited = await timed(() =>
    runTurn(retrying, rateThread, { text: "retry-rate-limit", timeoutMs: RETRY_STALL_MS * 10 }),
  );
  report.rateLimitRetry = {
    status: rateLimited.value.status,
    reply: rateLimited.value.reply,
    elapsedMs: rateLimited.elapsedMs,
  };
  assert.equal(rateLimited.value.status, "completed", "Rate limit retries keep the turn open.");
  assert.equal(rateLimited.value.reply, "ok", "The answer after the rate limit retries is the turn's answer.");
  assert.ok(
    rateLimited.elapsedMs >= RATE_RETRY_MS + RETRY_STALL_MS * 1.2,
    "The turn went on after the first retry's limit.",
  );

  const endpoint = await open("opencode", OPENCODE_ACP_FLAVOR, join(root, "endpoint.jsonl"), {}, (modelId) =>
    modelId === "fake-alpha" ? { name: "My Lab", hasCredentials: false } : null,
  );
  const endpointThread = await startThread(endpoint, { cwd: workspace });
  const endpointStall = await runTurn(endpoint, endpointThread, { text: "hang", timeoutMs: STALL_MS * 10 });
  report.endpointStall = { status: endpointStall.status, error: endpointStall.error };
  assert.equal(endpointStall.status, "failed", "A silent endpoint turn fails.");
  assert.equal(
    endpointStall.error,
    sourceText("error.agent.turnStalled", { provider: "My Lab" }),
    "A stall on a custom endpoint names the endpoint.",
  );

  const slow = await open(
    "opencode",
    OPENCODE_ACP_FLAVOR,
    join(root, "slow-endpoint.jsonl"),
    { FAKE_QUIET_MS: String(STALL_MS * 2) },
    () => ({ name: "My Lab", hasCredentials: false, stallMs: STALL_MS * 10 }),
  );
  const slowThread = await startThread(slow, { cwd: workspace });
  const slowTurn = await timed(() => runTurn(slow, slowThread, { text: "quiet", timeoutMs: STALL_MS * 10 }));
  report.slowEndpoint = { status: slowTurn.value.status, reply: slowTurn.value.reply, elapsedMs: slowTurn.elapsedMs };
  assert.equal(slowTurn.value.status, "completed", "A slow endpoint turn is not ended at the agent's limit.");
  assert.equal(slowTurn.value.reply, "working, done", "The slow endpoint's answer is complete.");
  assert.ok(slowTurn.elapsedMs >= STALL_MS * 2, "The endpoint was silent for longer than the agent's limit.");

  const slowFlavor = await open(
    "cline",
    { ...DEFAULT_ACP_FLAVOR, turnStallMs: STALL_MS * 3 },
    join(root, "slow-flavor.jsonl"),
    { FAKE_QUIET_MS: String(STALL_MS * 2) },
    undefined,
    undefined,
    null,
  );
  const slowFlavorThread = await startThread(slowFlavor, { cwd: workspace });
  const slowQuiet = await runTurn(slowFlavor, slowFlavorThread, { text: "quiet", timeoutMs: STALL_MS * 10 });
  const slowHang = await timed(() => runTurn(slowFlavor, slowFlavorThread, { text: "hang", timeoutMs: STALL_MS * 10 }));
  report.slowFlavor = {
    quietStatus: slowQuiet.status,
    hangStatus: slowHang.value.status,
    hangElapsedMs: slowHang.elapsedMs,
  };
  assert.equal(
    slowQuiet.status,
    "completed",
    "A turn of a flavor with a longer limit is not ended at the plain limit.",
  );
  assert.equal(slowHang.value.status, "failed", "A silent prompt of that flavor still fails.");
  assert.equal(
    slowHang.value.error,
    sourceText("error.agent.turnStalled", { provider: "Cline" }),
    "A silent prompt of that flavor names the stall.",
  );
  assert.ok(slowHang.elapsedMs >= STALL_MS * 3, "The silent prompt was ended at the flavor's limit, not before.");

  const tool = await timed(() => runTurn(client, thread, { text: "tool" }));
  report.tool = { status: tool.value.status, elapsedMs: tool.elapsedMs };
  assert.equal(tool.value.status, "completed", "A long tool call does not stall the turn.");
  assert.ok(tool.elapsedMs >= TOOL_MS, "The tool call ran for its whole time.");

  const openToolLog = join(root, "opencode-open-tool.jsonl");
  const openToolClient = await open("opencode", { ...OPENCODE_ACP_FLAVOR, openToolStallMs: TOOL_MS * 2 }, openToolLog);
  const openToolThread = await startThread(openToolClient, { cwd: workspace });
  const longTool = await runTurn(openToolClient, openToolThread, { text: "tool" });
  const openTool = await timed(() =>
    runTurn(openToolClient, openToolThread, { text: "tool-hang", timeoutMs: TOOL_MS * 10 }),
  );
  report.openTool = {
    longToolStatus: longTool.status,
    hangStatus: openTool.value.status,
    error: openTool.value.error,
    elapsedMs: openTool.elapsedMs,
  };
  assert.equal(longTool.status, "completed", "A tool call shorter than the open tool limit still completes.");
  assert.equal(openTool.value.status, "failed", "A tool call that never ends fails the turn.");
  assert.equal(
    openTool.value.error,
    sourceText("error.agent.turnStalled", { provider: "OpenCode" }),
    "A tool call that never ends names the stall.",
  );
  assert.ok(openTool.elapsedMs >= TOOL_MS * 2, "The open tool call was ended at the open tool limit, not before.");
  assert.ok(openTool.elapsedMs < TOOL_MS * 6, "The open tool call did not hold the turn much past its limit.");

  const stopThread = await startThread(client, { cwd: workspace });
  const stopping = timed(() => runTurn(client, stopThread, { text: "hang", timeoutMs: 30_000 }));
  await waitForEntry(
    log,
    (entry) => entry.event === "prompt" && entry.text === "hang" && entry.sessionId !== sessionId,
  );
  await runCauseEffect(client.request("turn/interrupt", { threadId: stopThread }, (value) => value));
  const stopped = await stopping;
  const afterStop = await runTurn(client, stopThread);
  report.stop = { status: stopped.value.status, elapsedMs: stopped.elapsedMs, next: afterStop.status };
  assert.equal(stopped.value.status, "interrupted", "A stopped turn ends as interrupted, not as a stall.");
  assert.equal(afterStop.status, "completed", "A turn after the stop completes.");

  let deltaAt = 0;
  const onDelta = (notification: AppServerNotification) => {
    if (notification.method === "item/agentMessage/delta" && deltaAt === 0) deltaAt = Date.now();
  };
  client.on("notification", onDelta);
  const streamed = await timed(() => runTurn(client, thread, { text: "stream" }));
  client.off("notification", onDelta);
  const completedAt = Date.now();
  const deltaBeforeCompletion = deltaAt > 0 && completedAt - deltaAt >= CHUNK_GAP_MS / 2;
  report.stream = { deltaBeforeCompletion, reply: streamed.value.reply };
  assert.equal(streamed.value.status, "completed", "The streamed turn completes.");
  assert.equal(deltaBeforeCompletion, true, "Answer text streams before the prompt answers.");
  assert.equal(streamed.value.reply, "first part, second part", "The streamed answer is complete once.");

  const antigravityLog = join(root, "antigravity.jsonl");
  const antigravity = await open("antigravity", ANTIGRAVITY_ACP_FLAVOR, antigravityLog);
  const antigravityThread = await startThread(antigravity, { cwd: workspace });
  let antigravityEnded = false;
  const antigravityTurn = runTurn(antigravity, antigravityThread, { text: "hang", timeoutMs: 30_000 }).finally(() => {
    antigravityEnded = true;
  });
  await waitForEntry(antigravityLog, (entry) => entry.event === "prompt" && entry.text === "hang");
  await new Promise((settle) => setTimeout(settle, STALL_MS * 3));
  const antigravityStalled = antigravityEnded;
  await runCauseEffect(antigravity.request("turn/interrupt", { threadId: antigravityThread }, (value) => value));
  const antigravityStop = await antigravityTurn;
  report.antigravity = { stalled: antigravityStalled, stopStatus: antigravityStop.status };
  assert.equal(antigravityStalled, false, "A silent Antigravity prompt is not ended as stalled.");
  assert.equal(antigravityStop.status, "interrupted", "A stop still ends the Antigravity turn.");

  const silentFlavor: AcpFlavor = { ...ANTIGRAVITY_ACP_FLAVOR, silentTurnLimitMs: STALL_MS * 2 };
  const silentLog = join(root, "antigravity-silent.jsonl");
  const silent = await open("antigravity", silentFlavor, silentLog);
  const silentThread = await startThread(silent, { cwd: workspace });
  const silentTurn = await timed(() => runTurn(silent, silentThread, { text: "hang", timeoutMs: STALL_MS * 20 }));
  report.antigravitySilent = {
    status: silentTurn.value.status,
    error: silentTurn.value.error,
    elapsedMs: silentTurn.elapsedMs,
  };
  assert.equal(silentTurn.value.status, "failed", "A silent Antigravity prompt ends at its silent limit.");
  assert.ok(silentTurn.elapsedMs >= STALL_MS * 2, "The silent prompt is not ended before its silent limit.");

  const openStepFlavor: AcpFlavor = { ...silentFlavor, openToolStallMs: TOOL_MS * 2 };
  const openStep = await open("antigravity", openStepFlavor, join(root, "antigravity-open-step.jsonl"));
  const openStepThread = await startThread(openStep, { cwd: workspace });
  const longStep = await runTurn(openStep, openStepThread, { text: "tool" });
  const hungStep = await timed(() => runTurn(openStep, openStepThread, { text: "tool-hang", timeoutMs: TOOL_MS * 10 }));
  report.antigravityOpenStep = {
    longStepStatus: longStep.status,
    hangStatus: hungStep.value.status,
    error: hungStep.value.error,
    elapsedMs: hungStep.elapsedMs,
  };
  assert.equal(longStep.status, "completed", "An Antigravity step longer than the silent limit still completes.");
  assert.equal(hungStep.value.status, "failed", "An Antigravity step that never ends fails the turn.");
  assert.equal(
    hungStep.value.error,
    sourceText("error.agent.turnStalled", { provider: "Gemini" }),
    "An Antigravity step that never ends names the stall.",
  );
  assert.ok(
    hungStep.elapsedMs >= TOOL_MS * 2,
    "The open Antigravity step was ended at the open tool limit, not before.",
  );

  const geminiDir = join(root, "gemini");
  const agyLogs = join(geminiDir, "antigravity-acp", "log");
  await mkdir(agyLogs, { recursive: true });
  const loggedLog = join(root, "antigravity-logged.jsonl");
  const logged = await open("antigravity", silentFlavor, loggedLog, {}, undefined, undefined, STALL_MS, [
    "acp",
    `--gemini-dir=${geminiDir}`,
    "--app-data-dir=antigravity-acp",
  ]);
  const loggedThread = await startThread(logged, { cwd: workspace });
  const loggedTurn = timed(() => runTurn(logged, loggedThread, { text: "hang", timeoutMs: STALL_MS * 20 }));
  await waitForEntry(loggedLog, (entry) => entry.event === "prompt" && entry.text === "hang");
  const prompt = (await readJsonl<LogEntry>(loggedLog)).find((entry) => entry.event === "prompt");
  await writeFile(
    join(agyLogs, "acp-server.log"),
    [
      `I1123 10:00:00.000000 server.go:10] Sending user message to conversation ${prompt?.sessionId ?? ""}`,
      "E1123 10:00:01.000000 executor.go:20] agent executor error: Error 502, Message: Bad Gateway, Status: 502 Bad Gateway, Details: []",
      "I1123 10:00:02.000000 server.go:10] Sending user message to conversation other-session",
      "E1123 10:00:03.000000 executor.go:20] agent executor error: Error 429, Message: Resource exhausted, Status: 429 Too Many Requests, Details: []",
      "",
    ].join("\n"),
  );
  const loggedEnd = await loggedTurn;
  report.antigravityLogged = {
    status: loggedEnd.value.status,
    error: loggedEnd.value.error,
    elapsedMs: loggedEnd.elapsedMs,
  };
  assert.equal(loggedEnd.value.status, "failed", "A silent prompt with a logged error ends at its silent limit.");
  assert.equal(
    loggedEnd.value.error,
    sourceText("error.provider.antigravityServiceFailure", { detail: "Bad Gateway" }),
    "The turn shows its own error from the agy log, not a generic stall or the error of another session.",
  );

  const firstLog = join(root, "antigravity-first.jsonl");
  const first = await open(
    "antigravity",
    ANTIGRAVITY_ACP_FLAVOR,
    firstLog,
    { FAKE_RESUME: "1", FAKE_QUIET_MS: String(FIRST_UPDATE_MS * 3) },
    undefined,
    FIRST_UPDATE_MS,
  );
  const lostThread = await startThread(first, { cwd: workspace });
  const lostSession = lostThread.split(":").at(-1);
  const lost = await runTurn(first, lostThread, { text: "hang-once", timeoutMs: FIRST_UPDATE_MS * 10 });
  const lostEntries = (await readJsonl<LogEntry>(firstLog)).filter((entry) => entry.sessionId === lostSession);
  report.lostPrompt = {
    status: lost.status,
    reply: lost.reply,
    prompts: lostEntries.filter((entry) => entry.event === "prompt").length,
    cancels: lostEntries.filter((entry) => entry.event === "cancel").length,
    resumes: lostEntries.filter((entry) => entry.event === "session/resume").length,
  };
  assert.equal(lost.status, "completed", "A lost Antigravity prompt completes when it is sent again.");
  assert.equal(lost.reply, "ok", "The answer to the prompt sent again is the turn's answer.");
  assert.equal(report.lostPrompt.prompts, 2, "The lost prompt is sent again once.");
  assert.equal(report.lostPrompt.cancels, 1, "The lost prompt is cancelled before it is sent again.");
  assert.equal(report.lostPrompt.resumes, 1, "The session is resumed before the prompt is sent again.");

  const twiceThread = await startThread(first, { cwd: workspace });
  const twice = await timed(() => runTurn(first, twiceThread, { text: "hang", timeoutMs: FIRST_UPDATE_MS * 20 }));
  const afterTwice = await runTurn(first, twiceThread);
  report.lostTwice = {
    status: twice.value.status,
    error: twice.value.error,
    elapsedMs: twice.elapsedMs,
    next: afterTwice.status,
  };
  assert.equal(twice.value.status, "failed", "A prompt that is silent twice fails the turn.");
  assert.equal(
    twice.value.error,
    sourceText("error.agent.turnStalled", { provider: "Gemini" }),
    "The failure tells the user to send the message again.",
  );
  assert.ok(twice.elapsedMs >= FIRST_UPDATE_MS * 2, "Each prompt gets the whole limit.");
  assert.equal(afterTwice.status, "completed", "The next prompt after the failure completes.");

  const quietThread = await startThread(first, { cwd: workspace });
  const quietSession = quietThread.split(":").at(-1);
  const quiet = await runTurn(first, quietThread, { text: "quiet", timeoutMs: FIRST_UPDATE_MS * 20 });
  report.quiet = {
    status: quiet.status,
    reply: quiet.reply,
    prompts: (await readJsonl<LogEntry>(firstLog)).filter(
      (entry) => entry.event === "prompt" && entry.sessionId === quietSession,
    ).length,
  };
  assert.equal(quiet.status, "completed", "A quiet prompt after its first update completes.");
  assert.equal(quiet.reply, "working, done", "The quiet prompt's answer is whole.");
  assert.equal(report.quiet.prompts, 1, "A quiet prompt is not sent again.");

  const noLoadLog = join(root, "no-load.jsonl");
  const noLoad = await open("cline", DEFAULT_ACP_FLAVOR, noLoadLog, { FAKE_NO_LOAD: "1" });
  const noLoadThread = await startThread(noLoad, { cwd: workspace });
  const noLoadTurn = runTurn(noLoad, noLoadThread, { text: "hang", timeoutMs: 30_000 });
  await waitForEntry(noLoadLog, (entry) => entry.event === "prompt" && entry.text === "hang");
  const sessionsBefore = (await readJsonl<LogEntry>(noLoadLog)).filter((entry) => entry.event === "session/new").length;
  await runCauseEffect(noLoad.request("turn/interrupt", { threadId: noLoadThread }, (value) => value));
  const noLoadStop = await noLoadTurn;
  const noLoadNext = await runTurn(noLoad, noLoadThread);
  const noLoadEntries = await readJsonl<LogEntry>(noLoadLog);
  report.noLoad = {
    stopStatus: noLoadStop.status,
    next: noLoadNext.status,
    sessionsOpened: noLoadEntries.filter((entry) => entry.event === "session/new").length - sessionsBefore,
    loads: noLoadEntries.filter((entry) => entry.event === "session/load" || entry.event === "session/resume").length,
  };
  assert.equal(noLoadStop.status, "interrupted", "A stop ends the turn of an agent that cannot load sessions.");
  assert.equal(noLoadNext.status, "completed", "The next turn of that agent completes.");
  assert.equal(report.noLoad.sessionsOpened, 0, "The agent keeps its session.");
  assert.equal(report.noLoad.loads, 0, "OpenBot does not try to open the session again.");

  const silentNew = await open("cline", DEFAULT_ACP_FLAVOR, join(root, "silent-new.jsonl"), { FAKE_SILENT_NEW: "1" });
  const silentStart = await timed(() =>
    startThread(silentNew, { cwd: workspace }).then(
      () => "",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    ),
  );
  report.silentNew = { error: silentStart.value, elapsedMs: silentStart.elapsedMs };
  assert.equal(
    silentStart.value,
    sourceText("error.provider.acpUnresponsive", { provider: "Cline" }),
    "A session start that the agent never answers fails after the stall limit.",
  );
  assert.ok(silentStart.elapsedMs >= STALL_MS, "The session start waits for the stall limit first.");

  const heldLog = join(root, "held-session.jsonl");
  const held = await openStrict("held-session", { FAKE_HANG_MS: String(STALL_MS * 4) });
  const heldThread = await startThread(held, { cwd: workspace });
  const heldStall = await runTurn(held, heldThread, { text: "hang", timeoutMs: STALL_MS * 10 });
  const heldBusy = await runTurn(held, heldThread, { timeoutMs: 10_000 }).then(
    () => false,
    (error: unknown) => error instanceof ProviderSessionBusyError,
  );
  await waitForEntry(heldLog, (entry) => entry.event === "prompt-ended", 15_000);
  const heldNext = await runTurn(held, heldThread, { timeoutMs: 10_000 });
  report.heldSession = await activeSessionReport(heldLog, heldStall, heldNext, heldBusy);
  assert.equal(heldStall.status, "failed", "A silent turn of a strict agent fails at the stall limit.");
  assert.equal(heldBusy, true, "While the stopped prompt still runs, the message waits as for a busy session.");
  assert.equal(heldNext.status, "completed", "The next message uses the session that the agent still holds.");
  assert.equal(heldNext.reply, "ok", "The agent answers in the held session.");
  assert.equal(report.heldSession.sameSession, true, "No new session replaces the chat.");
  assert.ok(report.heldSession.refusedRestores >= 2, "The agent refused to open the held session again.");

  const reasonLog = join(root, "reason-held-session.jsonl");
  const reasonHeld = await openStrict("reason-held-session", {
    FAKE_HANG_MS: String(STALL_MS * 4),
    FAKE_REFUSAL: "reason",
  });
  const reasonThread = await startThread(reasonHeld, { cwd: workspace });
  const reasonStall = await runTurn(reasonHeld, reasonThread, { text: "hang", timeoutMs: STALL_MS * 10 });
  const reasonBusy = await runTurn(reasonHeld, reasonThread, { timeoutMs: 10_000 }).then(
    () => false,
    (error: unknown) => error instanceof ProviderSessionBusyError,
  );
  await waitForEntry(reasonLog, (entry) => entry.event === "prompt-ended", 15_000);
  const reasonNext = await runTurn(reasonHeld, reasonThread, { timeoutMs: 10_000 });
  report.reasonHeldSession = await activeSessionReport(reasonLog, reasonStall, reasonNext, reasonBusy);
  assert.equal(reasonStall.status, "failed", "A silent turn fails at the stall limit.");
  assert.equal(reasonBusy, true, "A -32901 session_already_open refusal makes the message wait, not fail.");
  assert.equal(reasonNext.status, "completed", "The next message uses the session that the agent still holds.");
  assert.equal(reasonNext.reply, "ok", "The agent answers in the held session.");
  assert.equal(report.reasonHeldSession.sameSession, true, "No new session replaces the chat.");
  assert.ok(report.reasonHeldSession.refusedRestores >= 2, "The agent refused to open the held session again.");

  const closedLog = join(root, "closed-held-session.jsonl");
  const closed = await openStrict("closed-held-session", { FAKE_CLOSE: "1", FAKE_RESUME: "1" });
  const closedThread = await startThread(closed, { cwd: workspace });
  const closedStall = await runTurn(closed, closedThread, { text: "hang", timeoutMs: STALL_MS * 10 });
  const closedNext = await runTurn(closed, closedThread, { timeoutMs: 10_000 });
  report.closedHeldSession = await activeSessionReport(closedLog, closedStall, closedNext);
  assert.equal(closedStall.status, "failed", "A silent turn of a strict agent fails at the stall limit.");
  assert.equal(closedNext.status, "completed", "The next message works after OpenBot closes the held session.");
  assert.equal(closedNext.reply, "ok", "The agent answers after the session opens again.");
  assert.equal(report.closedHeldSession.refusedRestores, 1, "The agent refused only the first resume.");
  assert.equal(report.closedHeldSession.closes, 1, "OpenBot closes the refused session once.");
  assert.equal(report.closedHeldSession.sameSession, true, "No new session replaces the chat.");

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await stopClients(clients);
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
