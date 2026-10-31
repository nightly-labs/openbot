// An ACP turn that sends nothing must end, and a stop must end a turn that the agent does not end
// (#2858). Drives the real `AcpAgentClient` with the OpenCode and Antigravity flavors over one fake
// agent (`provider-fakes/agents/stall.ts`) and a short stall limit:
// - a silent prompt fails with the stall message, and the next turn opens the session again;
// - a stall on a custom endpoint's model names the endpoint, not OpenCode (#3234);
// - an open tool call longer than the limit is not a stall;
// - a stop of a prompt that ignores `session/cancel` ends the turn as interrupted;
// - OpenCode answer text streams before the prompt answers;
// - Antigravity, whose prompt stays open for background tasks, is not ended as stalled;
// - an agent that cannot load a session keeps it after a stop that OpenBot ends.
// `bun run test:acp-turn-stall`. Writes .openbot-build/acp-turn-stall-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { AcpAgentClient } from "../src/backend/acp-client";
import { type AcpCustomEndpoint, type AcpFlavor, DEFAULT_ACP_FLAVOR } from "../src/backend/acp-flavor";
import { ANTIGRAVITY_ACP_FLAVOR } from "../src/backend/acp-flavor-antigravity";
import { OPENCODE_ACP_FLAVOR } from "../src/backend/acp-flavor-opencode";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { AppServerNotification } from "../src/backend/protocol";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/acp-turn-stall-e2e");
const STALL_MS = 1_500;
const TOOL_MS = STALL_MS * 3;
const CHUNK_GAP_MS = 500;

interface LogEntry {
  event: string;
  sessionId?: string;
  text?: string;
}

interface Report {
  passed: boolean;
  stall?: { status: string | null; error: string | null; elapsedMs: number; cancelSent: boolean };
  afterStall?: { status: string | null; sessionRestored: boolean };
  endpointStall?: { status: string | null; error: string | null };
  tool?: { status: string | null; elapsedMs: number };
  stop?: { status: string | null; elapsedMs: number; next: string | null };
  stream?: { deltaBeforeCompletion: boolean; reply: string };
  antigravity?: { stalled: boolean; stopStatus: string | null };
  /** `sessionsOpened` counts only the sessions opened after the stop. */
  noLoad?: { stopStatus: string | null; next: string | null; sessionsOpened: number; loads: number };
  failure?: string;
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
    argv: ["acp"],
    env: {},
    signInMessage: "Sign in to the fake agent.",
    turnStallMs: STALL_MS,
    ...(customEndpoint ? { customEndpoint } : {}),
  });
  clients.push(client);
  client.start();
  return client;
}

async function timed<T>(run: () => Promise<T>): Promise<{ value: T; elapsedMs: number }> {
  const started = Date.now();
  const value = await run();
  return { value, elapsedMs: Date.now() - started };
}

/** Waits until the fake logs an entry that matches, or fails after `timeoutMs`. */
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

  // OpenCode: a silent prompt fails with the stall message, and the agent gets `session/cancel`.
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

  // The prompt may still run in the agent, so the next turn opens the session again first.
  const sessionId = thread.split(":").at(-1);
  const afterStall = await runTurn(client, thread);
  const sessionRestored = (await readJsonl<LogEntry>(log)).some(
    (entry) => (entry.event === "session/load" || entry.event === "session/resume") && entry.sessionId === sessionId,
  );
  report.afterStall = { status: afterStall.status, sessionRestored };
  assert.equal(afterStall.status, "completed", "A turn after a stall completes.");
  assert.equal(sessionRestored, true, "A turn after a stall opens the session again.");

  // OpenCode serves a custom endpoint, and the user knows that turn by the endpoint's name. The fake
  // agent's one model stands for an endpoint model here.
  const endpoint = await open("opencode", OPENCODE_ACP_FLAVOR, join(root, "endpoint.jsonl"), {}, (modelId) =>
    modelId === "fake-alpha" ? { name: "My Lab", hasApiKey: false } : null,
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

  // An open tool call is work, not a stall, also when it takes longer than the limit.
  const tool = await timed(() => runTurn(client, thread, { text: "tool" }));
  report.tool = { status: tool.value.status, elapsedMs: tool.elapsedMs };
  assert.equal(tool.value.status, "completed", "A long tool call does not stall the turn.");
  assert.ok(tool.elapsedMs >= TOOL_MS, "The tool call ran for its whole time.");

  // A stop of a prompt that ignores the cancel ends the turn after the grace.
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

  // OpenCode answer text reaches the client before the prompt answers.
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

  // Antigravity keeps a prompt open for background tasks, so a silent prompt is not a stall.
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

  // An agent with no session/load or resume cannot give a session back. A stop that OpenBot ends
  // keeps the session, so the next turn does not replace it and lose its context.
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
