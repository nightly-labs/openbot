// Checks that a Codex turn that ends with no answer and no tool step does not stop a team (#7225).
// Runs the real agent service, tool router and mailbox on a temporary profile with a fake Codex
// app-server. A lead asks two teammates with `send_message`; their results start one lead turn. The
// fake ends a lead turn with only its reasoning when the turn's mode says so. Checks:
//   1. With no backup model, an empty lead turn that started with teammate results runs once more
//      on the same model, and its answer ends the request. No error shows.
//   2. A second empty run of the same results shows a plain error, and the results fail.
//   3. A person's message that gets an empty turn shows the error and does not run again.
//   4. With backup models, an empty lead turn runs again on the backup model, with no error.
//   5. A teammate update that wants no answer can end empty: it completes with no error.
//   6. In a thread, an empty lead turn of a teammate result runs once more too, and its answer ends
//      the thread's turn (#8503). A second empty run shows the error in the thread.
//   7. In a WhatsApp conversation, an empty orchestrator turn of a teammate result runs once more too,
//      and the conversation gets the answer with no "Stopped." end before it (#8573). A second empty
//      run ends the conversation's request as failed.
//   8. In a thread, a person's turn that ran a step and wrote its last words as narration, then an
//      empty answer, shows that narration as its answer (#8837). With narration only before the
//      step, the turn ends as before: completed, once, with the narration still a step. A teammate's
//      such turn still sends the note of its work to the agent that asked (#8214).
// `bun run test:codex-empty-lead-turn`. Writes .openbot-build/codex-empty-lead-turn-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_PROVIDERS,
  type AgentEvent,
  agentProviderDescriptor,
  defaultProviderModel,
  type QueueDelivery,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-empty-lead-turn-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-codex-empty-lead-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");
const countsFile = join(root, "empty-counts.json");
const PRIMARY = defaultProviderModel("codex");
const BACKUP = `${PRIMARY}-backup`;
const NO_ANSWER = sourceText("error.provider.acpNoAnswer", { provider: agentProviderDescriptor("codex").displayName });

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

interface FakeCall {
  tool: "send_message";
  arguments: { recipientAgentIds: string[]; text: string; expectsReply: boolean };
}

const calls = (...items: FakeCall[]) => `<<CALLS${JSON.stringify(items)}CALLS>>`;

/**
 * A Codex app-server with the methods that the service calls. Each turn input decides the turn:
 * - `TEAM-RESULT mode:<mode>`: a lead turn with teammate results. It answers "Team done.", or ends
 *   with only its reasoning: always for `empty-always` and `thread-empty-always`, on the first run
 *   for `empty-once` and `thread-empty-once`, and on the primary model for `empty-on-primary`.
 * - `<<CALLS[...]CALLS>>`: calls the named OpenBot tools one at a time, then answers "Asked.".
 * - `TEAM-QUESTION mode:<mode>`: a teammate answers `TEAM-RESULT mode:<mode>`.
 * - `EMPTY-TURN`: ends with only its reasoning.
 * - `NARRATION-AFTER-STEP` / `NARRATION-BEFORE-STEP`: runs one command, writes narration after or
 *   before it, then sends an empty answer.
 * Each turn is logged with its model and whether it ended empty.
 */
const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const COUNTS = ${JSON.stringify(countsFile)};
const PRIMARY = ${JSON.stringify(PRIMARY)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
const waiting = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
/** Counts the result turns of each mode, across Codex processes. */
const nextRun = (mode) => {
  const counts = existsSync(COUNTS) ? JSON.parse(readFileSync(COUNTS, "utf8")) : {};
  const run = (counts[mode] ?? 0) + 1;
  counts[mode] = run;
  writeFileSync(COUNTS, JSON.stringify(counts));
  return run;
};
const narrate = (threadId, turnId, id, text) => {
  const item = { type: "agentMessage", id, text: "", phase: "commentary" };
  write({ method: "item/started", params: { threadId, turnId, item } });
  write({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: id, delta: text } });
  write({ method: "item/completed", params: { threadId, turnId, item: { ...item, text } } });
};
const finish = (turn) => {
  const { threadId, turnId } = turn;
  if (turn.kind === "narration") {
    const hex = Buffer.from(turnId).toString("hex");
    if (!turn.after) narrate(threadId, turnId, "msg_" + hex + "01", "Let me check the folder.");
    const command = { type: "commandExecution", id: "command-" + turnId, command: "ls", cwd: "/tmp", status: "inProgress" };
    write({ method: "item/started", params: { threadId, turnId, item: command } });
    write({ method: "item/completed", params: { threadId, turnId, item: { ...command, status: "completed", exitCode: 0 } } });
    if (turn.after) narrate(threadId, turnId, "msg_" + hex + "02", "The folder holds two files.");
    const answer = { type: "agentMessage", id: "msg_" + hex + "03", text: "", phase: "final_answer" };
    write({ method: "item/started", params: { threadId, turnId, item: answer } });
    write({ method: "item/completed", params: { threadId, turnId, item: answer } });
    write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
    return;
  }
  if (turn.empty) {
    const item = { type: "reasoning", id: "reasoning-" + turnId, summary: ["Reading the results."], content: [] };
    write({ method: "item/completed", params: { threadId, turnId, item } });
  } else {
    const item = { type: "agentMessage", id: "message-" + turnId, text: turn.reply, phase: "final_answer" };
    write({ method: "item/completed", params: { threadId, turnId, item } });
  }
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
};
const callNext = (turn) => {
  const call = turn.calls.shift();
  if (!call) return setTimeout(() => finish(turn), 20);
  const id = "tool-" + turn.turnId + "-" + turn.calls.length;
  waiting.set(id, turn);
  write({
    id,
    method: "item/tool/call",
    params: { threadId: turn.threadId, turnId: turn.turnId, callId: "call-" + id, namespace: "openbot", tool: call.tool, arguments: call.arguments || {} },
  });
};
const decide = (text, model) => {
  const result = /TEAM-RESULT mode:([a-z-]+)/.exec(text);
  if (result) {
    const mode = result[1];
    const run = nextRun(mode);
    const empty = mode === "empty-always" || mode === "thread-empty-always" || mode === "chat-empty-always" || ((mode === "empty-once" || mode === "thread-empty-once" || mode === "chat-empty-once") && run === 1) || (mode === "empty-on-primary" && model === PRIMARY);
    return { kind: "result", mode, calls: [], empty, reply: "Team done." };
  }
  const named = /<<CALLS([\\s\\S]*?)CALLS>>/.exec(text);
  if (named) return { kind: "calls", calls: JSON.parse(named[1]), empty: false, reply: "Asked." };
  const question = /TEAM-QUESTION mode:([a-z-]+)/.exec(text);
  if (question) return { kind: "question", mode: question[1], calls: [], empty: false, reply: "TEAM-RESULT mode:" + question[1] };
  const narration = /NARRATION-(AFTER|BEFORE)-STEP/.exec(text);
  if (narration) return { kind: "narration", after: narration[1] === "AFTER", calls: [], empty: false, reply: "" };
  if (text.includes("EMPTY-TURN")) return { kind: "empty", calls: [], empty: true, reply: "" };
  return { kind: "chat", calls: [], empty: false, reply: "All good." };
};
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: PRIMARY, displayName: "Primary" }, { model: ${JSON.stringify(BACKUP)}, displayName: "Backup" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + process.pid + "-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + process.pid + "-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      const turn = { threadId: params.threadId, turnId, ...decide(text, params.model) };
      appendFileSync(LOG, JSON.stringify({ turnId, model: params.model, kind: turn.kind, mode: turn.mode ?? null, empty: turn.empty }) + "\\n");
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      return callNext(turn);
    }
    case "turn/interrupt": {
      write({ id: message.id, result: {} });
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } });
    }
    default:
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      if (message.method && message.id !== undefined) answer(message);
      else if (!message.method && waiting.has(message.id)) {
        const turn = waiting.get(message.id);
        waiting.delete(message.id);
        callNext(turn);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface FakeTurn {
  turnId: string;
  model: string;
  kind: "result" | "calls" | "question" | "empty" | "chat" | "narration";
  mode: string | null;
  empty: boolean;
}

const report: {
  primary: string;
  backup: string;
  checks: { name: string; passed: boolean; detail?: unknown }[];
  passed: boolean;
  checkedAt?: string;
  error?: string;
} = { primary: PRIMARY, backup: BACKUP, checks: [], passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

/** Waits for a state of the service, its database or the fake's log. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function fakeTurns(): FakeTurn[] {
  let text = "";
  try {
    text = readFileSync(fakeLog, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const ended = (status: string | undefined) =>
  status === "completed" || status === "failed" || status === "interrupted" || status === "cancelled";

async function check(name: string, run: () => Promise<unknown>) {
  const detail = await run();
  report.checks.push({ name, passed: true, detail });
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
});
const events: AgentEvent[] = [];
agents.on("event", (event) => events.push(event));

function errorsFor(agentId: string, since: number): string[] {
  return events
    .slice(since)
    .flatMap((event) => (event.type === "error" && event.agentId === agentId ? [event.message] : []));
}

async function createAgent(name: string) {
  const agent = await runCauseEffect(
    agents.createAgent({
      name,
      description: "Checks empty Codex turns.",
      avatarSeed: name.toLowerCase().replaceAll(" ", "-"),
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await waitFor(`${name}'s thread`, () => store.list().find((entry) => entry.id === agent.id)?.threadId);
  await waitFor(`${name}'s first turn`, () =>
    agents.listQueue(agent.id).deliveries.every((delivery) => ended(delivery.status)),
  );
  return agent;
}

/** The teammate results that reached this agent after the given deliveries. */
function newResults(agentId: string, before: ReadonlySet<string>): QueueDelivery[] {
  return agents
    .listQueue(agentId)
    .deliveries.filter(
      (delivery) => !before.has(delivery.id) && delivery.sender.kind === "agent" && delivery.replyToMessageId !== null,
    );
}

/**
 * The lead asks both teammates with a request that wants an answer. Returns when the lead's turns
 * for the results have ended: the results ended and no turn of the lead runs.
 */
async function askTeam(leadId: string, teammateIds: string[], mode: string) {
  const before = new Set(agents.listQueue(leadId).deliveries.map((delivery) => delivery.id));
  const since = events.length;
  await runCauseEffect(
    agents.sendMessage({
      agentId: leadId,
      text: `Ask the team. ${calls({
        tool: "send_message",
        arguments: { recipientAgentIds: teammateIds, text: `TEAM-QUESTION mode:${mode}`, expectsReply: true },
      })}`,
    }),
  );
  await waitFor(`the first ${mode} result turn`, () =>
    fakeTurns().some((turn) => turn.kind === "result" && turn.mode === mode),
  );
  const results = await waitFor(`the ${mode} results to end`, () => {
    const found = newResults(leadId, before);
    return found.length === teammateIds.length && found.every((delivery) => ended(delivery.status)) ? found : null;
  });
  await waitFor("the lead to be idle", () => agents.listQueue(leadId).deliveries.every((d) => ended(d.status)));
  return {
    results: results.map((delivery) => ({ id: delivery.id, status: delivery.status })),
    turns: fakeTurns().filter((turn) => turn.kind === "result" && turn.mode === mode),
    errors: errorsFor(leadId, since),
  };
}

/**
 * The lead asks one teammate from a new thread. Returns when the thread's turn of the result ended
 * with an answer or a failure, not with a run again.
 */
async function askTeammateInThread(leadId: string, teammateId: string, mode: string) {
  const since = events.length;
  const task = await runCauseEffect(
    agents.startTask({
      agentId: leadId,
      text: `Ask the team. ${calls({
        tool: "send_message",
        arguments: { recipientAgentIds: [teammateId], text: `TEAM-QUESTION mode:${mode}`, expectsReply: true },
      })}`,
    }),
  );
  const turns = () => fakeTurns().filter((turn) => turn.kind === "result" && turn.mode === mode);
  await waitFor(`the thread's ${mode} result turn to end`, () => {
    const last = turns().at(-1);
    return events
      .slice(since)
      .some(
        (event) =>
          event.type === "thread-turn-completed" &&
          event.taskId === task.id &&
          event.turn.turnId === last?.turnId &&
          (event.turn.status === "completed" || event.turn.status === "failed"),
      );
  });
  const ended = await waitFor("the thread to be idle", () =>
    agents.listTasks(leadId).tasks.find((entry) => entry.id === task.id && entry.state === "idle"),
  );
  const answer = agents
    .readTask(leadId, task.id)
    .messages.findLast((message) => message.author === "assistant" && message.itemType !== "commentary")?.text;
  return { turns: turns(), outcome: ended.outcome, error: ended.error, answer, errors: errorsFor(leadId, since) };
}

/**
 * A WhatsApp message asks the orchestrator, which asks one teammate. Returns when the conversation's
 * request for the teammate's result ended, with each end that the conversation was told of.
 */
async function askTeammateFromWhatsApp(leadId: string, teammateId: string, mode: string) {
  const since = events.length;
  const ends: { status: string; followUp: boolean; answer: string | null }[] = [];
  const stopListening = agents.messaging.onActivity((activity) => {
    if (activity.type === "finished" && activity.link.platformChannelId === `${mode}@s.whatsapp.net`)
      ends.push({ status: activity.status, followUp: activity.followUp, answer: activity.answer });
  });
  try {
    const connection = agents.messaging.store.ensureConnection("whatsapp", "48100000000", "Phone");
    agents.messaging.store.updateConnection(connection.connectionId, { enabled: true });
    const received = await runCauseEffect(
      agents.messaging.receive({
        connectionId: connection.connectionId,
        agentId: leadId,
        platformChannelId: `${mode}@s.whatsapp.net`,
        threadKey: mode,
        isDirect: true,
        title: "Client",
        text: `Ask the team. ${calls({
          tool: "send_message",
          arguments: { recipientAgentIds: [teammateId], text: `TEAM-QUESTION mode:${mode}`, expectsReply: true },
        })}`,
        sourcePaths: [],
        origin: { authorId: "48200000000", authorName: "Client", platformMessageId: `${mode}-message` },
        idempotencyKey: `whatsapp:${mode}`,
      }),
    );
    assert.equal(received.status, "queued");
    const linkId = received.status === "queued" ? received.link.linkId : "";
    await waitFor(`the conversation's ${mode} result request to end`, () =>
      ends.some((end) => end.followUp && end.status !== "interrupted"),
    );
    await waitFor(
      "the conversation's requests to settle",
      () => mailbox.unresolvedMessagingDeliveries(linkId).length === 0,
    );
    return {
      turns: fakeTurns().filter((turn) => turn.kind === "result" && turn.mode === mode),
      ends,
      errors: errorsFor(leadId, since),
    };
  } finally {
    stopListening();
  }
}

async function lastAnswer(agentId: string): Promise<string | undefined> {
  const snapshot = await runCauseEffect(agents.readConversation(agentId));
  return snapshot.messages.findLast((message) => message.author === "assistant" && message.itemType !== "commentary")
    ?.text;
}

try {
  await runCauseEffect(agents.initialize());
  const lead = await createAgent("Lead");
  const alpha = await createAgent("Anchor");
  const beta = await createAgent("Forge");

  await check("an empty lead turn after teammate results runs once more on the same model", async () => {
    const outcome = await askTeam(lead.id, [alpha.id, beta.id], "empty-once");
    assert.equal(outcome.turns.length, 2, `The empty lead turn runs again: ${JSON.stringify(outcome)}`);
    assert.deepEqual(
      outcome.turns.map((turn) => [turn.model, turn.empty]),
      [
        [PRIMARY, true],
        [PRIMARY, false],
      ],
    );
    assert.deepEqual(
      outcome.results.map((result) => result.status),
      ["completed", "completed"],
    );
    assert.deepEqual(outcome.errors, [], "No error shows for the run that answered.");
    assert.equal(await lastAnswer(lead.id), "Team done.");
    return outcome;
  });

  await check("a second empty run of the same results shows a plain error", async () => {
    const outcome = await askTeam(lead.id, [alpha.id, beta.id], "empty-always");
    assert.equal(outcome.turns.length, 2, `The results run again only once: ${JSON.stringify(outcome)}`);
    assert.deepEqual(
      outcome.results.map((result) => result.status),
      ["failed", "failed"],
    );
    assert.deepEqual(outcome.errors, [NO_ANSWER]);
    return outcome;
  });

  await check("a person's message that gets an empty turn shows the error and does not run again", async () => {
    const since = events.length;
    const before = fakeTurns().filter((turn) => turn.kind === "empty").length;
    const receipt = await runCauseEffect(agents.sendMessage({ agentId: lead.id, text: "EMPTY-TURN" }));
    const deliveryId = receipt.deliveries[0]?.id;
    assert.ok(deliveryId);
    const delivery = await waitFor("the message to end", () => {
      const found = mailbox.getDelivery(deliveryId)?.delivery;
      return ended(found?.status) ? found : null;
    });
    assert.equal(delivery.status, "failed");
    assert.equal(fakeTurns().filter((turn) => turn.kind === "empty").length, before + 1);
    assert.deepEqual(errorsFor(lead.id, since), [NO_ANSWER]);
    return { status: delivery.status, error: delivery.error };
  });

  await check("with backup models, an empty lead turn runs again on the backup model", async () => {
    const backupLead = await createAgent("Backup lead");
    await runCauseEffect(
      agents.updateAgent({
        agentId: backupLead.id,
        backupModels: {
          automatic: true,
          order: [
            { provider: "codex", model: PRIMARY },
            { provider: "codex", model: BACKUP },
          ],
        },
      }),
    );
    const outcome = await askTeam(backupLead.id, [alpha.id, beta.id], "empty-on-primary");
    assert.deepEqual(
      outcome.turns.map((turn) => [turn.model, turn.empty]),
      [
        [PRIMARY, true],
        [BACKUP, false],
      ],
      JSON.stringify(outcome),
    );
    assert.deepEqual(
      outcome.results.map((result) => result.status),
      ["completed", "completed"],
    );
    assert.deepEqual(outcome.errors, []);
    assert.equal(await lastAnswer(backupLead.id), "Team done.");
    return outcome;
  });

  await check("a teammate update that wants no answer can end empty", async () => {
    const since = events.length;
    const before = new Set(agents.listQueue(alpha.id).deliveries.map((delivery) => delivery.id));
    const emptyBefore = fakeTurns().filter((turn) => turn.kind === "empty").length;
    await runCauseEffect(
      agents.sendMessage({
        agentId: lead.id,
        text: `Tell Anchor. ${calls({
          tool: "send_message",
          arguments: { recipientAgentIds: [alpha.id], text: "EMPTY-TURN update", expectsReply: false },
        })}`,
      }),
    );
    const update = await waitFor("the update to end", () =>
      agents.listQueue(alpha.id).deliveries.find((delivery) => !before.has(delivery.id) && ended(delivery.status)),
    );
    assert.equal(update.status, "completed");
    assert.equal(fakeTurns().filter((turn) => turn.kind === "empty").length, emptyBefore + 1);
    assert.deepEqual(errorsFor(alpha.id, since), []);
    return { status: update.status };
  });

  await check("in a thread, an empty lead turn after a teammate result runs once more", async () => {
    const outcome = await askTeammateInThread(lead.id, alpha.id, "thread-empty-once");
    assert.deepEqual(
      outcome.turns.map((turn) => [turn.model, turn.empty]),
      [
        [PRIMARY, true],
        [PRIMARY, false],
      ],
      JSON.stringify(outcome),
    );
    assert.equal(outcome.outcome, "completed");
    assert.equal(outcome.error, null, "The thread does not fail.");
    assert.equal(outcome.answer, "Team done.");
    assert.deepEqual(outcome.errors, []);
    return outcome;
  });

  await check("in a thread, a second empty run of the same result shows the error", async () => {
    const outcome = await askTeammateInThread(lead.id, alpha.id, "thread-empty-always");
    assert.equal(outcome.turns.length, 2, `The result runs again only once: ${JSON.stringify(outcome)}`);
    assert.equal(outcome.outcome, "failed");
    assert.equal(outcome.error, NO_ANSWER);
    return outcome;
  });

  await check("in a WhatsApp conversation, an empty turn after a teammate result runs once more", async () => {
    const outcome = await askTeammateFromWhatsApp(lead.id, alpha.id, "chat-empty-once");
    assert.deepEqual(
      outcome.turns.map((turn) => [turn.model, turn.empty]),
      [
        [PRIMARY, true],
        [PRIMARY, false],
      ],
      JSON.stringify(outcome),
    );
    assert.deepEqual(
      outcome.ends.filter((end) => end.followUp),
      [{ status: "completed", followUp: true, answer: "Team done." }],
      "The conversation gets the answer, and no end of the empty run.",
    );
    assert.deepEqual(outcome.errors, []);
    return outcome;
  });

  await check("in a WhatsApp conversation, a second empty run of the same result fails the request", async () => {
    const outcome = await askTeammateFromWhatsApp(lead.id, alpha.id, "chat-empty-always");
    assert.equal(outcome.turns.length, 2, `The result runs again only once: ${JSON.stringify(outcome)}`);
    assert.deepEqual(
      outcome.ends.filter((end) => end.followUp),
      [{ status: "failed", followUp: true, answer: null }],
    );
    assert.deepEqual(outcome.errors, [NO_ANSWER]);
    return outcome;
  });

  /** A person's message in a new thread. Returns when the thread's turn ended and the thread is idle. */
  const personInThread = async (text: string) => {
    const since = events.length;
    const before = fakeTurns().length;
    const task = await runCauseEffect(agents.startTask({ agentId: lead.id, text }));
    const ended = await waitFor("the thread's turn to end and the thread to be idle", () => {
      const turnEnded = events
        .slice(since)
        .some(
          (event) =>
            event.type === "thread-turn-completed" &&
            event.taskId === task.id &&
            (event.turn.status === "completed" || event.turn.status === "failed"),
        );
      const entry = agents.listTasks(lead.id).tasks.find((candidate) => candidate.id === task.id);
      return turnEnded && entry?.state === "idle" ? entry : null;
    });
    const assistant = agents.readTask(lead.id, task.id).messages.filter((message) => message.author === "assistant");
    return {
      runs: fakeTurns().length - before,
      outcome: ended.outcome,
      error: ended.error,
      rows: assistant.map((message) => ({ itemType: message.itemType, text: message.text })),
    };
  };

  await check("in a thread, narration after the last step becomes the answer of an empty turn", async () => {
    const outcome = await personInThread("NARRATION-AFTER-STEP");
    assert.equal(outcome.runs, 1, `The turn does not run again: ${JSON.stringify(outcome)}`);
    assert.equal(outcome.outcome, "completed");
    assert.equal(outcome.error, null);
    assert.deepEqual(outcome.rows, [{ itemType: "final_answer", text: "The folder holds two files." }]);
    return outcome;
  });

  await check("in a thread, an empty turn with narration only before its step ends as before", async () => {
    const outcome = await personInThread("NARRATION-BEFORE-STEP");
    assert.equal(outcome.runs, 1, `A turn that ran a step does not run again: ${JSON.stringify(outcome)}`);
    assert.equal(outcome.outcome, "completed");
    assert.equal(outcome.error, null);
    assert.equal(
      outcome.rows.some((row) => row.itemType !== "commentary" && row.text.trim() !== ""),
      false,
      "The narration before the step stays a step.",
    );
    return outcome;
  });

  await check("a teammate's empty turn after a step still sends the note of its work", async () => {
    const before = new Set(agents.listQueue(lead.id).deliveries.map((delivery) => delivery.id));
    await runCauseEffect(
      agents.sendMessage({
        agentId: lead.id,
        text: `Ask the team. ${calls({
          tool: "send_message",
          arguments: { recipientAgentIds: [alpha.id], text: "NARRATION-BEFORE-STEP", expectsReply: true },
        })}`,
      }),
    );
    const result = await waitFor("the teammate's result to end", () => {
      const found = newResults(lead.id, before)[0];
      return found && ended(found.status) ? found : null;
    });
    await waitFor("the lead to be idle", () => agents.listQueue(lead.id).deliveries.every((d) => ended(d.status)));
    assert.match(result.text, /Status: blocked/u, `The lead gets the note: ${result.text}`);
    assert.match(result.text, /Tool steps in the turn: 1/u);
    return { status: result.status, text: result.text };
  });

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  report.checkedAt = new Date().toISOString();
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  for (const entry of report.checks) process.stdout.write(`PASS ${entry.name}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
