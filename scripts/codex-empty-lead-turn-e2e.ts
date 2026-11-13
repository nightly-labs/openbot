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
 *   with only its reasoning: always for `empty-always`, on the first run for `empty-once`, and on
 *   the primary model for `empty-on-primary`.
 * - `<<CALLS[...]CALLS>>`: calls the named OpenBot tools one at a time, then answers "Asked.".
 * - `TEAM-QUESTION mode:<mode>`: a teammate answers `TEAM-RESULT mode:<mode>`.
 * - `EMPTY-TURN`: ends with only its reasoning.
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
const finish = (turn) => {
  const { threadId, turnId } = turn;
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
    const empty = mode === "empty-always" || (mode === "empty-once" && run === 1) || (mode === "empty-on-primary" && model === PRIMARY);
    return { kind: "result", mode, calls: [], empty, reply: "Team done." };
  }
  const named = /<<CALLS([\\s\\S]*?)CALLS>>/.exec(text);
  if (named) return { kind: "calls", calls: JSON.parse(named[1]), empty: false, reply: "Asked." };
  const question = /TEAM-QUESTION mode:([a-z-]+)/.exec(text);
  if (question) return { kind: "question", mode: question[1], calls: [], empty: false, reply: "TEAM-RESULT mode:" + question[1] };
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
  kind: "result" | "calls" | "question" | "empty" | "chat";
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
