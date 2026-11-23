import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { agentSteersTurns } from "@openbot/contracts/agent-providers";
import { Effect } from "effect";
import { ModelCatalog } from "../src/backend/agent/model-catalog";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getRecord, getString, isRecord } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-steer-e2e");
const TURN_TIMEOUT_MS = 20_000;
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

interface CatalogSteering {
  models: { id: string; steersTurns: boolean }[];
  listedModel: boolean;
  unlistedModel: boolean;
}

interface Report {
  passed: boolean;
  catalog?: { withMethod: CatalogSteering; withoutMethod: CatalogSteering };
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

async function waitForEntry(log: string, match: (entry: LogEntry) => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await readJsonl<LogEntry>(log)).some(match)) {
    if (Date.now() > deadline) throw new Error("The fake agent did not log the expected request.");
    await new Promise((settle) => setTimeout(settle, 25));
  }
}

interface RunningTurn {
  id: string;
  done: Promise<{ reply: string; status: string | null }>;
}

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

async function catalogSteering(client: AgentClient): Promise<CatalogSteering> {
  const catalog = new ModelCatalog({
    client: () => client,
    isSignedOut: () => false,
    requestTimeoutMs: 10_000,
    recordProviderError: () => undefined,
    startSettingsChanged: () => Effect.void,
  });
  const { models } = await runCauseEffect(catalog.read(client, requireProviderDriver("opencode").catalog, 10_000));
  assert.ok(models.length > 0, "The catalog must list an OpenCode model.");
  return {
    models: models.map((model) => ({ id: model.id, steersTurns: model.steersTurns === true })),
    listedModel: agentSteersTurns({ provider: "opencode", model: models[0]?.id ?? "" }, models),
    unlistedModel: agentSteersTurns({ provider: "opencode", model: "openai/not-listed" }, models),
  };
}

const requests = async (log: string) =>
  (await readJsonl<LogEntry>(log)).filter((entry) => entry.event === "steering").length;

async function stop(client: AgentClient, thread: string, turn: RunningTurn): Promise<void> {
  await runCauseEffect(client.request("turn/interrupt", { threadId: thread, turnId: turn.id }, (value) => value));
  await turn.done;
}

try {
  const image = join(root, "screen.png");
  await writeFile(image, PNG);

  const { client, log } = await open("native", {});
  const withMethod = await catalogSteering(client);
  assert.equal(withMethod.listedModel, true, "An OpenCode with the request must steer.");
  assert.equal(withMethod.unlistedModel, true, "Each model of an OpenCode with the request must steer.");
  const thread = await startThread(client, { cwd: root });

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

  const second = await startWork(client, thread, log);
  const before = await requests(log);
  const wrongTurn = await refusal(steer(client, thread, "another-turn", [{ type: "text", text: "late" }]));
  assert.equal(await requests(log), before);
  report.wrongTurn = { refused: wrongTurn, requests: (await requests(log)) - before };
  await steer(client, thread, second.id, [{ type: "text", text: "end" }]);
  await second.done;

  const ended = await requests(log);
  const afterTurn = await refusal(steer(client, thread, second.id, [{ type: "text", text: "too late" }]));
  assert.equal(await requests(log), ended);
  report.afterTurn = { refused: afterTurn, requests: (await requests(log)) - ended };

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

  const old = await open("without-method", { FAKE_NO_STEERING: "1" }, "2.2.6");
  const withoutMethod = await catalogSteering(old.client);
  assert.equal(withoutMethod.listedModel, false, "An OpenCode without the request must not steer.");
  assert.equal(withoutMethod.unlistedModel, false, "An OpenCode without the request must not steer.");
  report.catalog = { withMethod, withoutMethod };
  const oldThread = await startThread(old.client, { cwd: root });
  const oldTurn = await startWork(old.client, oldThread, old.log);
  const oldRefusal = await refusal(steer(old.client, oldThread, oldTurn.id, [{ type: "text", text: "steer" }]));
  const oldEntries = await readJsonl<LogEntry>(old.log);
  const cancelSent = oldEntries.some((entry) => entry.event === "cancel");
  assert.equal(await requests(old.log), 0, "An OpenCode without the request must not get it.");
  assert.equal(cancelSent, false);
  report.withoutMethod = { refused: oldRefusal, requests: await requests(old.log), cancelSent };
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
