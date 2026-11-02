// Checks pause and resume of a routine on the real scheduler, SQLite stores and mailbox. Each request
// goes through the real IPC decoder (`parseUpdateRoutine`) into `RoutineScheduler.update`. The clock
// is moved with `setSystemTime`, because resume computes the next occurrence from the real clock.
// Each scheduler pass gets an explicit clock, so no timer races it. No provider, account or network
// is started: a queued delivery is cancelled to end its run, as a user does in the queue.
// Run: `bun scripts/routine-pause-resume-e2e.ts`.
// Writes .openbot-build/routine-pause-resume-e2e/report.json.

import { setSystemTime } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentEvent, Routine, UpdateRoutineInput } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { RoutineScheduler } from "../src/backend/agent/routine-scheduler";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { AgentStore } from "../src/backend/agent-store";
import { AgentWaitStore } from "../src/backend/agent-waits/agent-wait-store";
import { AgentWaits } from "../src/backend/agent-waits/agent-waits";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { RoutineTimer } from "../src/backend/routine-timer";
import { parseCreateRoutine, parseUpdateRoutine } from "../src/main/ipc/agent-inputs";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "routine-pause-resume-e2e");
const STEP_DEADLINE_MS = 15_000;
const DAY = "2031-03-03";
const at = (time: string) => new Date(`${DAY}T${time}:00.000Z`);

interface Fixture {
  database: OpenBotDatabase;
  mailbox: MailboxStore;
  scheduler: RoutineScheduler;
  runs: AgentRoutineStore;
  agentId: string;
  events: AgentEvent[];
  errors: string[];
  close(): void;
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
          name: "Pause fixture",
          description: "Synthetic pause fixture",
          avatarSeed: "routine-pause",
          avatarHue: null,
        }),
      ));
    const events: AgentEvent[] = [];
    const errors: string[] = [];
    conversation = new ConversationRuntime(
      store,
      () => {},
      () => store.list(),
    );
    const runtime = conversation;
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
        emit: (event) => events.push(event),
        emitError: (code) => errors.push(code),
        emitQueue: () => {},
        scheduleDrain: () => {},
        interrupt: () => Effect.void,
        awaitDrain: () => undefined,
        syncMailboxMessages: () => {},
        listAgents: () => store.list(),
        excludedAgents: () => new Set(),
        isRunning: () => false,
        usageLimited: () => false,
      },
    });
    return {
      database,
      mailbox,
      scheduler,
      runs: new AgentRoutineStore(database),
      agentId: agent.id,
      events,
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

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; steps: Step[] } = { passed: false, steps: [] };

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    // A bound on failure only: each check awaits its own operation.
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`No result within ${STEP_DEADLINE_MS} ms.`)), STEP_DEADLINE_MS);
      }),
    ]);
    report.steps.push({ name, passed: true, detail: value });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

const root = await mkdtemp(join(tmpdir(), "openbot-routine-pause-"));
let fixture: Fixture | undefined;

function current(): Fixture {
  assert.ok(fixture, "The fixture is open.");
  return fixture;
}

function routine(id: string): Routine {
  const found = current()
    .scheduler.list(current().agentId)
    .find((row) => row.id === id);
  assert.ok(found, "The routine exists.");
  return found;
}

function deliveries(id: string): number {
  return current()
    .mailbox.conversationMessages(current().agentId)
    .filter((message) => message.routine?.routineId === id).length;
}

function runs(id: string): Array<{ scheduledFor: string }> {
  return current().runs.listRuns(current().agentId, id, 50, true);
}

/** Saves a change as the renderer sends it, through the IPC decoder. */
function update(fields: Omit<UpdateRoutineInput, "agentId">): Routine {
  return current().scheduler.update(parseUpdateRoutine({ agentId: current().agentId, ...fields }), {
    recordConversationEvent: false,
  });
}

/** Ends the queued routine runs, as a user who cancels them in the queue. */
async function cancelQueued(): Promise<void> {
  const { mailbox, agentId } = current();
  for (const deliveryId of mailbox.queuedDeliveryIds(agentId))
    await runCauseEffect(mailbox.cancel(agentId, deliveryId));
}

async function pass(now: Date): Promise<void> {
  await runCauseEffect(current().scheduler.processDue(now));
}

try {
  let cronId = "";

  await step("Create a recurring routine that queues work when it is due", async () => {
    setSystemTime(at("10:01"));
    fixture = await openFixture(root);
    const created = current().scheduler.create(
      parseCreateRoutine({
        agentId: current().agentId,
        name: "Quarter-hour report",
        instruction: "Write the quarter-hour report.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "custom", expression: "*/15 * * * *" },
        missedPolicy: "run-once",
      }),
      { recordConversationEvent: false },
    );
    cronId = created.id;
    assert.equal(created.trigger.nextRunAt, at("10:15").toISOString());
    await pass(at("10:15"));
    assert.equal(deliveries(cronId), 1);
    assert.equal(runs(cronId).length, 1);
    assert.equal(routine(cronId).trigger.nextRunAt, at("10:30").toISOString());
    await cancelQueued();
    return { nextRunAt: routine(cronId).trigger.nextRunAt, deliveries: deliveries(cronId) };
  });

  await step("The decoder refuses a pause that is not a boolean", async () => {
    assert.throws(
      () => parseUpdateRoutine({ agentId: current().agentId, routineId: cronId, active: "false" }),
      /active must be a boolean/,
    );
    assert.equal(routine(cronId).active, true);
    return { active: routine(cronId).active };
  });

  await step("Pause stops due occurrences", async () => {
    setSystemTime(at("10:16"));
    const before = current().events.length;
    const paused = update({ routineId: cronId, active: false });
    assert.equal(paused.active, false);
    assert.ok(
      current()
        .events.slice(before)
        .some((event) => event.type === "routines-changed" && event.agentId === current().agentId),
      "Pause reports the change to the renderer.",
    );
    // Four occurrences come due while the routine is paused.
    setSystemTime(at("11:20"));
    await pass(at("11:20"));
    assert.equal(deliveries(cronId), 1);
    assert.equal(runs(cronId).length, 1);
    assert.deepEqual(current().errors, []);
    return { active: routine(cronId).active, deliveries: deliveries(cronId), runs: runs(cronId).length };
  });

  await step("The pause survives a restart", async () => {
    current().close();
    fixture = undefined;
    fixture = await openFixture(root);
    // The application start order: skip missed work, then process what is due.
    current().scheduler.skipMissed(new Date());
    await runCauseEffect(current().scheduler.resumePendingRuns());
    await pass(at("11:20"));
    assert.equal(routine(cronId).active, false);
    assert.equal(deliveries(cronId), 1);
    assert.equal(runs(cronId).length, 1);
    return { active: routine(cronId).active, deliveries: deliveries(cronId) };
  });

  await step("Resume runs at the next occurrence and does not replay the paused time", async () => {
    const before = current().events.length;
    const resumed = update({ routineId: cronId, active: true });
    assert.equal(resumed.active, true);
    assert.equal(resumed.missedPolicy, "run-once", "The routine asks to replay one missed run.");
    assert.equal(resumed.trigger.nextRunAt, at("11:30").toISOString());
    assert.ok(
      current()
        .events.slice(before)
        .some((event) => event.type === "routines-changed"),
    );
    await pass(at("11:20"));
    assert.equal(deliveries(cronId), 1, "The paused time is not replayed.");
    assert.equal(runs(cronId).length, 1);
    setSystemTime(at("11:30"));
    await pass(at("11:30"));
    assert.equal(deliveries(cronId), 2);
    const scheduled = runs(cronId).map((run) => run.scheduledFor);
    assert.ok(scheduled.includes(at("11:30").toISOString()));
    assert.equal(routine(cronId).trigger.nextRunAt, at("11:45").toISOString());
    await cancelQueued();
    assert.deepEqual(current().errors, []);
    return { nextRunAt: routine(cronId).trigger.nextRunAt, scheduled };
  });

  await step("A paused one-time routine past its time needs a new time to resume", async () => {
    setSystemTime(at("11:31"));
    const once = current().scheduler.create(
      parseCreateRoutine({
        agentId: current().agentId,
        name: "One reminder",
        instruction: "Send the one reminder.",
        active: true,
        timezone: "UTC",
        schedule: { kind: "once", date: DAY, time: "11:40" },
      }),
      { recordConversationEvent: false },
    );
    update({ routineId: once.id, active: false });
    setSystemTime(at("12:00"));
    await pass(at("12:00"));
    assert.equal(deliveries(once.id), 0, "A paused one-time routine does not run at its time.");
    const refusal = (() => {
      try {
        update({ routineId: once.id, active: true });
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      return undefined;
    })();
    assert.ok(refusal, "Resume without a new time is refused.");
    assert.equal(routine(once.id).active, false);
    const resumed = update({ routineId: once.id, active: true, schedule: { kind: "once", date: DAY, time: "12:15" } });
    assert.equal(resumed.trigger.nextRunAt, at("12:15").toISOString());
    setSystemTime(at("12:15"));
    await pass(at("12:15"));
    assert.equal(deliveries(once.id), 1);
    await pass(at("12:15"));
    assert.equal(deliveries(once.id), 1, "A second pass does not repeat the one-time run.");
    assert.equal(routine(once.id).active, false, "A one-time routine ends after its run.");
    assert.deepEqual(current().errors, []);
    return { refusal, deliveries: deliveries(once.id), activeAfterRun: routine(once.id).active };
  });

  report.passed = true;
} finally {
  setSystemTime();
  fixture?.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}
