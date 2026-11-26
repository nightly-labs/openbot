import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getRecord, getString, isRecord } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-background-command-e2e");
const WAIT_MS = 60_000;

interface LogEntry {
  event: string;
  sessionId?: string;
  text?: string;
}

interface Seen {
  method: string;
  unprompted?: boolean;
  running?: boolean;
  status?: string | null;
  text?: string;
}

interface Report {
  passed: boolean;
  ownChat?: {
    answered: Seen[];
    waitsWhileCommandRuns: boolean;
    woke: Seen[];
    waitsAfterWake: boolean;
    wakePrompt: string;
  };
  otherTurn?: { events: Seen[]; turnsStarted: number; listedWhileOpen: boolean };
  answeredInNextTurn?: { events: Seen[]; waitsAfterTurn: boolean };
  ownReply?: { events: Seen[]; prompts: number; waitsAfterReply: boolean };
  failure?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-background-command-e2e-"));
process.env.GEMINI_HOME = join(root, "gemini");
const finishDir = join(root, "finished");
await mkdir(finishDir, { recursive: true });
const report: Report = { passed: false };
const clients: AgentClient[] = [];

async function waitFor(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${what}.`);
    await new Promise((settle) => setTimeout(settle, 25));
  }
}

function record(client: AgentClient, thread: string): Seen[] {
  const seen: Seen[] = [];
  client.on("notification", (notification: AppServerNotification) => {
    const params = notification.params;
    if (getString(params, "threadId") !== thread || !isRecord(params)) return;
    if (notification.method === "turn/started")
      seen.push({ method: "turn/started", unprompted: params.unprompted === true });
    if (notification.method === "openbot/background-work")
      seen.push({ method: "background-work", running: params.running === true });
    if (notification.method === "turn/completed")
      seen.push({ method: "turn/completed", status: getString(getRecord(params, "turn"), "status") });
    if (notification.method === "item/completed") {
      const text = getString(params.item, "text");
      if (text) seen.push({ method: "item/completed", text });
    }
  });
  return seen;
}

async function open(
  name: string,
  env: Record<string, string> = {},
): Promise<{ client: AgentClient; log: string; thread: string }> {
  const executable = join(root, name, "bin", "antigravity");
  const log = join(root, name, "agent.jsonl");
  await installFakeAgent(executable, "antigravity-background-command", {
    FAKE_LOG: log,
    FAKE_FINISH_DIR: finishDir,
    ...env,
  });
  const client = requireProviderDriver("antigravity").createClient(
    { executable, version: "1.5.14", source: "managed" },
    10_000,
    NO_PROVIDER_CREDENTIALS,
  );
  clients.push(client);
  client.on("request", (request) =>
    client.respondError(request.id, { code: -32601, message: `The test does not answer ${request.method}.` }),
  );
  client.start();
  const thread = await startThread(client, { cwd: root });
  return { client, log, thread };
}

async function startTurn(
  client: AgentClient,
  thread: string,
  wakeAfterCommands: boolean,
  text = "linger",
): Promise<string> {
  const turnId = await runCauseEffect(
    client.request(
      "turn/start",
      {
        threadId: thread,
        input: [{ type: "text", text, text_elements: [] }],
        ...(wakeAfterCommands ? { wakeAfterCommands } : {}),
      },
      (value) => getString(getRecord(value, "turn"), "id"),
    ),
  );
  if (!turnId) throw new Error("turn/start answers no turn id.");
  return turnId;
}

const completions = (seen: Seen[]) => seen.filter((entry) => entry.method === "turn/completed").length;
const waits = (client: AgentClient, thread: string) =>
  client.wakesAfterBackgroundWork ? runCauseEffect(client.wakesAfterBackgroundWork(thread)) : Promise.resolve(false);
const lists = async (log: string) => (await readJsonl<LogEntry>(log)).filter((entry) => entry.event === "list").length;

try {
  const own = await open("own-chat");
  const ownSeen = record(own.client, own.thread);
  await startTurn(own.client, own.thread, true);
  await waitFor(() => completions(ownSeen) === 1, "the chat turn completes while its command runs");
  const answered = [...ownSeen];
  const listedAtAnswer = await lists(own.log);
  assert.deepEqual(
    answered.filter((entry) => entry.method !== "item/completed"),
    [
      { method: "turn/started", unprompted: false },
      { method: "background-work", running: true },
      { method: "turn/completed", status: "completed" },
    ],
  );
  assert.ok(
    answered.some((entry) => entry.text === "The report is ready."),
    "The answer must show at once.",
  );
  const waitsWhileCommandRuns = await waits(own.client, own.thread);
  assert.equal(waitsWhileCommandRuns, true);
  const sessionId = (await readJsonl<LogEntry>(own.log)).find((entry) => entry.event === "prompt")?.sessionId ?? "";
  assert.ok(sessionId, "The fake agent did not log the prompt.");
  await waitFor(async () => (await lists(own.log)) > listedAtAnswer, "the idle chat checks the session");
  await writeFile(join(finishDir, sessionId), "");
  await waitFor(() => completions(ownSeen) === 2, "a wake turn reads the finished command");
  const woke = ownSeen.slice(answered.length);
  assert.deepEqual(
    woke.filter((entry) => entry.method !== "item/completed"),
    [
      { method: "background-work", running: false },
      { method: "turn/started", unprompted: true },
      { method: "turn/completed", status: "completed" },
    ],
  );
  assert.ok(woke.some((entry) => entry.text === "The command finished."));
  const wakePrompt = (await readJsonl<LogEntry>(own.log)).filter((entry) => entry.event === "prompt")[1]?.text ?? "";
  assert.match(wakePrompt, /<openbot_background_wake>/u);
  const waitsAfterWake = await waits(own.client, own.thread);
  assert.equal(waitsAfterWake, false);
  report.ownChat = { answered, waitsWhileCommandRuns, woke, waitsAfterWake, wakePrompt };

  const other = await open("other-turn");
  const otherSeen = record(other.client, other.thread);
  await startTurn(other.client, other.thread, false);
  const otherSession = await (async () => {
    await waitFor(
      async () => (await readJsonl<LogEntry>(other.log)).some((entry) => entry.event === "prompt"),
      "the other turn reaches the agent",
    );
    return (await readJsonl<LogEntry>(other.log)).find((entry) => entry.event === "prompt")?.sessionId ?? "";
  })();
  await waitFor(async () => (await lists(other.log)) > 0, "the open turn checks the session");
  const listedWhileOpen = completions(otherSeen) === 0;
  assert.ok(listedWhileOpen, "A turn outside the agent's own chat must keep waiting for its command.");
  await writeFile(join(finishDir, otherSession), "");
  await waitFor(() => completions(otherSeen) === 1, "the other turn continues after the command");
  const turnsStarted = otherSeen.filter((entry) => entry.method === "turn/started").length;
  assert.equal(turnsStarted, 1);
  assert.ok(!otherSeen.some((entry) => entry.method === "background-work"));
  assert.ok(otherSeen.some((entry) => entry.text?.includes("The command finished.")));
  report.otherTurn = { events: otherSeen, turnsStarted, listedWhileOpen };

  const next = await open("next-turn");
  const nextSeen = record(next.client, next.thread);
  await startTurn(next.client, next.thread, true);
  await waitFor(() => completions(nextSeen) === 1, "the chat turn completes while its command runs");
  assert.equal(await waits(next.client, next.thread), true);
  const beforeStatus = nextSeen.length;
  await startTurn(next.client, next.thread, true, "status");
  await waitFor(() => completions(nextSeen) === 2, "the next turn reads the finished command");
  const statusEvents = nextSeen.slice(beforeStatus);
  assert.ok(statusEvents.some((entry) => entry.text === "The command already finished."));
  assert.ok(
    !statusEvents.some((entry) => entry.method === "background-work" && entry.running),
    "A command that the next turn saw finish must not show the wait again.",
  );
  const waitsAfterTurn = await waits(next.client, next.thread);
  assert.equal(waitsAfterTurn, false);
  report.answeredInNextTurn = { events: statusEvents, waitsAfterTurn };

  const replying = await open("own-reply", { FAKE_OWN_REPLY: "1" });
  const replySeen = record(replying.client, replying.thread);
  await startTurn(replying.client, replying.thread, true);
  await waitFor(() => completions(replySeen) === 1, "the chat turn completes while its command runs");
  const replyAnswered = replySeen.length;
  const listedBeforeReply = await lists(replying.log);
  await waitFor(async () => (await lists(replying.log)) > listedBeforeReply, "the idle chat checks the session");
  const replySession =
    (await readJsonl<LogEntry>(replying.log)).find((entry) => entry.event === "prompt")?.sessionId ?? "";
  await writeFile(join(finishDir, replySession), "");
  await waitFor(() => completions(replySeen) === 2, "the agent's own reply after the command shows in a turn");
  const replyEvents = replySeen.slice(replyAnswered);
  assert.deepEqual(
    replyEvents.filter((entry) => entry.method !== "item/completed"),
    [
      { method: "background-work", running: false },
      { method: "turn/started", unprompted: true },
      { method: "turn/completed", status: "completed" },
    ],
  );
  assert.equal(replyEvents.filter((entry) => entry.text === "The command finished by itself.").length, 1);
  const prompts = (await readJsonl<LogEntry>(replying.log)).filter((entry) => entry.event === "prompt").length;
  assert.equal(prompts, 1, "An agent that replies by itself must not get the wake prompt.");
  const waitsAfterReply = await waits(replying.client, replying.thread);
  assert.equal(waitsAfterReply, false);
  report.ownReply = { events: replyEvents, prompts, waitsAfterReply };

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
