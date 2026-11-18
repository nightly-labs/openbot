// Runs the real `acp` provider driver over fake custom agents (`provider-fakes/agents/custom-agent-steer.ts`)
// to check that a message sent while a custom agent works goes into its running turn (#4977).
// The agent reports the `_session/steering` request in `initialize`, as OpenCode 2.3.0 does (#8231).
// Cases: the model catalog marks each model of an agent that steers and only those; a steer goes into
// the running turn; a steer that the agent answers with `promptRequired` is refused; an agent without
// the request refuses the steer and does not get the request. A refused steer must not stop the running
// turn, so the message can wait in the queue.
// `bun run test:custom-agent-steer`. Writes .openbot-build/custom-agent-steer-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { agentSteersTurns } from "@openbot/contracts/agent-providers";
import type { AgentModelOption } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { ModelCatalog } from "../src/backend/agent/model-catalog";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getRecord, getString, isRecord } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { CustomAgentStore } from "../src/main/custom-agent-store";
import { installFakeAgent, readJsonl, startThread, stopClients, xorCipher } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/custom-agent-steer-e2e");
const TURN_TIMEOUT_MS = 20_000;
type AgentId = "steering" | "idle" | "plain";
/** Each fake agent and its env: one steers, one answers `promptRequired`, one has no request. */
const AGENTS: readonly { id: AgentId; env: { name: string; value: string }[] }[] = [
  { id: "steering", env: [] },
  { id: "idle", env: [{ name: "FAKE_NEVER_RUNNING", value: "1" }] },
  { id: "plain", env: [{ name: "FAKE_NO_STEERING", value: "1" }] },
];

interface LogEntry {
  event: string;
  sessionId?: string;
  text?: string;
  content?: string[];
}

interface Report {
  passed: boolean;
  models?: { id: string; steersTurns: boolean; agentSteersTurns: boolean }[];
  steered?: { turnId: string; reply: string; status: string | null; steering: LogEntry };
  promptRequired?: { refused: string; status: string | null; reply: string; cancelSent: boolean };
  withoutMethod?: { refused: string; requests: number; cancelSent: boolean };
  failure?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-custom-agent-steer-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];
const logOf = (agent: AgentId) => join(root, `${agent}.jsonl`);

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

const requests = async (log: string) =>
  (await readJsonl<LogEntry>(log)).filter((entry) => entry.event === "steering").length;
const cancelled = async (log: string) => (await readJsonl<LogEntry>(log)).some((entry) => entry.event === "cancel");

try {
  const executable = join(root, "bin", "fake-acp-agent");
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  await installFakeAgent(executable, "custom-agent-steer");

  const store = new CustomAgentStore({ path: join(root, "custom-agents.json"), cipher: xorCipher });
  await runCauseEffect(store.load());
  for (const { id, env } of AGENTS) {
    await runCauseEffect(
      store.save({
        id,
        name: id,
        command: executable,
        args: [],
        env: [{ name: "FAKE_LOG", value: logOf(id) }, ...env],
        usagePrompt: null,
      }),
    );
  }

  const driver = requireProviderDriver("acp");
  const cli = await runCauseEffect(driver.resolveCli());
  const client = driver.createClient(
    cli,
    20_000,
    { apiKey: () => null, customProviders: () => [], mcpServers: () => [], customAgents: () => store.configs() },
    undefined,
  );
  clients.push(client);
  client.start();

  // The catalog marks the models of the agents with the request, and the composer and the host read it.
  const catalog = new ModelCatalog({
    client: () => client,
    isSignedOut: () => false,
    requestTimeoutMs: 20_000,
    recordProviderError: () => undefined,
    startSettingsChanged: () => Effect.void,
  });
  const { models } = await runCauseEffect(catalog.read(client, driver.catalog, 20_000));
  const modelOf = (agent: AgentId): AgentModelOption => {
    const model = models.find((item) => item.id.startsWith(`${agent}/`));
    assert.ok(model, `The catalog must list a model of the ${agent} agent.`);
    return model;
  };
  const steers = (agent: AgentId) => agentSteersTurns({ provider: "acp", model: modelOf(agent).id }, models);
  report.models = models.map((model) => ({
    id: model.id,
    steersTurns: model.steersTurns === true,
    agentSteersTurns: agentSteersTurns({ provider: "acp", model: model.id }, models),
  }));
  assert.equal(steers("steering"), true, "The model of an agent with the request must steer.");
  assert.equal(steers("idle"), true, "The model of an agent with the request must steer.");
  assert.equal(steers("plain"), false, "The model of an agent without the request must not steer.");
  // The agent process reports steering, so a saved model that its list no longer has still steers.
  assert.equal(
    agentSteersTurns({ provider: "acp", model: "steering/removed" }, models),
    true,
    "Each model of an agent with the request must steer.",
  );
  assert.equal(
    agentSteersTurns({ provider: "acp", model: "unknown/default" }, models),
    false,
    "A model of an agent that the catalog does not list must not steer.",
  );

  const open = (agent: AgentId) =>
    startThread(client, { model: modelOf(agent).id, cwd: workspace, runtimeWorkspaceRoots: [workspace] });

  // A steer goes into the running turn and does not start or stop a turn.
  {
    const log = logOf("steering");
    const thread = await open("steering");
    const turn = await startWork(client, thread, log);
    const answer = await steer(client, thread, turn.id, "use the other branch");
    assert.equal(answer, turn.id);
    const finished = await turn.done;
    const entries = await readJsonl<LogEntry>(log);
    const steering = entries.find((entry) => entry.event === "steering");
    assert.ok(steering, "The steer must send _session/steering.");
    assert.ok(steering.sessionId && thread.endsWith(`:${steering.sessionId}`), "The steer must name the session.");
    assert.equal(steering.text, "use the other branch");
    assert.deepEqual(steering.content, ["text"]);
    assert.equal(finished.status, "completed");
    assert.match(finished.reply, /steered: use the other branch/u);
    assert.equal(
      entries.filter((entry) => entry.event === "prompt" && entry.sessionId === steering.sessionId).length,
      1,
      "The steer must not send a prompt.",
    );
    assert.equal(await cancelled(log), false, "The steer must not cancel the turn.");
    report.steered = { turnId: turn.id, reply: finished.reply, status: finished.status, steering };
  }

  // The agent ran no turn when the steer arrived. It did not keep the message, so the steer is refused.
  {
    const log = logOf("idle");
    const thread = await open("idle");
    const turn = await startWork(client, thread, log);
    const refused = await refusal(steer(client, thread, turn.id, "steer"));
    const finished = await turn.done;
    const cancelSent = await cancelled(log);
    assert.equal(finished.status, "completed");
    assert.match(finished.reply, /done without steering/u);
    assert.equal(cancelSent, false);
    report.promptRequired = { refused, status: finished.status, reply: finished.reply, cancelSent };
  }

  // An agent that does not report the request does not get it. The turn goes on.
  {
    const log = logOf("plain");
    const thread = await open("plain");
    const turn = await startWork(client, thread, log);
    const refused = await refusal(steer(client, thread, turn.id, "steer"));
    const cancelSent = await cancelled(log);
    assert.equal(await requests(log), 0, "An agent without the request must not get it.");
    assert.equal(cancelSent, false);
    report.withoutMethod = { refused, requests: await requests(log), cancelSent };
    await runCauseEffect(client.request("turn/interrupt", { threadId: thread, turnId: turn.id }, (value) => value));
    await turn.done;
  }

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
