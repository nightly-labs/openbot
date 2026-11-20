import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AGENT_PROVIDERS, type RoutineRun } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/routine-restart-retry-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-routine-restart-retry-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");
const fakeHold = join(root, "hold");

process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync, existsSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.170.0\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const HOLD = ${JSON.stringify(fakeHold)};
const config = { config: { mcp_servers: {} }, layers: [] };
let buffer = "";
let threads = 0;
let turns = 0;
const held = new Set();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const log = (entry) => appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const inputText = (input) => (Array.isArray(input) ? input.map((item) => item.text || "").join("\\n") : "");
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
    case "thread/start": return write({ id: message.id, result: { thread: { id: process.pid + "-thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/archive": return write({ id: message.id, result: {} });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = process.pid + "-turn-" + (++turns);
      const hold = existsSync(HOLD);
      log({ method: "turn/start", turnId, held: hold, text: inputText(params.input) });
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      if (hold) return held.add(turnId);
      const item = { type: "agentMessage", id: "message-" + turnId, text: "Report: all good.", phase: "final_answer" };
      write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
    }
    case "turn/interrupt": {
      if (held.has(params.turnId)) return;
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
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

const ONCE_INSTRUCTION = "Check the open orders and report.";
const SKIP_INSTRUCTION = "Check the new mail and report.";
const REMINDER_INSTRUCTION = "Send the renewal reminder.";
const RESTART_NOTE = "Do the routine again now.";

interface TurnEntry {
  text: string;
}

interface FirstRestart {
  onceRunStatus: string;
  onceRuns: number;
  onceTurns: number;
  retryHasNote: boolean;
  onceNextRunAt: string | undefined;
  skipRunStatus: string;
  skipDelivery: string;
  skipTurns: number;
  reminderRunStatus: string;
  reminderTurns: number;
}

interface SecondRestart {
  retriedStatus: string;
  endedStatus: string;
  delivery: string;
  onceTurns: number;
}

interface NewerSlotRestart {
  cutRunStatus: string;
  newerRunStatus: string;
  onceTurns: number;
  newerTurnHasNote: boolean;
}

const report: {
  firstRestart?: FirstRestart;
  secondRestart?: SecondRestart;
  newerSlotRestart?: NewerSlotRestart;
  checks: { name: string; passed: boolean; detail?: string }[];
  passed: boolean;
  error?: string;
} = { checks: [], passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  prepareSecret: unused,
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

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 50));
  }
}

function turns(instruction: string): TurnEntry[] {
  if (!existsSync(fakeLog)) return [];
  return readFileSync(fakeLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line): unknown => JSON.parse(line))
    .filter((entry): entry is TurnEntry => isTurnStart(entry) && entry.text.includes(instruction));
}

function isTurnStart(value: unknown): value is TurnEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "method" in value &&
    value.method === "turn/start" &&
    "text" in value &&
    typeof value.text === "string"
  );
}

function pass(name: string, condition: boolean, detail?: string) {
  report.checks.push({ name, passed: condition, ...(detail === undefined ? {} : { detail }) });
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
}

function open() {
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
  return { database, mailbox, agents };
}

type Service = ReturnType<typeof open>;

async function close(service: Service) {
  await runCauseEffect(service.agents.stop()).catch(() => {});
  service.database.close();
}

function makeDue(service: Service, routineIds: readonly string[]) {
  const due = new Date(Date.now() - 1_000).toISOString();
  const update = service.database.connection.prepare(
    "UPDATE projection_routine_triggers SET next_run_at = ? WHERE routine_id = ?",
  );
  for (const routineId of routineIds) update.run(due, routineId);
  service.agents.armRoutines();
}

function runs(service: Service, agentId: string, routineId: string): RoutineRun[] {
  return service.agents.listRoutineRuns({ agentId, routineId });
}

function idle(service: Service, agentId: string): boolean {
  return service.agents
    .listQueue(agentId)
    .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status));
}

function deliveryStatus(service: Service, deliveryId: string | null): string {
  return (deliveryId && service.mailbox.getDelivery(deliveryId)?.delivery.status) || "missing";
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
let service = open();

try {
  await runCauseEffect(service.agents.initialize());
  const createAgent = (name: string) =>
    runCauseEffect(
      service.agents.createAgent({
        name,
        description: "Runs a daily check.",
        avatarSeed: name.toLowerCase(),
        avatarHue: null,
        initialMessage: "Hello.",
      }),
    );
  const orders = await createAgent("Orders");
  const mail = await createAgent("Mail");
  const reminders = await createAgent("Reminders");
  await waitFor(
    "the first chat turns to end",
    () => [orders.id, mail.id, reminders.id].every((agentId) => idle(service, agentId)),
    60_000,
  );
  const once = service.agents.createRoutine({
    agentId: orders.id,
    name: "Orders check",
    instruction: ONCE_INSTRUCTION,
    active: true,
    timezone: "UTC",
    schedule: { kind: "daily", time: "09:00" },
    missedPolicy: "run-once",
  });
  const skip = service.agents.createRoutine({
    agentId: mail.id,
    name: "Mail check",
    instruction: SKIP_INSTRUCTION,
    active: true,
    timezone: "UTC",
    schedule: { kind: "daily", time: "09:00" },
    missedPolicy: "skip",
  });
  const reminder = service.agents.createRoutine({
    agentId: reminders.id,
    name: "Renewal reminder",
    instruction: REMINDER_INSTRUCTION,
    active: true,
    timezone: "UTC",
    schedule: { kind: "once", date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), time: "09:00" },
    missedPolicy: "run-once",
  });

  await writeFile(fakeHold, "");
  makeDue(service, [once.id, skip.id, reminder.id]);
  await waitFor(
    "the routine turns to start and hold",
    () =>
      turns(ONCE_INSTRUCTION).length === 1 &&
      turns(SKIP_INSTRUCTION).length === 1 &&
      turns(REMINDER_INSTRUCTION).length === 1,
    90_000,
  );
  const reminderRun = await waitFor(
    "the one-time routine run to run",
    () => runs(service, reminders.id, reminder.id).find((run) => run.status === "running"),
    10_000,
  );
  const onceRun = await waitFor(
    "the run-once routine run to run",
    () => runs(service, orders.id, once.id).find((run) => run.status === "running"),
    10_000,
  );
  const skipRun = await waitFor(
    "the skip routine run to run",
    () => runs(service, mail.id, skip.id).find((run) => run.status === "running"),
    10_000,
  );
  await close(service);

  await rm(fakeHold);
  service = open();
  await runCauseEffect(service.agents.initialize());
  const retried = await waitFor(
    "the run-once routine run to finish after the restart",
    () => runs(service, orders.id, once.id).find((run) => run.id === onceRun.id && run.status === "succeeded"),
    60_000,
  );
  const skipped = await waitFor(
    "the skip routine run to end after the restart",
    () => runs(service, mail.id, skip.id).find((run) => run.id === skipRun.id && run.status !== "running"),
    60_000,
  );
  const reminderDone = await waitFor(
    "the one-time routine run to finish after the restart",
    () => runs(service, reminders.id, reminder.id).find((run) => run.id === reminderRun.id && run.status !== "running"),
    60_000,
  );
  const onceTurns = turns(ONCE_INSTRUCTION);
  const onceRoutine = service.agents.listRoutines(orders.id).find((routine) => routine.id === once.id);
  report.firstRestart = {
    onceRunStatus: retried.status,
    onceRuns: runs(service, orders.id, once.id).length,
    onceTurns: onceTurns.length,
    retryHasNote: onceTurns[1]?.text.includes(RESTART_NOTE) ?? false,
    onceNextRunAt: onceRoutine?.trigger.nextRunAt,
    skipRunStatus: skipped.status,
    skipDelivery: deliveryStatus(service, skipped.deliveryId),
    skipTurns: turns(SKIP_INSTRUCTION).length,
    reminderRunStatus: reminderDone.status,
    reminderTurns: turns(REMINDER_INSTRUCTION).length,
  };
  pass("The cut-off run-once routine run finishes after the restart", retried.status === "succeeded");
  pass("The retry uses the same run, so the slot gets no second run", runs(service, orders.id, once.id).length === 1);
  pass("The run-once routine runs one more time", onceTurns.length === 2, String(onceTurns.length));
  pass("The first run had no restart note", !onceTurns[0]?.text.includes(RESTART_NOTE));
  pass("The retry tells the agent to check what it already did", onceTurns[1]?.text.includes(RESTART_NOTE) === true);
  pass(
    "The next slot of the run-once routine is in the future",
    Date.parse(onceRoutine?.trigger.nextRunAt ?? "") > Date.now(),
    onceRoutine?.trigger.nextRunAt,
  );
  pass("The cut-off skip routine run stays interrupted", skipped.status === "interrupted", skipped.status);
  pass("The skip routine does not run again", turns(SKIP_INSTRUCTION).length === 1);
  pass("The cut-off one-time routine run finishes after the restart", reminderDone.status === "succeeded");
  pass(
    "The one-time routine runs one more time, with the note",
    turns(REMINDER_INSTRUCTION).length === 2 && turns(REMINDER_INSTRUCTION)[1]?.text.includes(RESTART_NOTE) === true,
    String(turns(REMINDER_INSTRUCTION).length),
  );

  await writeFile(fakeHold, "");
  makeDue(service, [once.id]);
  const secondRun = await waitFor(
    "the next run-once routine run to run",
    () => runs(service, orders.id, once.id).find((run) => run.id !== onceRun.id && run.status === "running"),
    90_000,
  );
  await waitFor("the next routine turn to hold", () => turns(ONCE_INSTRUCTION).length === 3, 30_000);
  await close(service);

  service = open();
  await runCauseEffect(service.agents.initialize());
  await waitFor("the retry of the next run to start and hold", () => turns(ONCE_INSTRUCTION).length === 4, 60_000);
  const retriedAgain = await waitFor(
    "the retried run to run",
    () => runs(service, orders.id, once.id).find((run) => run.id === secondRun.id && run.status === "running"),
    10_000,
  );
  await close(service);

  await rm(fakeHold);
  service = open();
  await runCauseEffect(service.agents.initialize());
  const ended = await waitFor(
    "the retried run to end after a second restart",
    () => runs(service, orders.id, once.id).find((run) => run.id === secondRun.id && run.status !== "running"),
    60_000,
  );
  await waitFor("the agent queue to be idle", () => idle(service, orders.id), 30_000);
  report.secondRestart = {
    retriedStatus: retriedAgain.status,
    endedStatus: ended.status,
    delivery: deliveryStatus(service, ended.deliveryId),
    onceTurns: turns(ONCE_INSTRUCTION).length,
  };
  pass("A run that a second restart cuts off ends as interrupted", ended.status === "interrupted", ended.status);
  pass("A run is retried only one time", turns(ONCE_INSTRUCTION).length === 4, String(turns(ONCE_INSTRUCTION).length));

  await writeFile(fakeHold, "");
  makeDue(service, [once.id]);
  const cutRun = await waitFor(
    "a third run-once routine run to run",
    () =>
      runs(service, orders.id, once.id).find(
        (run) => run.id !== onceRun.id && run.id !== secondRun.id && run.status === "running",
      ),
    90_000,
  );
  await waitFor("the third routine turn to hold", () => turns(ONCE_INSTRUCTION).length === 5, 30_000);
  await close(service);

  await rm(fakeHold);
  const offline = new DatabaseSync(service.database.path);
  offline
    .prepare("UPDATE projection_routine_triggers SET next_run_at = ? WHERE routine_id = ?")
    .run(new Date(Date.now() - 1_000).toISOString(), once.id);
  offline.close();
  service = open();
  await runCauseEffect(service.agents.initialize());
  const newer = await waitFor(
    "the run of the newer slot to finish",
    () =>
      runs(service, orders.id, once.id).find(
        (run) => run.scheduledFor > cutRun.scheduledFor && run.status === "succeeded",
      ),
    90_000,
  );
  const cutEnded = await waitFor(
    "the cut-off run to end",
    () => runs(service, orders.id, once.id).find((run) => run.id === cutRun.id && run.status !== "running"),
    30_000,
  );
  await waitFor("the agent queue to be idle again", () => idle(service, orders.id), 30_000);
  const newerTurn = turns(ONCE_INSTRUCTION)[5];
  report.newerSlotRestart = {
    cutRunStatus: cutEnded.status,
    newerRunStatus: newer.status,
    onceTurns: turns(ONCE_INSTRUCTION).length,
    newerTurnHasNote: newerTurn?.text.includes(RESTART_NOTE) ?? false,
  };
  pass("A cut-off run is not retried when a newer slot is due", cutEnded.status === "interrupted", cutEnded.status);
  pass(
    "Only the newer slot runs, one time and as a normal run",
    turns(ONCE_INSTRUCTION).length === 6 && newerTurn?.text.includes(RESTART_NOTE) === false,
    String(turns(ONCE_INSTRUCTION).length),
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await close(service);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
