// Checks the automatic plan continuation: a turn of the agent's own chat or of a side thread that
// ends with open steps in the agent's plan runs once more with a short note, up to 3 times for one
// request. Runs the real agent service on a temporary profile with a fake Codex app-server. The
// current message names its turns in `<<PLAN[...]PLAN>>`: each element is one turn, with its plan
// steps, its answer, its delay and its OpenBot tool calls. A continuation turn takes the next element
// of its thread.
// Checks:
//   1. A turn with open steps continues once, and the request completes when the plan is done.
//   2. A request continues at most 3 times.
//   3. A continuation that does not change the open steps stops the chain.
//   4. An answer whose last line asks a question does not continue.
//   5. A turn that opens a wait does not continue.
//   6. Stop during a continuation ends the chain. The next message works.
//   7. A message that waits in the queue stops the continuation and runs next.
//   8. A side thread continues in its own thread only.
//   9. A routine run does not continue.
//  10. A restart while a continuation waits completes the request with no new turn.
// Not checked: a message sent in the short gap before a continuation starts. The drain starts the
// continuation at once, and a hidden agent refuses new messages. Check 7 covers the same rule.
// No provider, account or network is used. `bun run test:plan-continuation`.
// Writes .openbot-build/plan-continuation-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentEvent, PLAN_CONTINUATION_ITEM_TYPE } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/plan-continuation-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-plan-continuation-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");
const NOTE_MARKER = "OpenBot note, not a message from the user";

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

type StepStatus = "pending" | "inProgress" | "completed";

/** One turn of the fake: its plan, its answer, its delay and its OpenBot tool calls. */
interface FakeTurn {
  steps: [string, StepStatus][];
  answer?: string;
  delayMs?: number;
  calls?: { tool: string; arguments: Record<string, string> }[];
}

const plan = (...turns: FakeTurn[]) => `<<PLAN${JSON.stringify(turns)}PLAN>>`;

const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const NOTE = ${JSON.stringify(NOTE_MARKER)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
const waiting = new Map();
const timers = new Map();
/** The turns that each thread has still to run, from the message that named them. */
const scripts = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const log = (entry) => fs.appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (turn) => {
  timers.delete(turn.turnId);
  const plan = (turn.script.steps || []).map(([step, status]) => ({ step, status }));
  if (plan.length > 0) write({ method: "turn/plan/updated", params: { threadId: turn.threadId, turnId: turn.turnId, plan } });
  const item = { type: "agentMessage", id: "message-" + turn.turnId, text: turn.script.answer || "Done.", phase: "final_answer" };
  write({ method: "item/completed", params: { threadId: turn.threadId, turnId: turn.turnId, item } });
  write({ method: "turn/completed", params: { threadId: turn.threadId, turn: { id: turn.turnId, status: "completed" } } });
};
const callNext = (turn) => {
  const call = turn.calls.shift();
  if (!call) return timers.set(turn.turnId, setTimeout(() => finish(turn), turn.script.delayMs || 5));
  const id = "tool-" + turn.turnId + "-" + turn.calls.length;
  waiting.set(id, turn);
  write({ id, method: "item/tool/call", params: { threadId: turn.threadId, turnId: turn.turnId, callId: "call-" + id, namespace: "openbot", tool: call.tool, arguments: call.arguments } });
};
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-6-luna", displayName: "GPT-6 Luna" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + process.pid + "-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const note = text.includes(NOTE);
      if (!note) {
        const named = /<<PLAN([\\s\\S]*?)PLAN>>/.exec(text.split("--- current message ---").at(-1));
        scripts.set(params.threadId, named ? JSON.parse(named[1]) : []);
      }
      const script = (scripts.get(params.threadId) || []).shift() || { steps: [] };
      log({ method: "turn", threadId: params.threadId, turnId, note, text });
      const turn = { threadId: params.threadId, turnId, script, calls: [...(script.calls || [])] };
      return callNext(turn);
    }
    case "turn/interrupt": {
      clearTimeout(timers.get(params.turnId));
      timers.delete(params.turnId);
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
        log({ method: "toolResult", result: message.result });
        callNext(turn);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

const report: {
  checks: { name: string; passed: boolean; detail?: unknown }[];
  notChecked: string[];
  passed: boolean;
  checkedAt?: string;
  error?: string;
} = {
  checks: [],
  notChecked: ["a message sent in the short gap before a continuation starts (check 7 covers the same rule)"],
  passed: false,
};

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

interface LoggedTurn {
  method: string;
  threadId: string;
  turnId: string;
  note: boolean;
  text: string;
}

function loggedTurns(): LoggedTurn[] {
  let text = "";
  try {
    text = readFileSync(fakeLog, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line): LoggedTurn => JSON.parse(line))
    .filter((entry) => entry.method === "turn");
}

async function check(name: string, run: () => Promise<unknown>) {
  const detail = await run();
  report.checks.push({ name, passed: true, detail });
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });

function openService() {
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const service = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "codex",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
  });
  const events: AgentEvent[] = [];
  service.on("event", (event) => events.push(event));
  return { database, store, mailbox, service, events };
}

let current = openService();

const ended = (status: string | undefined) =>
  status === "completed" || status === "failed" || status === "interrupted" || status === "cancelled";

async function createAgent(name: string) {
  const { service } = current;
  const agent = await runCauseEffect(
    service.createAgent({
      name,
      description: "Checks the automatic plan continuation.",
      avatarSeed: name.toLowerCase(),
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await waitFor(`${name}'s first turn`, () =>
    service.listQueue(agent.id).deliveries.every((delivery) => ended(delivery.status)),
  );
  return agent;
}

/** Sends a message, to the agent's own chat or to its side thread. Answers its delivery id. */
async function send(agentId: string, text: string, taskId?: string): Promise<string> {
  const receipt = await runCauseEffect(
    current.service.sendMessage({ agentId, text, attachmentDraftIds: [], ...(taskId ? { taskId } : {}) }),
  );
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, "The message has a delivery.");
  return deliveryId;
}

/** Waits for the delivery to end, with all of its continuations, and answers its status. */
function settled(deliveryId: string, timeoutMs?: number) {
  return waitFor(
    `delivery ${deliveryId} to end`,
    () => {
      const value = current.mailbox.getDelivery(deliveryId)?.delivery.status;
      return ended(value) ? value : null;
    },
    timeoutMs,
  );
}

/** The messages of the agent's own chat or of one side thread, as the database holds them. */
function chatMessages(agentId: string, sideThreadId?: string) {
  const threadId = sideThreadId ?? current.store.list().find((agent) => agent.id === agentId)?.threadId ?? null;
  return current.database.readConversation(agentId, threadId).messages;
}

/** The continuation lines of the agent's own chat or of one side thread, as the database holds them. */
function continuationLines(agentId: string, sideThreadId?: string) {
  return chatMessages(agentId, sideThreadId).filter((message) => message.itemType === PLAN_CONTINUATION_ITEM_TYPE);
}

function errorsFor(agentId: string, since: number) {
  return current.events.slice(since).filter((event) => event.type === "error" && event.agentId === agentId);
}

const turnsSince = (mark: number) => loggedTurns().slice(mark);

try {
  await runCauseEffect(current.service.initialize());

  await check("a turn with open steps continues once, then the request completes", async () => {
    const agent = await createAgent("Finisher");
    const mark = loggedTurns().length;
    const since = current.events.length;
    const id = await send(
      agent.id,
      `Build it. ${plan(
        {
          steps: [
            ["Write the code", "completed"],
            ["Run the tests", "pending"],
          ],
          answer: "The code is written.",
        },
        {
          steps: [
            ["Write the code", "completed"],
            ["Run the tests", "completed"],
          ],
          answer: "The tests pass.",
        },
      )}`,
    );
    assert.equal(await settled(id), "completed");
    const turns = turnsSince(mark);
    assert.deepEqual(
      turns.map((turn) => turn.note),
      [false, true],
      "One continuation turn runs.",
    );
    const note = turns[1]?.text ?? "";
    assert.ok(note.includes("[pending] Run the tests"), "The note names the open step.");
    assert.ok(!note.includes("Write the code"), "The note does not name the done step.");
    assert.ok(note.includes("Automatic continuation 1 of 3."));
    assert.equal(continuationLines(agent.id).length, 1, "One continuation line shows.");
    assert.equal(errorsFor(agent.id, since).length, 0, "No error shows.");
    const completions = current.events
      .slice(since)
      .filter((event) => event.type === "turn-completed" && event.agentId === agent.id);
    assert.deepEqual(
      completions.map((event) => event.type === "turn-completed" && event.continues === true),
      [true, false],
      "Only the last turn of the request completes it.",
    );
    const messages = chatMessages(agent.id);
    assert.ok(!messages.some((message) => message.text?.includes(NOTE_MARKER)), "The note does not show as a message.");
    assert.ok(
      messages.some((message) => message.text === "The tests pass."),
      "The answer of the continuation shows.",
    );
    const shown = messages.flatMap((message) => {
      if (message.id === id) return ["request"];
      if (message.itemType === PLAN_CONTINUATION_ITEM_TYPE) return ["line"];
      return message.text === "The code is written." || message.text === "The tests pass." ? [message.text] : [];
    });
    assert.deepEqual(
      shown,
      ["request", "The code is written.", "line", "The tests pass."],
      "The first answer and the line show between the request and the continuation's answer.",
    );
    return { turns: turns.length, line: continuationLines(agent.id)[0]?.id, shown };
  });

  await check("a request continues at most 3 times", async () => {
    const agent = await createAgent("Capped");
    const mark = loggedTurns().length;
    const step = (done: number): FakeTurn => ({
      steps: ["One", "Two", "Three", "Four", "Five"].map((text, index) => [
        text,
        index < done ? "completed" : "pending",
      ]),
    });
    const id = await send(agent.id, `Do five things. ${plan(step(0), step(1), step(2), step(3), step(4))}`);
    assert.equal(await settled(id), "completed");
    const turns = turnsSince(mark);
    assert.deepEqual(
      turns.map((turn) => turn.note),
      [false, true, true, true],
      "Three continuation turns run.",
    );
    assert.ok(turns[3]?.text.includes("Automatic continuation 3 of 3."));
    assert.equal(continuationLines(agent.id).length, 3, "Three continuation lines show.");
    return { turns: turns.length };
  });

  await check("a continuation that does not change the open steps stops the chain", async () => {
    const agent = await createAgent("Stuck");
    const mark = loggedTurns().length;
    const stuck: FakeTurn = {
      steps: [
        ["Read", "completed"],
        ["Fix", "inProgress"],
      ],
    };
    const id = await send(agent.id, `Fix it. ${plan(stuck, stuck, stuck)}`);
    assert.equal(await settled(id), "completed");
    assert.equal(turnsSince(mark).length, 2, "One continuation turn runs.");
    assert.ok(turnsSince(mark)[1]?.text.includes("[in progress] Fix"));
    assert.equal(continuationLines(agent.id).length, 1);
    return { turns: turnsSince(mark).length };
  });

  await check("an answer whose last line asks a question does not continue", async () => {
    const agent = await createAgent("Asker");
    const mark = loggedTurns().length;
    const id = await send(
      agent.id,
      `Plan the trip. ${plan({
        steps: [
          ["Pick dates", "completed"],
          ["Book hotel", "pending"],
        ],
        answer: "**Which hotel do you want?** Tell me and I book it.",
      })}`,
    );
    assert.equal(await settled(id), "completed");
    assert.equal(turnsSince(mark).length, 1, "No continuation turn runs.");
    assert.equal(continuationLines(agent.id).length, 0);
    return { turns: 1 };
  });

  await check("steps left open by an earlier request do not start or extend a continuation", async () => {
    const agent = await createAgent("Switcher");
    const left: [string, StepStatus] = ["Book hotel", "pending"];
    const first = await send(
      agent.id,
      `Plan the trip. ${plan({ steps: [["Pick dates", "completed"], left], answer: "Which hotel do you want?" })}`,
    );
    assert.equal(await settled(first), "completed");
    const mark = loggedTurns().length;
    const second = await send(
      agent.id,
      `Fix the typo. ${plan({ steps: [left, ["Fix the typo", "completed"]], answer: "The typo is fixed." })}`,
    );
    assert.equal(await settled(second), "completed");
    assert.equal(turnsSince(mark).length, 1, "An old open step alone does not continue.");
    const third = await send(
      agent.id,
      `Ship it. ${plan(
        { steps: [left, ["Build", "completed"], ["Release", "pending"]], answer: "The build is done." },
        { steps: [left, ["Build", "completed"], ["Release", "completed"]], answer: "It is released." },
      )}`,
    );
    assert.equal(await settled(third), "completed");
    const turns = turnsSince(mark).slice(1);
    assert.deepEqual(
      turns.map((turn) => turn.note),
      [false, true],
      "Only the new open step continues, once.",
    );
    assert.ok(turns[1]?.text.includes("[pending] Release"), "The note names the new step.");
    assert.ok(!turns[1]?.text.includes("Book hotel"), "The note does not name the old step.");
    return { turns: turns.length };
  });

  await check("a turn that opens a wait does not continue", async () => {
    const agent = await createAgent("Waiter");
    const routine = current.service.createRoutine(
      {
        agentId: agent.id,
        name: "Build check",
        instruction: "Check the build.",
        active: false,
        timezone: "UTC",
        schedule: { kind: "custom", expression: "0 * * * *" },
      },
      { recordConversationEvent: false },
    );
    const mark = loggedTurns().length;
    const id = await send(
      agent.id,
      `Ship it. ${plan({
        steps: [
          ["Start the build", "completed"],
          ["Ship", "pending"],
        ],
        calls: [{ tool: "await_event", arguments: { note: "Wait for the build.", routineId: routine.id } }],
        answer: "I wait for the build.",
      })}`,
    );
    assert.equal(await settled(id), "completed");
    assert.equal(current.service.listWaits(agent.id).waits.length, 1, "The wait is open.");
    assert.equal(turnsSince(mark).length, 1, "No continuation turn runs.");
    assert.equal(continuationLines(agent.id).length, 0);
    return { turns: 1 };
  });

  await check("Stop during a continuation ends the chain, and the next message works", async () => {
    const agent = await createAgent("Stopped");
    const mark = loggedTurns().length;
    const since = current.events.length;
    const id = await send(
      agent.id,
      `Migrate it. ${plan(
        {
          steps: [
            ["Copy", "completed"],
            ["Verify", "pending"],
            ["Clean", "pending"],
          ],
        },
        {
          steps: [
            ["Copy", "completed"],
            ["Verify", "completed"],
            ["Clean", "pending"],
          ],
          delayMs: 30_000,
        },
      )}`,
    );
    const continuation = await waitFor("the continuation turn", () => turnsSince(mark).find((turn) => turn.note));
    await runCauseEffect(current.service.interrupt(agent.id, continuation.turnId));
    const status = await settled(id);
    assert.equal(status, "interrupted", "The request ends as stopped.");
    assert.equal(turnsSince(mark).length, 2, "No other continuation turn runs.");
    const next = await send(agent.id, "Thanks.");
    assert.equal(await settled(next), "completed", "The next message completes.");
    assert.equal(turnsSince(mark).at(-1)?.note, false);
    assert.equal(continuationLines(agent.id).length, 1);
    assert.equal(errorsFor(agent.id, since).length, 0, "No error shows.");
    return { status };
  });

  await check("a message that waits in the queue stops the continuation and runs next", async () => {
    const agent = await createAgent("Queued");
    const mark = loggedTurns().length;
    const first = await send(
      agent.id,
      `Sort the files. ${plan({
        steps: [
          ["List", "completed"],
          ["Sort", "pending"],
        ],
        delayMs: 1_500,
      })}`,
    );
    await waitFor("the first turn", () => turnsSince(mark).length === 1);
    const second = await send(agent.id, "Use the date order.");
    assert.equal(await settled(first), "completed");
    assert.equal(await settled(second), "completed");
    const turns = turnsSince(mark);
    assert.deepEqual(
      turns.map((turn) => turn.note),
      [false, false],
      "No continuation turn runs.",
    );
    assert.ok(turns[1]?.text.includes("Use the date order."), "The waiting message runs next.");
    assert.equal(continuationLines(agent.id).length, 0);
    return { turns: turns.length };
  });

  await check("a side thread continues in its own thread only", async () => {
    const agent = await createAgent("Threads");
    const mark = loggedTurns().length;
    const task = await runCauseEffect(
      current.service.startTask({
        agentId: agent.id,
        text: `Check the links. ${plan(
          {
            steps: [
              ["Collect", "completed"],
              ["Check", "pending"],
            ],
          },
          {
            steps: [
              ["Collect", "completed"],
              ["Check", "completed"],
            ],
            answer: "All links work.",
          },
        )}`,
      }),
    );
    await waitFor("the side thread to finish", () =>
      current.service.readTask(agent.id, task.id).messages.some((message) => message.text === "All links work."),
    );
    assert.deepEqual(
      turnsSince(mark).map((turn) => turn.note),
      [false, true],
    );
    assert.equal(continuationLines(agent.id, task.threadId).length, 1, "The side thread shows the line.");
    assert.equal(continuationLines(agent.id).length, 0, "The agent's own chat shows no line.");
    return { taskId: task.id };
  });

  await check("a routine run does not continue", async () => {
    const agent = await createAgent("Routine");
    const routine = current.service.createRoutine(
      {
        agentId: agent.id,
        name: "Daily report",
        instruction: `Write the report. ${plan({
          steps: [
            ["Collect", "completed"],
            ["Write", "pending"],
          ],
          answer: "Collected.",
        })}`,
        active: false,
        timezone: "UTC",
        schedule: { kind: "custom", expression: "0 9 * * *" },
      },
      { recordConversationEvent: false },
    );
    const mark = loggedTurns().length;
    await runCauseEffect(current.service.testRoutine({ agentId: agent.id, routineId: routine.id }));
    await waitFor("the routine turn", () => turnsSince(mark).length >= 1);
    await waitFor("the routine run to end", () =>
      current.service.listQueue(agent.id).deliveries.every((delivery) => ended(delivery.status)),
    );
    assert.equal(turnsSince(mark).length, 1, "No continuation turn runs.");
    assert.equal(continuationLines(agent.id).length, 0);
    return { turns: 1 };
  });

  await check("a restart while a continuation waits completes the request with no new turn", async () => {
    const agent = await createAgent("Restart");
    const mark = loggedTurns().length;
    const id = await send(
      agent.id,
      `Index it. ${plan(
        {
          steps: [
            ["Scan", "completed"],
            ["Index", "pending"],
          ],
          delayMs: 1_500,
        },
        {
          steps: [
            ["Scan", "completed"],
            ["Index", "completed"],
          ],
        },
      )}`,
    );
    await waitFor("the first turn", () => turnsSince(mark).length === 1);
    // A hidden agent finishes its turn, and its queue waits: the continuation waits too.
    await runCauseEffect(current.service.setAgentHidden({ agentId: agent.id, hidden: true }));
    await waitFor("the continuation to wait", () => continuationLines(agent.id).length === 1);
    assert.equal(
      current.mailbox.getDelivery(id)?.planContinuation?.queued,
      true,
      "The request waits for its continuation.",
    );
    await runCauseEffect(current.service.stop());
    current.database.close();
    current = openService();
    await runCauseEffect(current.service.initialize());
    const since = current.events.length;
    await runCauseEffect(current.service.setAgentHidden({ agentId: agent.id, hidden: false }));
    assert.equal(await settled(id), "completed", "The request completes.");
    assert.equal(turnsSince(mark).length, 1, "No continuation turn runs after the restart.");
    assert.equal(
      current.service.listQueue(agent.id).deliveries.filter((delivery) => !ended(delivery.status)).length,
      0,
      "Nothing waits in the queue.",
    );
    assert.equal(errorsFor(agent.id, since).length, 0, "No error shows.");
    return { turns: 1 };
  });

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(current.service.stop()).catch(() => {});
  report.checkedAt = new Date().toISOString();
  current.database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  for (const entry of report.checks) process.stdout.write(`PASS ${entry.name}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
