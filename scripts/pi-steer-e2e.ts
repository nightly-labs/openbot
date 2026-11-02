// Runs the real `deepseek` provider driver, which is the Pi client, over a fake Pi
// (`provider-fakes/agents/pi-steer.ts`) to check that a steer goes into the running turn through
// Pi's `steer` command (#3206). Cases: a steer, a steer that Pi refuses, a steer for a turn that is
// not the running one, and a steer after the turn ended. A refused steer must fail alone: the running
// turn goes on, so that the message can wait in the queue. Before the fix, Pi's refusal failed the
// running turn while Pi went on working.
// `bun run test:pi-steer`. Writes .openbot-build/pi-steer-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getRecord, getString, isRecord } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-steer-e2e");
const TURN_TIMEOUT_MS = 20_000;

interface LogEntry {
  event: string;
  text?: string;
  streamingBehavior?: string;
  images?: number;
  /** The queued steers that `clear_queue` removed, joined by ", ". */
  steering?: string;
}

interface Report {
  passed: boolean;
  steered?: { turnId: string; reply: string; status: string | null; steer: LogEntry };
  refused?: { refused: string; completedBeforeNextSteer: boolean; status: string | null; reply: string };
  timedOut?: { refused: string; queueCleared: boolean; status: string | null; reply: string };
  wrongTurn?: { refused: string; steers: number };
  afterTurn?: { refused: string; steers: number; prompts: number };
  failure?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-pi-steer-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];

async function open(): Promise<{ client: AgentClient; log: string }> {
  const executable = join(root, "bin", "pi");
  const log = join(root, "agent.jsonl");
  await installFakeAgent(executable, "pi-steer", { FAKE_LOG: log, FAKE_DIR: root });
  const client = requireProviderDriver("deepseek").createClient(
    { executable, version: "1.4.0", source: "managed" },
    // Short, so that the steer that Pi does not answer times out soon. The fake answers the rest at once.
    2_000,
    { apiKey: () => null, customProviders: () => [], mcpServers: () => [] },
  );
  clients.push(client);
  client.start();
  return { client, log };
}

const count = async (log: string, event: string) =>
  (await readJsonl<LogEntry>(log)).filter((entry) => entry.event === event).length;

/** Waits until the fake has logged `total` entries of this event, or fails after 10 seconds. */
async function waitForCount(log: string, event: string, total: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while ((await count(log, event)) < total) {
    if (Date.now() > deadline) throw new Error(`The fake Pi did not log ${event}.`);
    await new Promise((settle) => setTimeout(settle, 25));
  }
}

interface RunningTurn {
  id: string;
  /** True once `turn/completed` arrived. */
  completed: () => boolean;
  /** The reply text, the `turn/completed` status and the turn's error message. */
  done: Promise<{ reply: string; status: string | null; error: string | null }>;
}

/** Starts a `work` turn, which stays open until the fake Pi gets a steer. */
async function startWork(client: AgentClient, thread: string, log: string): Promise<RunningTurn> {
  let reply = "";
  let error: string | null = null;
  let completed = false;
  let listener: ((notification: AppServerNotification) => void) | undefined;
  const done = new Promise<{ reply: string; status: string | null; error: string | null }>((finish, fail) => {
    const timer = setTimeout(() => fail(new Error("The turn did not complete.")), TURN_TIMEOUT_MS);
    listener = (notification) => {
      if (getString(notification.params, "threadId") !== thread) return;
      if (notification.method === "item/completed" && isRecord(notification.params))
        reply += getString(notification.params.item, "text") ?? "";
      if (notification.method === "error")
        error = getString(getRecord(notification.params, "error"), "message") ?? "unknown";
      if (notification.method === "turn/completed") {
        completed = true;
        clearTimeout(timer);
        if (listener) client.off("notification", listener);
        finish({ reply, status: getString(getRecord(notification.params, "turn"), "status"), error });
      }
    };
    client.on("notification", listener);
  });
  done.catch(() => undefined);
  const prompts = await count(log, "prompt");
  const response = await runCauseEffect(
    client.request(
      "turn/start",
      { threadId: thread, input: [{ type: "text", text: "work", text_elements: [] }] },
      (value) => value,
    ),
  );
  const id = getString(getRecord(response, "turn"), "id");
  if (!id) throw new Error("turn/start answers no turn id.");
  await waitForCount(log, "prompt", prompts + 1);
  return { id, completed: () => completed, done };
}

/** Steers the turn with this text. Answers the turn id that the client reports. */
function steer(client: AgentClient, thread: string, turnId: string, text: string): Promise<string | null> {
  return runCauseEffect(
    client.request(
      "turn/steer",
      {
        threadId: thread,
        expectedTurnId: turnId,
        clientUserMessageId: "delivery-1",
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
  const { client, log } = await open();
  const thread = await startThread(client, { cwd: root });

  // A steer goes into the running turn through Pi's `steer` command, not a second `prompt`.
  const turn = await startWork(client, thread, log);
  const answer = await steer(client, thread, turn.id, "use the other branch");
  assert.equal(answer, turn.id);
  const finished = await turn.done;
  const entries = await readJsonl<LogEntry>(log);
  const sent = entries.find((entry) => entry.event === "steer");
  assert.ok(sent, "The steer must send Pi's steer command.");
  assert.equal(sent.text, "use the other branch");
  assert.equal(finished.status, "completed");
  assert.equal(finished.error, null);
  assert.match(finished.reply, /steered: use the other branch/u);
  assert.equal(await count(log, "prompt"), 1, "The steer must not send a prompt.");
  report.steered = { turnId: turn.id, reply: finished.reply, status: finished.status, steer: sent };

  // Pi refuses a steer. Only the steer fails: the turn goes on and takes the next steer.
  const second = await startWork(client, thread, log);
  const refused = await refusal(steer(client, thread, second.id, "refuse this"));
  assert.match(refused, /Pi refused the steer/u);
  const completedBeforeNextSteer = second.completed();
  assert.equal(completedBeforeNextSteer, false, "A refused steer must not end the running turn.");
  assert.equal(await steer(client, thread, second.id, "go on"), second.id);
  const secondFinished = await second.done;
  assert.equal(secondFinished.status, "completed");
  assert.equal(secondFinished.error, null);
  assert.match(secondFinished.reply, /steered: go on/u);
  report.refused = {
    refused,
    completedBeforeNextSteer,
    status: secondFinished.status,
    reply: secondFinished.reply,
  };

  // Pi does not answer a steer in time, but queues it. The client removes it from Pi's queue, as the
  // message also waits in OpenBot's queue. An earlier steer that Pi holds stays. The turn goes on.
  const slow = await startWork(client, thread, log);
  const cleared = await count(log, "clear_queue");
  assert.equal(cleared, 0, "A refused steer queues nothing, so it must not clear Pi's queue.");
  assert.equal(await steer(client, thread, slow.id, "hold this"), slow.id);
  const steersBefore = await count(log, "steer");
  const timedOut = await refusal(steer(client, thread, slow.id, "slow steer"));
  await waitForCount(log, "clear_queue", cleared + 1);
  // The client sends the held steer again after the clear.
  await waitForCount(log, "steer", steersBefore + 2);
  const entries2 = await readJsonl<LogEntry>(log);
  assert.equal(entries2.find((entry) => entry.event === "clear_queue")?.steering, "hold this, slow steer");
  assert.equal(entries2.filter((entry) => entry.event === "steer").at(-1)?.text, "hold this");
  assert.equal(slow.completed(), false, "A timed-out steer must not end the running turn.");
  assert.equal(await steer(client, thread, slow.id, "after the timeout"), slow.id);
  const slowFinished = await slow.done;
  assert.equal(slowFinished.status, "completed");
  assert.match(slowFinished.reply, /steered: hold this, after the timeout/u);
  report.timedOut = { refused: timedOut, queueCleared: true, status: slowFinished.status, reply: slowFinished.reply };

  // A steer for a turn that is not the running one is refused before it reaches Pi.
  const third = await startWork(client, thread, log);
  const before = await count(log, "steer");
  const wrongTurn = await refusal(steer(client, thread, "another-turn", "late"));
  assert.equal(await count(log, "steer"), before);
  report.wrongTurn = { refused: wrongTurn, steers: (await count(log, "steer")) - before };
  await steer(client, thread, third.id, "end");
  await third.done;

  // After the turn ended, Pi would start the message as a run of its own.
  const steers = await count(log, "steer");
  const prompts = await count(log, "prompt");
  const afterTurn = await refusal(steer(client, thread, third.id, "too late"));
  assert.equal(await count(log, "steer"), steers);
  assert.equal(await count(log, "prompt"), prompts);
  report.afterTurn = {
    refused: afterTurn,
    steers: (await count(log, "steer")) - steers,
    prompts: (await count(log, "prompt")) - prompts,
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
