// Runs the real `opencode` provider driver over a fake `opencode acp` (`provider-fakes/agents/opencode-steer.ts`)
// to check that a steered message goes into the running turn through `_session/steering` (#8231).
// Cases: a steer with text and an image, a steer for a turn that is not the running one, a steer
// after the turn ended, a steer that OpenCode answers with `promptRequired`, and an OpenCode without
// the request. Each refused steer must not stop the running turn, so the message can wait in the queue,
// and an OpenCode without the request must not get the request at all.
// `bun run test:opencode-steer`. Writes .openbot-build/opencode-steer-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getRecord, getString, isRecord } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-steer-e2e");
const TURN_TIMEOUT_MS = 20_000;
/** A 1x1 transparent PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

interface LogEntry {
  event: string;
  sessionId?: string;
  text?: string;
  content?: string[];
}

interface Report {
  passed: boolean;
  steered?: { turnId: string; reply: string; status: string | null; steering: LogEntry };
  wrongTurn?: { refused: string; requests: number };
  afterTurn?: { refused: string; requests: number };
  promptRequired?: { refused: string; status: string | null; reply: string; cancelSent: boolean };
  withoutMethod?: { refused: string; requests: number; cancelSent: boolean };
  failure?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-opencode-steer-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];

async function open(
  name: string,
  env: Readonly<Record<string, string>>,
  version = "2.3.0",
): Promise<{ client: AgentClient; log: string }> {
  const executable = join(root, name, "bin", "opencode");
  const log = join(root, name, "agent.jsonl");
  await installFakeAgent(executable, "opencode-steer", { FAKE_LOG: log, ...env });
  const client = requireProviderDriver("opencode").createClient(
    { executable, version, source: "managed" },
    10_000,
    NO_PROVIDER_CREDENTIALS,
  );
  clients.push(client);
  client.start();
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

interface RunningTurn {
  id: string;
  /** The reply text and the `turn/completed` status. */
  done: Promise<{ reply: string; status: string | null }>;
}

/** Starts a `work` turn, which stays open with one tool call until the agent gets a steer. */
async function startWork(client: AgentClient, thread: string, log: string): Promise<RunningTurn> {
  let reply = "";
  let listener: ((notification: AppServerNotification) => void) | undefined;
  const done = new Promise<{ reply: string; status: string | null }>((finish, fail) => {
    const timer = setTimeout(() => fail(new Error("The turn did not complete.")), TURN_TIMEOUT_MS);
    listener = (notification) => {
      if (getString(notification.params, "threadId") !== thread) return;
      if (notification.method === "item/completed" && isRecord(notification.params))
        reply += getString(notification.params.item, "text") ?? "";
      if (notification.method === "turn/completed") {
        clearTimeout(timer);
        if (listener) client.off("notification", listener);
        finish({ reply, status: getString(getRecord(notification.params, "turn"), "status") });
      }
    };
    client.on("notification", listener);
  });
  done.catch(() => undefined);
  const response = await runCauseEffect(
    client.request(
      "turn/start",
      { threadId: thread, input: [{ type: "text", text: "work", text_elements: [] }] },
      (value) => value,
    ),
  );
  const id = getString(getRecord(response, "turn"), "id");
  if (!id) throw new Error("turn/start answers no turn id.");
  await waitForEntry(log, (entry) => entry.event === "prompt" && entry.text === "work");
  return { id, done };
}

/** Steers the turn with this input. Answers the turn id that the client reports. */
function steer(
  client: AgentClient,
  thread: string,
  turnId: string,
  input: readonly Record<string, string | readonly never[]>[],
): Promise<string | null> {
  return runCauseEffect(
    client.request(
      "turn/steer",
      { threadId: thread, expectedTurnId: turnId, clientUserMessageId: "delivery-1", input },
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

const requests = async (log: string) =>
  (await readJsonl<LogEntry>(log)).filter((entry) => entry.event === "steering").length;

/** Stops the turn, for an agent that keeps it open, and waits for its end. */
async function stop(client: AgentClient, thread: string, turn: RunningTurn): Promise<void> {
  await runCauseEffect(client.request("turn/interrupt", { threadId: thread, turnId: turn.id }, (value) => value));
  await turn.done;
}

try {
  const image = join(root, "screen.png");
  await writeFile(image, PNG);

  const { client, log } = await open("native", {});
  const thread = await startThread(client, { cwd: root });

  // A steer goes into the running turn and does not start or stop a turn.
  const turn = await startWork(client, thread, log);
  const answer = await steer(client, thread, turn.id, [
    { type: "text", text: "use the other branch", text_elements: [] },
    { type: "localImage", path: image },
  ]);
  assert.equal(answer, turn.id);
  const finished = await turn.done;
  const entries = await readJsonl<LogEntry>(log);
  const steering = entries.find((entry) => entry.event === "steering");
  assert.ok(steering, "The steer must send _session/steering.");
  assert.equal(steering.sessionId, thread);
  assert.equal(steering.text, "use the other branch");
  assert.deepEqual(steering.content, ["text", "image"]);
  assert.equal(finished.status, "completed");
  assert.match(finished.reply, /steered: use the other branch/u);
  assert.equal(entries.filter((entry) => entry.event === "prompt").length, 1, "The steer must not send a prompt.");
  assert.ok(!entries.some((entry) => entry.event === "cancel"), "The steer must not cancel the turn.");
  report.steered = { turnId: turn.id, reply: finished.reply, status: finished.status, steering };

  // A steer for a turn that is not the running one is refused before it reaches the agent.
  const second = await startWork(client, thread, log);
  const before = await requests(log);
  const wrongTurn = await refusal(steer(client, thread, "another-turn", [{ type: "text", text: "late" }]));
  assert.equal(await requests(log), before);
  report.wrongTurn = { refused: wrongTurn, requests: (await requests(log)) - before };
  await steer(client, thread, second.id, [{ type: "text", text: "end" }]);
  await second.done;

  // After the turn ended, the message waits for a turn of its own.
  const ended = await requests(log);
  const afterTurn = await refusal(steer(client, thread, second.id, [{ type: "text", text: "too late" }]));
  assert.equal(await requests(log), ended);
  report.afterTurn = { refused: afterTurn, requests: (await requests(log)) - ended };

  // OpenCode ran no turn when the steer arrived. It did not keep the message, so the steer is refused.
  const idle = await open("prompt-required", { FAKE_NEVER_RUNNING: "1" });
  const idleThread = await startThread(idle.client, { cwd: root });
  const idleTurn = await startWork(idle.client, idleThread, idle.log);
  const promptRequired = await refusal(steer(idle.client, idleThread, idleTurn.id, [{ type: "text", text: "steer" }]));
  const idleFinished = await idleTurn.done;
  const idleCancel = (await readJsonl<LogEntry>(idle.log)).some((entry) => entry.event === "cancel");
  assert.equal(idleFinished.status, "completed");
  assert.match(idleFinished.reply, /done without steering/u);
  assert.equal(idleCancel, false);
  report.promptRequired = {
    refused: promptRequired,
    status: idleFinished.status,
    reply: idleFinished.reply,
    cancelSent: idleCancel,
  };

  // An OpenCode before the request does not report it, and does not get it. The turn goes on.
  const old = await open("without-method", { FAKE_NO_STEERING: "1" }, "2.2.6");
  const oldThread = await startThread(old.client, { cwd: root });
  const oldTurn = await startWork(old.client, oldThread, old.log);
  const withoutMethod = await refusal(steer(old.client, oldThread, oldTurn.id, [{ type: "text", text: "steer" }]));
  const oldEntries = await readJsonl<LogEntry>(old.log);
  const cancelSent = oldEntries.some((entry) => entry.event === "cancel");
  assert.equal(await requests(old.log), 0, "An OpenCode without the request must not get it.");
  assert.equal(cancelSent, false);
  report.withoutMethod = { refused: withoutMethod, requests: await requests(old.log), cancelSent };
  await stop(old.client, oldThread, oldTurn);

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
