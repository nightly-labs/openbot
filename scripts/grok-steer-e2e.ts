// Runs the real `grok` provider driver over a fake Grok agent (`provider-fakes/agents/grok-steer.ts`)
// to check that a steered message goes into the running turn through `x.ai/interject` (#2512).
// Cases: a steer with text and an image, a steer for a turn that is not the running one, a steer
// after the turn ended, and a Grok without the method. Each refused steer must send nothing to the
// agent and must not stop the running turn, so the message can wait in the queue.
// `bun run test:grok-steer`. Writes .openbot-build/grok-steer-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getRecord, getString, isRecord } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/grok-steer-e2e");
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
  interjectionId?: string;
  content?: string[];
  contentText?: string;
}

interface Report {
  passed: boolean;
  steered?: { turnId: string; reply: string; status: string | null; interject: LogEntry };
  wrongTurn?: { refused: string; interjects: number };
  afterTurn?: { refused: string; interjects: number };
  withoutMethod?: { refused: string; status: string | null; reply: string; cancelSent: boolean };
  failure?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-grok-steer-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];

async function open(
  name: string,
  env: Readonly<Record<string, string>>,
): Promise<{ client: AgentClient; log: string }> {
  const executable = join(root, name, "bin", "grok");
  const log = join(root, name, "agent.jsonl");
  await installFakeAgent(executable, "grok-steer", { FAKE_LOG: log, ...env });
  const client = requireProviderDriver("grok").createClient(
    { executable, version: "1.0.70", source: "managed" },
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

/** Starts a `work` turn, which stays open with one tool call until the agent gets an interjection. */
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

const interjects = async (log: string) =>
  (await readJsonl<LogEntry>(log)).filter((entry) => entry.event === "interject").length;

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
  const interject = entries.find((entry) => entry.event === "interject");
  assert.ok(interject, "The steer must send x.ai/interject.");
  assert.equal(interject.sessionId, thread);
  assert.equal(interject.interjectionId, "delivery-1");
  assert.equal(interject.text, "use the other branch");
  assert.equal(interject.contentText, "use the other branch");
  assert.deepEqual(interject.content, ["text", "image:image/png"]);
  assert.equal(finished.status, "completed");
  assert.match(finished.reply, /steered: use the other branch/u);
  assert.equal(entries.filter((entry) => entry.event === "prompt").length, 1, "The steer must not send a prompt.");
  assert.ok(!entries.some((entry) => entry.event === "cancel"), "The steer must not cancel the turn.");
  report.steered = { turnId: turn.id, reply: finished.reply, status: finished.status, interject };

  // A steer for a turn that is not the running one is refused before it reaches the agent.
  const second = await startWork(client, thread, log);
  const before = await interjects(log);
  const wrongTurn = await refusal(steer(client, thread, "another-turn", [{ type: "text", text: "late" }]));
  assert.equal(await interjects(log), before);
  report.wrongTurn = { refused: wrongTurn, interjects: (await interjects(log)) - before };
  await steer(client, thread, second.id, [{ type: "text", text: "end" }]);
  await second.done;

  // After the turn ended, Grok would start the message as a turn of its own.
  const ended = await interjects(log);
  const afterTurn = await refusal(steer(client, thread, second.id, [{ type: "text", text: "too late" }]));
  assert.equal(await interjects(log), ended);
  report.afterTurn = { refused: afterTurn, interjects: (await interjects(log)) - ended };

  // A Grok without the method refuses it. The turn goes on, and nothing cancels it.
  const old = await open("without-method", { FAKE_NO_INTERJECT: "1" });
  const oldThread = await startThread(old.client, { cwd: root });
  const oldTurn = await startWork(old.client, oldThread, old.log);
  const withoutMethod = await refusal(steer(old.client, oldThread, oldTurn.id, [{ type: "text", text: "steer" }]));
  const oldFinished = await oldTurn.done;
  const cancelSent = (await readJsonl<LogEntry>(old.log)).some((entry) => entry.event === "cancel");
  assert.equal(oldFinished.status, "completed");
  assert.match(oldFinished.reply, /done without steering/u);
  assert.equal(cancelSent, false);
  report.withoutMethod = { refused: withoutMethod, status: oldFinished.status, reply: oldFinished.reply, cancelSent };

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
