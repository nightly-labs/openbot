// Run: bun scripts/routine-cron-syntax-e2e.ts --phase=before
// Phase selects the report folder only. All phases require invalid writes to fail.
// Uses only synthetic SQLite state, the real routine store, scheduler and mailbox.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ChannelRoutine, Routine } from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";
import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { RoutineScheduler } from "../src/backend/agent/routine-scheduler";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { AgentStore } from "../src/backend/agent-store";
import { AgentWaitStore } from "../src/backend/agent-waits/agent-wait-store";
import { AgentWaits } from "../src/backend/agent-waits/agent-waits";
import { ChannelRoutineStore } from "../src/backend/channel-routine-store";
import { ChannelStore } from "../src/backend/channel-store";
import { databaseRows, requiredStringColumn } from "../src/backend/database/database-rows";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { RoutineTimer } from "../src/backend/routine-timer";

const ROOT = resolve(import.meta.dirname, "..");
const NOW = new Date("2035-01-01T00:01:00.000Z");
// Each save must fail. The value is the next run that the released parser reads after the 00:10 run.
// `Number` reads hex, exponent, sign and fraction forms, so a stored row with them still runs.
const RELEASED_NEXT_RUN: Record<string, string> = {
  "*/10/garbage * * * *": "2035-01-01T00:20:00.000Z",
  ",10 * * * *": "2035-01-01T01:00:00.000Z",
  "/10 * * * *": "2035-01-01T01:00:00.000Z",
  "-10/10 * * * *": "2035-01-01T01:00:00.000Z",
  "0-/10 * * * *": "2035-01-01T01:00:00.000Z",
  "0x5 * * * *": "2035-01-01T01:05:00.000Z",
  "1e1 * * * *": "2035-01-01T01:10:00.000Z",
  "+5 * * * *": "2035-01-01T01:05:00.000Z",
  "5.0 * * * *": "2035-01-01T01:05:00.000Z",
  "0-0x32/10 * * * *": "2035-01-01T00:20:00.000Z",
  "*/1e1 * * * *": "2035-01-01T00:20:00.000Z",
  "0,+10 * * * *": "2035-01-01T01:00:00.000Z",
  "0 1.0 * * *": "2035-01-01T01:00:00.000Z",
};
const INVALID = Object.keys(RELEASED_NEXT_RUN);
// Leading zeros are plain decimal digits, so saves keep them.
const VALID = ["*/10 * * * *", "0,10 * * * *", "0-50/10 * * * *", "00-50/010 * * * *"];
const SOURCES = [
  "scripts/routine-cron-syntax-e2e.ts",
  "scripts/routine-due-revalidation-e2e.ts",
  "src/backend/routine-store.ts",
  "src/backend/agent-routine-store.ts",
  "src/backend/channel-routine-store.ts",
  "src/backend/channel-store.ts",
  "src/backend/routine-tables.ts",
  "packages/contracts/src/ipc-channel-routines.ts",
  "packages/contracts/src/ipc-chat-channels.ts",
  "src/backend/agent/routine-scheduler.ts",
  "src/backend/mailbox-store.ts",
  "src/backend/openbot-database.ts",
  "packages/team-client/src/routine-schedule.ts",
];

interface Fixture {
  database: OpenBotDatabase;
  store: AgentStore;
  mailbox: MailboxStore;
  conversation: ConversationRuntime;
  timer: RoutineTimer;
  scheduler: RoutineScheduler;
  runs: AgentRoutineStore;
  agentId: string;
  channelId: string;
  channelRuns: ChannelRoutineStore;
  errors: string[];
  close(): void;
}

interface CaseResult {
  name: string;
  passed: boolean;
  error?: string;
  rejected?: boolean;
  rejection?: { name: string; message: string; domainError: boolean };
  persistedBefore?: string;
  persistedAfter?: string;
  attemptedWriteCount?: number;
  unchanged?: boolean;
  routinesBefore?: RoutineOutcome[];
  routinesAfter?: RoutineOutcome[];
  loaded?: RoutineOutcome;
  edited?: RoutineOutcome;
  delivered?: { runId: string; deliveryId: string; scheduledFor: string; nextRunAt: string };
  teardown?: { closed: boolean; removed: boolean; error?: string };
}

type RoutineOutcome = Pick<Routine, "id" | "name" | "instruction" | "active" | "timezone" | "trigger">;

function outcome(routine: Routine | ChannelRoutine): RoutineOutcome {
  const { id, name, instruction, active, timezone, trigger } = routine;
  return { id, name, instruction, active, timezone, trigger };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const cases: CaseResult[] = [];
const roots: string[] = [];
const hashes: Array<{ path: string; sha256: string }> = [];
let fatal: string | undefined;

function safe(value: string): string {
  let result = redactText(value);
  for (const root of [...roots, ROOT, homedir()]) {
    result = result.replaceAll(JSON.stringify(root).slice(1, -1), "[private-root]").replaceAll(root, "[private-root]");
  }
  return result;
}

function message(error: unknown): string {
  return safe(error instanceof Error ? error.message : String(error)).slice(0, 8192);
}

async function openFixture(root: string): Promise<Fixture> {
  const database = new OpenBotDatabase(join(root, "state"));
  const store = new AgentStore(join(root, "state"), join(root, "home"), database);
  const mailbox = new MailboxStore(join(root, "state"), store.sharedRoot, database);
  let conversation: ConversationRuntime | undefined;
  try {
    await runCauseEffect(store.initialize());
    await runCauseEffect(mailbox.initialize());
    const agent =
      store.list()[0] ??
      (await runCauseEffect(
        store.createAgent({
          name: "Schedule fixture",
          description: "Synthetic schedule fixture",
          avatarSeed: "routine-due",
          avatarHue: null,
        }),
      ));
    const channels = new ChannelStore(database);
    const channel = channels.create("synthetic-cron-channel", {
      name: "Synthetic cron channel",
      title: "Synthetic cron fixture",
      instructions: "Synthetic instructions",
      members: [],
      leadAgentId: null,
    });
    channels.commit("synthetic-cron-create", { channel, messages: [], tasks: [], assignments: [] });
    assert.ok(channels.exists(channel.id));
    assert.equal(channels.get(channel.id).name, channel.name);
    const errors: string[] = [];
    conversation = new ConversationRuntime(
      store,
      () => {},
      () => store.list(),
    );
    const runtime = conversation;
    // The scheduler has no running host here. Each pass gets an explicit clock, so no timer races it.
    const timer = new RoutineTimer(
      () => [],
      () => false,
      (code) => errors.push(code),
    );
    const waits = new AgentWaits({
      store: new AgentWaitStore({ database }),
      mailbox,
      hooks: { emit: () => {}, ownsRoutine: () => true, hasRoutine: () => true, requireKnownAgent: () => {} },
    });
    const scheduler = new RoutineScheduler({
      store,
      mailbox,
      conversation: runtime,
      timer,
      waits,
      timezone: () => "UTC",
      hooks: {
        emit: () => {},
        emitError: (code) => errors.push(code),
        emitQueue: () => {},
        scheduleDrain: () => {},
        interrupt: () => Effect.void,
        awaitDrain: () => undefined,
        // Provider draining and snapshot delivery are outside this scheduler proof.
        syncMailboxMessages: () => {},
        listAgents: () => store.list(),
        excludedAgents: () => new Set(),
        isRunning: () => false,
        usageLimited: () => false,
      },
    });
    return {
      database,
      store,
      mailbox,
      conversation: runtime,
      timer,
      scheduler,
      runs: new AgentRoutineStore(database),
      agentId: agent.id,
      channelId: channel.id,
      channelRuns: new ChannelRoutineStore(database),
      errors,
      close() {
        timer.dispose();
        runtime.dispose();
        database.close();
      },
    };
  } catch (error) {
    conversation?.dispose();
    database.close();
    throw error;
  }
}

function input(fixture: Fixture, expression: string) {
  return {
    agentId: fixture.agentId,
    name: "Synthetic cron",
    instruction: "Synthetic cron instruction",
    active: true,
    timezone: "UTC",
    schedule: { kind: "custom", expression } as const,
  };
}

// Snapshot every table, including event and command receipts, to detect partial writes.
function persisted(fixture: Fixture): string {
  const db = fixture.database.connection;
  const tables = databaseRows(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all());
  return JSON.stringify(
    tables.map((row) => {
      const name = requiredStringColumn(row, "name");
      const quoted = name.replaceAll('"', '""');
      const rows = databaseRows(db.prepare(`SELECT * FROM "${quoted}"`).all()).map((value) => JSON.stringify(value));
      return { table: name, rows: rows.sort() };
    }),
  );
}

function totalChanges(fixture: Fixture): number {
  const row = fixture.database.connection.prepare("SELECT total_changes() AS changes").get();
  assert.ok(row && typeof row.changes === "number");
  return row.changes;
}

type Operation = "create" | "update" | "record create" | "record update";
const OPERATIONS: Operation[] = ["create", "update", "record create", "record update"];

function invalidWrite(fixture: Fixture, row: CaseResult, expression: string, operation: Operation): void {
  const target = operation.includes("update") ? fixture.runs.create(input(fixture, VALID[0] ?? ""), NOW) : null;
  const before = persisted(fixture);
  row.persistedBefore = digest(before);
  row.routinesBefore = fixture.runs.list(fixture.agentId).map(outcome);
  const changes = totalChanges(fixture);
  row.rejected = false;
  try {
    const fields = input(fixture, expression);
    if (operation === "create") fixture.runs.create(fields, NOW);
    else if (operation === "update") {
      assert.ok(target);
      fixture.runs.update(
        { agentId: fixture.agentId, routineId: target.id, name: "Must not persist", schedule: fields.schedule },
        NOW,
      );
    } else {
      fixture.runs.saveRecord(
        fixture.agentId,
        target?.id,
        { ...fields, name: "Must not persist", trigger: { kind: "schedule", schedule: fields.schedule } },
        NOW,
      );
    }
  } catch (error) {
    row.rejected = true;
    row.rejection = {
      name: error instanceof Error ? error.name : "Non-error",
      message: message(error),
      domainError: error instanceof RoutineInputError,
    };
  }
  const after = persisted(fixture);
  row.persistedAfter = digest(after);
  row.unchanged = before === after;
  row.routinesAfter = fixture.runs.list(fixture.agentId).map(outcome);
  row.attemptedWriteCount = totalChanges(fixture) - changes;
  // Report all outcomes before checking them. A failure must not skip other cases.
  assert.ok(row.rejected, "Invalid schedule must be rejected by the domain store.");
  assert.ok(row.rejection?.domainError, "Rejection must be a RoutineInputError.");
  assert.ok(row.unchanged, "Rejected input must leave all stored data unchanged.");
  assert.equal(row.attemptedWriteCount, 0, "Rejected input must not attempt database writes.");
}

async function delivery(fixture: Fixture, row: CaseResult, routine: Routine, expectedNext: string): Promise<void> {
  const due = routine.trigger.nextRunAt;
  assert.equal(due, "2035-01-01T00:10:00.000Z");
  // Await the real scheduler pass and committed mailbox writes, without a provider drain or sleeps.
  await runCauseEffect(fixture.scheduler.processDue(new Date(due)));
  const runs = fixture.runs.listRuns(fixture.agentId, routine.id);
  const messages = fixture.mailbox
    .conversationMessages(fixture.agentId)
    .filter((entry) => entry.routine?.routineId === routine.id);
  assert.equal(runs.length, 1);
  assert.equal(messages.length, 1);
  const run = runs[0];
  assert.ok(run?.deliveryId);
  assert.equal(run.scheduledFor, due);
  assert.equal(run.instruction, routine.instruction);
  assert.equal(messages[0]?.text, routine.instruction);
  assert.ok(fixture.mailbox.queuedDeliveryIds(fixture.agentId).includes(run.deliveryId));
  const current = fixture.runs.get(fixture.agentId, routine.id);
  assert.equal(current?.trigger.nextRunAt, expectedNext);
  row.delivered = { runId: run.id, deliveryId: run.deliveryId, scheduledFor: due, nextRunAt: expectedNext };
  await runCauseEffect(fixture.scheduler.processDue(new Date(due)));
  assert.equal(fixture.runs.listRuns(fixture.agentId, routine.id).length, 1);
  assert.equal(
    fixture.mailbox.conversationMessages(fixture.agentId).filter((entry) => entry.routine?.routineId === routine.id)
      .length,
    1,
  );
  assert.deepEqual(fixture.errors, []);
}

async function validControl(fixture: Fixture, row: CaseResult, expression: string): Promise<void> {
  let routine = fixture.runs.create(input(fixture, expression), NOW);
  routine = fixture.runs.update(
    { agentId: fixture.agentId, routineId: routine.id, schedule: { kind: "custom", expression: "10,30 * * * *" } },
    NOW,
  );
  routine = fixture.runs.update(
    { agentId: fixture.agentId, routineId: routine.id, schedule: { kind: "custom", expression } },
    NOW,
  );
  const loaded = fixture.runs.get(fixture.agentId, routine.id);
  assert.deepEqual(loaded, routine);
  row.loaded = outcome(routine);
  await delivery(
    fixture,
    row,
    routine,
    expression === "0,10 * * * *" ? "2035-01-01T01:00:00.000Z" : "2035-01-01T00:20:00.000Z",
  );
}

async function legacyControl(fixture: Fixture, row: CaseResult, expression: string): Promise<void> {
  const routine = fixture.runs.create(input(fixture, "*/10 * * * *"), NOW);
  // This is a released row fixture, not a new invalid create. Only its stored schedule is replaced.
  fixture.database.connection
    .prepare("UPDATE projection_routine_triggers SET schedule_json = ? WHERE routine_id = ?")
    .run(JSON.stringify({ kind: "custom", expression }), routine.id);
  fixture.database.close();
  await runCauseEffect(fixture.database.initialize());
  // Reinitialize closes and reopens the real SQLite file. Reads must preserve the released expression.
  const loaded = fixture.runs.list(fixture.agentId).find((entry) => entry.id === routine.id);
  assert.ok(loaded);
  row.loaded = outcome(loaded);
  assert.deepEqual(loaded.trigger.schedule, { kind: "custom", expression });
  assert.equal(loaded.trigger.id, routine.trigger.id);
  const edited = fixture.runs.update(
    {
      agentId: fixture.agentId,
      routineId: routine.id,
      name: "Edited legacy cron",
      instruction: "Edited synthetic instruction",
    },
    NOW,
  );
  row.edited = outcome(edited);
  assert.equal(edited.name, "Edited legacy cron");
  assert.equal(edited.instruction, "Edited synthetic instruction");
  assert.deepEqual(edited.trigger, loaded.trigger);
  assert.deepEqual(fixture.runs.get(fixture.agentId, routine.id), edited);
  const expectedNext = RELEASED_NEXT_RUN[expression];
  assert.ok(expectedNext, "Each released stored case needs its next run.");
  await delivery(fixture, row, edited, expectedNext);
}

function channelInput(fixture: Fixture, expression: string) {
  const { agentId: _agentId, ...fields } = input(fixture, expression);
  return { ...fields, channelId: fixture.channelId };
}

function invalidChannelWrite(fixture: Fixture, row: CaseResult, expression: string, operation: Operation): void {
  const runs = fixture.channelRuns;
  const target = operation.includes("update") ? runs.create(channelInput(fixture, VALID[0] ?? ""), NOW) : null;
  const before = persisted(fixture);
  row.persistedBefore = digest(before);
  row.routinesBefore = runs.list(fixture.channelId).map(outcome);
  const changes = totalChanges(fixture);
  row.rejected = false;
  try {
    const fields = channelInput(fixture, expression);
    if (operation === "create") runs.create(fields, NOW);
    else if (operation === "update") {
      assert.ok(target);
      runs.update(
        { channelId: fixture.channelId, routineId: target.id, name: "Must not persist", schedule: fields.schedule },
        NOW,
      );
    } else {
      runs.saveRecord(
        fixture.channelId,
        target?.id,
        { ...fields, name: "Must not persist", trigger: { kind: "schedule", schedule: fields.schedule } },
        NOW,
      );
    }
  } catch (error) {
    row.rejected = true;
    row.rejection = {
      name: error instanceof Error ? error.name : "Non-error",
      message: message(error),
      domainError: error instanceof RoutineInputError,
    };
  }
  const after = persisted(fixture);
  row.persistedAfter = digest(after);
  row.unchanged = before === after;
  row.attemptedWriteCount = totalChanges(fixture) - changes;
  row.routinesAfter = runs.list(fixture.channelId).map(outcome);
  assert.ok(row.rejected, "Invalid schedule must be rejected by the channel domain store.");
  assert.ok(row.rejection?.domainError, "Rejection must be a RoutineInputError.");
  assert.ok(row.unchanged, "Rejected input must leave all stored data unchanged.");
  assert.equal(row.attemptedWriteCount, 0, "Rejected input must not attempt database writes.");
}

function validChannelControl(fixture: Fixture, row: CaseResult, expression: string): void {
  const runs = fixture.channelRuns;
  let routine = runs.create(channelInput(fixture, expression), NOW);
  routine = runs.update(
    { channelId: fixture.channelId, routineId: routine.id, schedule: { kind: "custom", expression: "10,30 * * * *" } },
    NOW,
  );
  routine = runs.update(
    { channelId: fixture.channelId, routineId: routine.id, schedule: { kind: "custom", expression } },
    NOW,
  );
  assert.deepEqual(runs.get(fixture.channelId, routine.id), routine);
  row.loaded = outcome(routine);
  assert.equal(routine.trigger.nextRunAt, "2035-01-01T00:10:00.000Z");
  // Exercise valid record create and changed schedule saves at the same domain boundary.
  const fields = channelInput(fixture, expression);
  const record = runs.saveRecord(
    fixture.channelId,
    undefined,
    { ...fields, trigger: { kind: "schedule", schedule: fields.schedule } },
    NOW,
  );
  const edited = runs.saveRecord(
    fixture.channelId,
    record.id,
    { ...fields, trigger: { kind: "schedule", schedule: { kind: "custom", expression: "10,30 * * * *" } } },
    NOW,
  );
  assert.equal(edited.id, record.id);
  const loaded = runs.get(fixture.channelId, record.id);
  assert.ok(loaded);
  assert.deepEqual(loaded.trigger.schedule, { kind: "custom", expression: "10,30 * * * *" });
  row.edited = outcome(loaded);
}

async function legacyChannelControl(fixture: Fixture, row: CaseResult, expression: string): Promise<void> {
  const runs = fixture.channelRuns;
  const routine = runs.create(channelInput(fixture, VALID[0] ?? ""), NOW);
  fixture.database.connection
    .prepare("UPDATE projection_channel_routine_triggers SET schedule_json = ? WHERE routine_id = ?")
    .run(JSON.stringify({ kind: "custom", expression }), routine.id);
  fixture.database.close();
  await runCauseEffect(fixture.database.initialize());
  const loaded = runs.list(fixture.channelId).find((entry) => entry.id === routine.id);
  assert.ok(loaded);
  row.loaded = outcome(loaded);
  assert.deepEqual(loaded.trigger.schedule, { kind: "custom", expression });
  assert.equal(loaded.trigger.id, routine.trigger.id);
  assert.equal(loaded.trigger.nextRunAt, "2035-01-01T00:10:00.000Z");
  const edited = runs.update(
    {
      channelId: fixture.channelId,
      routineId: routine.id,
      name: "Edited legacy cron",
      instruction: "Edited synthetic instruction",
    },
    NOW,
  );
  row.edited = outcome(edited);
  assert.equal(edited.name, "Edited legacy cron");
  assert.equal(edited.instruction, "Edited synthetic instruction");
  assert.deepEqual(edited.trigger, loaded.trigger);
  assert.deepEqual(runs.get(fixture.channelId, routine.id), edited);
  // The released parser still finds the stored occurrence without channel execution.
  const due = runs.due(new Date(loaded.trigger.nextRunAt));
  assert.equal(due.length, 1);
  assert.equal(due[0]?.routine.id, routine.id);
  assert.deepEqual(due[0]?.schedule, loaded.trigger.schedule);
}

async function runCase(name: string, work: (fixture: Fixture, row: CaseResult) => Promise<void>): Promise<void> {
  const row: CaseResult = { name, passed: false, teardown: { closed: false, removed: false } };
  cases.push(row);
  let root: string | undefined;
  let fixture: Fixture | undefined;
  try {
    root = await mkdtemp(join(tmpdir(), "openbot-cron-syntax-"));
    roots.push(root);
    fixture = await openFixture(root);
    await work(fixture, row);
    assert.equal(fixture.database.connection.prepare("PRAGMA quick_check").get()?.quick_check, "ok");
    row.passed = true;
  } catch (error) {
    row.error = message(error);
  } finally {
    try {
      fixture?.close();
      if (row.teardown) row.teardown.closed = true;
    } catch (error) {
      row.passed = false;
      if (row.teardown) row.teardown.error = message(error);
    }
    try {
      if (root) {
        await rm(root, { recursive: true, force: true });
        const remaining = await stat(root).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
            return false;
          },
        );
        assert.equal(remaining, false);
      }
      if (row.teardown) row.teardown.removed = true;
    } catch (error) {
      row.passed = false;
      if (row.teardown) row.teardown.error = message(error);
    }
  }
  process.stdout.write(`${row.passed ? "PASS" : "FAIL"} ${name}\n`);
}

const phaseArgument = process.argv.find((value) => value.startsWith("--phase="));
const requestedPhase = phaseArgument?.slice("--phase=".length) ?? "before";
const phase = /^[a-zA-Z0-9_-]+$/.test(requestedPhase) ? requestedPhase : "invalid-phase";
const out = join(ROOT, ".openbot-build", "routine-cron-syntax-e2e", phase);
try {
  assert.notEqual(phase, "invalid-phase", "Phase must be a folder name.");
  for (const path of SOURCES) {
    hashes.push({
      path,
      sha256: createHash("sha256")
        .update(await readFile(join(ROOT, path)))
        .digest("hex"),
    });
  }
  for (const expression of INVALID) {
    for (const operation of OPERATIONS) {
      await runCase(`channel ${operation}: ${expression}`, async (fixture, row) =>
        invalidChannelWrite(fixture, row, expression, operation),
      );
      await runCase(`${operation}: ${expression}`, async (fixture, row) =>
        invalidWrite(fixture, row, expression, operation),
      );
    }
  }
  for (const expression of VALID) {
    await runCase(`channel valid: ${expression}`, async (fixture, row) =>
      validChannelControl(fixture, row, expression),
    );
    await runCase(`valid: ${expression}`, (fixture, row) => validControl(fixture, row, expression));
  }
  for (const expression of INVALID) {
    await runCase(`channel released stored: ${expression}`, (fixture, row) =>
      legacyChannelControl(fixture, row, expression),
    );
    await runCase(`released stored: ${expression}`, (fixture, row) => legacyControl(fixture, row, expression));
  }
} catch (error) {
  fatal = message(error);
} finally {
  const expectedCases = 2 * (INVALID.length * (OPERATIONS.length + 1) + VALID.length);
  const passed = !fatal && cases.length === expectedCases && cases.every((row) => row.passed);
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, "report.json"),
    `${safe(JSON.stringify({ phase, passed, fatal, sources: hashes, expectedCases, cases }, null, 2))}\n`,
    { mode: 0o600 },
  );
  process.stdout.write(`${passed ? "PASS" : "FAIL"}: .openbot-build/routine-cron-syntax-e2e/${phase}/report.json\n`);
  if (!passed) process.exitCode = 1;
}
