import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getRecord, getString, isRecord } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-steer-e2e");
const TURN_TIMEOUT_MS = 20_000;

interface LogEntry {
  event: string;
  sessionId?: string;
  text?: string;
  steer?: boolean;
}

interface Finished {
  reply: string;
  status: string | null;
  started: number;
  usage: number;
}

interface Report {
  passed: boolean;
  steered?: Finished & { turnId: string; prompts: LogEntry[]; cancelSent: boolean };
  twice?: Finished & { prompts: LogEntry[] };
  beforeAnswer?: Finished & { events: string[] };
  wrongTurn?: { refused: string; prompts: number };
  afterTurn?: { refused: string; prompts: number };
  waitingOnUser?: { refused: string; prompts: number; reply: string; status: string | null };
  refusedByCli?: { refused: string; cliRefusals: number; reply: string; status: string | null };
  oldCli?: { refused: string; prompts: number; status: string | null };
  heldWork?: { status: string | null; releasable: boolean | undefined; closedSessions: number; daemonRuns: boolean };
  reloadNote?: { afterIdleStop: boolean; secondPrompt: boolean; heldSession: boolean };
  failure?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-steer-e2e-"));
process.env.GEMINI_HOME = join(root, "gemini");
const report: Report = { passed: false };
const clients: AgentClient[] = [];

async function open(
  name: string,
  env: Readonly<Record<string, string>>,
): Promise<{ client: AgentClient; log: string }> {
  const executable = join(root, name, "bin", "antigravity");
  const log = join(root, name, "agent.jsonl");
  await installFakeAgent(executable, "antigravity-steer", { FAKE_LOG: log, ...env });
  const client = requireProviderDriver("antigravity").createClient(
    { executable, version: "1.5.4", source: "managed" },
    10_000,
    NO_PROVIDER_CREDENTIALS,
  );
  clients.push(client);
  return { client, log };
}

async function waitForEntry(log: string, match: (entry: LogEntry) => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await readJsonl<LogEntry>(log)).some(match)) {
    if (Date.now() > deadline) throw new Error("The fake agent did not log the expected request.");
    await new Promise((settle) => setTimeout(settle, 25));
  }
}

const prompts = async (log: string) => (await readJsonl<LogEntry>(log)).filter((entry) => entry.event === "prompt");

interface RunningTurn {
  id: string;
  done: Promise<Finished>;
}

async function startTurn(client: AgentClient, thread: string, log: string, text: string): Promise<RunningTurn> {
  let reply = "";
  let started = 0;
  let usage = 0;
  let listener: ((notification: AppServerNotification) => void) | undefined;
  const done = new Promise<Finished>((finish, fail) => {
    const timer = setTimeout(() => fail(new Error("The turn did not complete.")), TURN_TIMEOUT_MS);
    listener = (notification) => {
      if (getString(notification.params, "threadId") !== thread) return;
      if (notification.method === "turn/started") started += 1;
      if (notification.method === "openbot/usage") usage += 1;
      if (notification.method === "item/completed" && isRecord(notification.params))
        reply += getString(notification.params.item, "text") ?? "";
      if (notification.method === "turn/completed") {
        clearTimeout(timer);
        if (listener) client.off("notification", listener);
        finish({ reply, status: getString(getRecord(notification.params, "turn"), "status"), started, usage });
      }
    };
    client.on("notification", listener);
  });
  done.catch(() => undefined);
  const before = (await prompts(log)).length;
  const response = await runCauseEffect(
    client.request(
      "turn/start",
      { threadId: thread, input: [{ type: "text", text, text_elements: [] }] },
      (value) => value,
    ),
  );
  const id = getString(getRecord(response, "turn"), "id");
  if (!id) throw new Error("turn/start answers no turn id.");
  const deadline = Date.now() + 10_000;
  while ((await prompts(log)).length <= before) {
    if (Date.now() > deadline) throw new Error(`The fake agent did not get the prompt "${text}".`);
    await new Promise((settle) => setTimeout(settle, 25));
  }
  return { id, done };
}

function steer(client: AgentClient, thread: string, turnId: string, text: string): Promise<string | null> {
  return runCauseEffect(
    client.request(
      "turn/steer",
      {
        threadId: thread,
        expectedTurnId: turnId,
        clientUserMessageId: `delivery-${text}`,
        input: [{ type: "text", text, text_elements: [] }],
      },
      (value) => getString(value, "turnId"),
    ),
  );
}

async function sessionPid(log: string, text: string, index: number): Promise<number> {
  const sessionId = (await prompts(log)).filter((entry) => entry.text === text)[index]?.sessionId ?? "";
  const pid = Number(/^agy-(\d+)-/u.exec(sessionId)?.[1]);
  if (!Number.isInteger(pid)) throw new Error(`No session got the prompt "${text}".`);
  return pid;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (isRunning(pid)) {
    if (Date.now() > deadline) throw new Error(`The session process ${pid} did not end.`);
    await new Promise((settle) => setTimeout(settle, 25));
  }
}

async function refusal(operation: Promise<string | null>): Promise<string> {
  const outcome = await operation.then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  assert.ok(outcome !== null, "The steer must be refused.");
  return outcome;
}

try {
  const firstUpdateRelease = join(root, "native-release", "first-update");
  await mkdir(join(root, "native-release"), { recursive: true });
  const { client, log } = await open("native", { FAKE_FIRST_UPDATE_RELEASE: firstUpdateRelease });
  let heldApproval: (() => void) | undefined;
  let approvals = 0;
  let approvalAsked: () => void = () => undefined;
  const approval = new Promise<void>((asked) => {
    approvalAsked = asked;
  });
  client.on("request", (request) => {
    if (!request.method.endsWith("/requestApproval")) {
      client.respondError(request.id, { code: -32601, message: `The test does not answer ${request.method}.` });
      return;
    }
    heldApproval = () => client.respond(request.id, { decision: "accept" });
    approvals += 1;
    approvalAsked();
  });
  client.start();
  const thread = await startThread(client, { cwd: root });

  const turn = await startTurn(client, thread, log, "work");
  assert.equal(await steer(client, thread, turn.id, "use the other branch"), turn.id);
  const steered = await turn.done;
  const steeredPrompts = await prompts(log);
  const cancelSent = (await readJsonl<LogEntry>(log)).some((entry) => entry.event === "cancel");
  assert.equal(steered.status, "completed");
  assert.match(steered.reply, /steered: use the other branch/u);
  assert.equal(steered.started, 1, "The steer must not start another turn.");
  assert.equal(steered.usage, 2, "Each prompt reports its usage.");
  assert.deepEqual(
    steeredPrompts.map(({ text, steer: isSteer }) => ({ text, steer: isSteer })),
    [
      { text: "work", steer: false },
      { text: "use the other branch", steer: true },
    ],
  );
  assert.equal(cancelSent, false, "The steer must not cancel the turn.");
  report.steered = { turnId: turn.id, ...steered, prompts: steeredPrompts, cancelSent };

  const twiceTurn = await startTurn(client, thread, log, "work");
  const beforeTwice = (await prompts(log)).length - 1;
  assert.equal(await steer(client, thread, twiceTurn.id, "more context"), twiceTurn.id);
  await waitForEntry(log, (entry) => entry.event === "prompt" && entry.text === "more context");
  assert.equal(await steer(client, thread, twiceTurn.id, "finish now"), twiceTurn.id);
  const twice = await twiceTurn.done;
  const twicePrompts = (await prompts(log)).slice(beforeTwice);
  assert.equal(twice.status, "completed");
  assert.match(twice.reply, /steered: finish now/u);
  assert.equal(twice.started, 1);
  assert.equal(twice.usage, 3);
  assert.deepEqual(
    twicePrompts.map(({ text }) => text),
    ["work", "more context", "finish now"],
  );
  report.twice = { ...twice, prompts: twicePrompts };

  const slow = await startTurn(client, thread, log, "slow start");
  const beforeSlow = await readJsonl<LogEntry>(log);
  const slowSteer = steer(client, thread, slow.id, "before the first answer");
  await writeFile(firstUpdateRelease, "");
  assert.equal(await slowSteer, slow.id);
  const slowFinished = await slow.done;
  const slowEvents = (await readJsonl<LogEntry>(log))
    .slice(beforeSlow.length)
    .map((entry) => (entry.event === "prompt" ? `prompt:${entry.text}` : entry.event));
  assert.equal(slowFinished.status, "completed");
  assert.match(slowFinished.reply, /steered: before the first answer/u);
  assert.equal(slowFinished.started, 1, "The steer must not start another turn.");
  assert.deepEqual(slowEvents, ["first-update", "prompt:before the first answer"]);
  report.beforeAnswer = { ...slowFinished, events: slowEvents };

  const third = await startTurn(client, thread, log, "work");
  const beforeWrong = (await prompts(log)).length;
  const wrongTurn = await refusal(steer(client, thread, "another-turn", "late"));
  assert.equal((await prompts(log)).length, beforeWrong);
  report.wrongTurn = { refused: wrongTurn, prompts: (await prompts(log)).length - beforeWrong };
  await steer(client, thread, third.id, "end");
  await third.done;

  const beforeAfter = (await prompts(log)).length;
  const afterTurn = await refusal(steer(client, thread, third.id, "too late"));
  assert.equal((await prompts(log)).length, beforeAfter);
  report.afterTurn = { refused: afterTurn, prompts: (await prompts(log)).length - beforeAfter };

  const asking = await startTurn(client, thread, log, "ask");
  await Promise.race([
    approval,
    asking.done.then(() => {
      throw new Error("The turn ended before it asked for a permission.");
    }),
  ]);
  const beforeAsk = (await prompts(log)).length;
  const waitingRefused = await refusal(steer(client, thread, asking.id, "skip that"));
  assert.equal((await prompts(log)).length, beforeAsk);
  heldApproval?.();
  const asked = await asking.done;
  assert.equal(asked.status, "completed");
  assert.match(asked.reply, /asked: .*allow/u);
  report.waitingOnUser = {
    refused: waitingRefused,
    prompts: (await prompts(log)).length - beforeAsk,
    reply: asked.reply,
    status: asked.status,
  };

  const toolShown = new Promise<void>((shown) => {
    const listener = (notification: AppServerNotification) => {
      if (notification.method !== "item/started" || getString(notification.params, "threadId") !== thread) return;
      client.off("notification", listener);
      shown();
    };
    client.on("notification", listener);
  });
  const approvalsBefore = approvals;
  const holding = await startTurn(client, thread, log, "hold");
  await toolShown;
  const [cliRefused] = await Promise.all([
    refusal(steer(client, thread, holding.id, "do this too")),
    refusal(steer(client, thread, holding.id, "and this")),
  ]);
  const cliRefusals = (await readJsonl<LogEntry>(log)).filter((entry) => entry.event === "refused").length;
  assert.equal(cliRefusals, 2, "Both steers must reach the CLI before its permission request.");
  const deadline = Date.now() + 10_000;
  while (approvals === approvalsBefore) {
    if (Date.now() > deadline) throw new Error("The CLI did not ask for the permission.");
    await new Promise((settle) => setTimeout(settle, 25));
  }
  heldApproval?.();
  const holdFinished = await holding.done;
  assert.equal(holdFinished.status, "completed");
  assert.match(holdFinished.reply, /held: done/u);
  report.refusedByCli = { refused: cliRefused, cliRefusals, reply: holdFinished.reply, status: holdFinished.status };

  const old = await open("old-cli", { FAKE_VERSION: "1.4.5" });
  old.client.start();
  const oldThread = await startThread(old.client, { cwd: root });
  const oldTurn = await startTurn(old.client, oldThread, old.log, "work");
  const beforeOld = (await prompts(old.log)).length;
  const oldRefused = await refusal(steer(old.client, oldThread, oldTurn.id, "steer"));
  assert.equal((await prompts(old.log)).length, beforeOld);
  await runCauseEffect(old.client.request("turn/interrupt", { threadId: oldThread }, (value) => value));
  const oldFinished = await oldTurn.done;
  report.oldCli = {
    refused: oldRefused,
    prompts: (await prompts(old.log)).length - beforeOld,
    status: oldFinished.status,
  };

  const held = await open("held-work", {});
  held.client.start();
  const daemonThread = await startThread(held.client, { cwd: root });
  const daemon = await (await startTurn(held.client, daemonThread, held.log, "daemon")).done;
  assert.equal(daemon.status, "completed");
  const releasable = held.client.canReleaseProcess?.();
  assert.equal(releasable, false, "Running work must keep the provider process.");
  const laterPids: number[] = [];
  const laterThreads: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const thread = await startThread(held.client, { cwd: root });
    laterThreads.push(thread);
    assert.equal((await (await startTurn(held.client, thread, held.log, "hello")).done).status, "completed");
    laterPids.push(await sessionPid(held.log, "hello", index));
  }
  await Promise.all(laterPids.slice(0, 2).map((pid) => waitForExit(pid)));
  const daemonRuns = isRunning(await sessionPid(held.log, "daemon", 0));
  assert.ok(daemonRuns, "The idle limit closed the session whose daemon command runs.");
  const closedSessions = laterPids.filter((pid) => !isRunning(pid)).length;
  report.heldWork = { status: daemon.status, releasable, closedSessions, daemonRuns };

  const notedPrompt = async (thread: string, text: string) => {
    assert.equal((await (await startTurn(held.client, thread, held.log, text)).done).status, "completed");
    const prompt = (await prompts(held.log)).findLast((entry) => entry.text?.endsWith(text));
    return prompt?.text?.includes("<openbot_session_reload>") === true;
  };
  const [stoppedThread] = laterThreads;
  if (!stoppedThread) throw new Error("The later sessions did not start.");
  report.reloadNote = {
    afterIdleStop: await notedPrompt(stoppedThread, "again after the idle stop"),
    secondPrompt: await notedPrompt(stoppedThread, "once more on the same process"),
    heldSession: await notedPrompt(daemonThread, "again on the held session"),
  };
  assert.ok(report.reloadNote.afterIdleStop, "A session that OpenBot stopped as idle must get the reload note.");
  assert.ok(!report.reloadNote.secondPrompt, "The reload note must come only once.");
  assert.ok(!report.reloadNote.heldSession, "A session whose work held its process must not get the reload note.");

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
