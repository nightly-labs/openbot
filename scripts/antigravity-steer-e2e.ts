// Runs the real `antigravity` provider driver over a fake `agy acp` (`provider-fakes/agents/antigravity-steer.ts`)
// to check that a steered message goes into the running turn through a second `session/prompt`.
// `agy acp` 1.5.0 and later answers the open prompt with `end_turn` at once and goes on under the new one.
// Cases: one steer, two steers in a row, a steer for a turn that is not the running one, a steer after
// the turn ended, a steer while a permission card is open, and a CLI older than 1.5.0. Each refused
// steer must send nothing to the agent and must not stop the running turn, so the message can wait in
// the queue. `bun run test:antigravity-steer`. Writes .openbot-build/antigravity-steer-e2e/report.json.
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
  /** The `turn/started` notifications of the thread while the turn ran. */
  started: number;
  /** The `openbot/usage` notifications of the turn. */
  usage: number;
}

interface Report {
  passed: boolean;
  steered?: Finished & { turnId: string; prompts: LogEntry[]; cancelSent: boolean };
  twice?: Finished & { prompts: LogEntry[] };
  wrongTurn?: { refused: string; prompts: number };
  afterTurn?: { refused: string; prompts: number };
  waitingOnUser?: { refused: string; prompts: number; reply: string; status: string | null };
  oldCli?: { refused: string; prompts: number; status: string | null };
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

/** Waits until the fake logs an entry that matches, or fails after `timeoutMs`. */
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

/** Starts a turn with this text. A `work` turn stays open with one tool call until a steer ends it. */
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

/** Steers the turn with this text. Answers the turn id that the client reports. */
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

async function refusal(operation: Promise<string | null>): Promise<string> {
  const outcome = await operation.then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  assert.ok(outcome !== null, "The steer must be refused.");
  return outcome;
}

try {
  const { client, log } = await open("native", {});
  /** The permission request that the test holds open, and how to answer it. */
  let heldApproval: (() => void) | undefined;
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
    approvalAsked();
  });
  client.start();
  const thread = await startThread(client, { cwd: root });

  // A steer goes into the running turn: one turn, no stop, a usage report for each prompt.
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

  // Two steers in a row: the turn ends only with the reply of the last prompt.
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

  // A steer for a turn that is not the running one is refused before it reaches the agent.
  const third = await startTurn(client, thread, log, "work");
  const beforeWrong = (await prompts(log)).length;
  const wrongTurn = await refusal(steer(client, thread, "another-turn", "late"));
  assert.equal((await prompts(log)).length, beforeWrong);
  report.wrongTurn = { refused: wrongTurn, prompts: (await prompts(log)).length - beforeWrong };
  await steer(client, thread, third.id, "end");
  await third.done;

  // After the turn ended, a second prompt would start a turn of its own.
  const beforeAfter = (await prompts(log)).length;
  const afterTurn = await refusal(steer(client, thread, third.id, "too late"));
  assert.equal((await prompts(log)).length, beforeAfter);
  report.afterTurn = { refused: afterTurn, prompts: (await prompts(log)).length - beforeAfter };

  // A new prompt would close an open permission card, so the steer waits in the queue.
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

  // An `agy` older than 1.5.0 cancels the open prompt on a second one, so the steer is refused.
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
