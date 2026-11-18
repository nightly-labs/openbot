// Checks the move of a routine to a new time zone, as the desktop prompt does after the device zone
// changed. Each save goes through the real IPC decoder (`parseSaveEventRoutine`) into
// `RoutineScheduler.saveRecord` on the real SQLite stores. The clock is moved with `setSystemTime`.
// Also exercises single and bulk timezone edits through the real dynamic routine tools.
// No provider, account or network is started: a queued delivery is cancelled to end its run.
// Run: `bun scripts/routine-timezone-move-e2e.ts`.
// Writes .openbot-build/routine-timezone-move-e2e/report.json.

import { setSystemTime } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isRoutine, type Routine, type RoutineSchedule } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { z } from "zod";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { RoutineScheduler } from "../src/backend/agent/routine-scheduler";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { AgentStore } from "../src/backend/agent-store";
import { AgentThreadStore } from "../src/backend/agent-threads/agent-thread-store";
import { AgentWaitStore } from "../src/backend/agent-waits/agent-wait-store";
import { AgentWaits } from "../src/backend/agent-waits/agent-waits";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { OPENBOT_TOOL_DEFINITIONS } from "../src/backend/openbot-tools";
import { decodeRecordResponse, isRecord } from "../src/backend/protocol";
import { RoutineTimer } from "../src/backend/routine-timer";
import { parseSaveEventRoutine } from "../src/main/host-events-inputs";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "routine-timezone-move-e2e");
const STEP_DEADLINE_MS = 15_000;
// In March 2031 Cairo is UTC+2 and Istanbul is UTC+3.
const FROM = "Africa/Cairo";
const TO = "Europe/Istanbul";
const at = (day: string, time: string) => new Date(`2031-03-${day}T${time}:00.000Z`);

const root = await mkdtemp(join(tmpdir(), "openbot-routine-timezone-"));
const database = new OpenBotDatabase(join(root, "state"));
const store = new AgentStore(join(root, "state"), join(root, "home"), database);
const mailbox = new MailboxStore(join(root, "state"), store.sharedRoot, database);
const conversation = new ConversationRuntime(
  store,
  () => {},
  () => store.list(),
);
const errors: string[] = [];
const timer = new RoutineTimer(
  () => [],
  () => false,
  (code) => errors.push(code),
);
const scheduler = new RoutineScheduler({
  store,
  mailbox,
  conversation,
  timer,
  waits: new AgentWaits({
    store: new AgentWaitStore({ database }),
    mailbox,
    hooks: { emit: () => {}, ownsRoutine: () => true, hasRoutine: () => true, requireKnownAgent: () => {} },
  }),
  timezone: () => "UTC",
  hooks: {
    emit: () => {},
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
    routineThread: () => null,
    routineDeleted: () => Effect.void,
  },
});
const runStore = new AgentRoutineStore(database);

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

let agentId = "";

function routine(id: string): Routine {
  const found = scheduler.list(agentId).find((row) => row.id === id);
  assert.ok(found, "The routine exists.");
  return found;
}

function runCount(id: string): number {
  return runStore.listRuns(agentId, id, 50, true).length;
}

/** Saves a routine as the desktop prompt sends it, through the IPC decoder. */
function save(id: string | undefined, timezone: string, name: string, schedule: RoutineSchedule) {
  const input = parseSaveEventRoutine({
    ...(id === undefined ? {} : { id }),
    owner: { kind: "agent", id: agentId },
    name,
    instruction: `Run ${name}.`,
    active: true,
    timezone,
    trigger: { kind: "schedule", schedule },
  });
  return scheduler.saveRecord(agentId, input.id, {
    name: input.name,
    instruction: input.instruction,
    active: input.active,
    timezone: input.timezone,
    trigger: { kind: "schedule", schedule },
  });
}

async function cancelQueued(): Promise<void> {
  for (const deliveryId of mailbox.queuedDeliveryIds(agentId))
    await runCauseEffect(mailbox.cancel(agentId, deliveryId));
}

async function tool(
  name: string,
  args: unknown,
  success = true,
  threadId = "timezone-fixture",
): Promise<DynamicRecord> {
  if (success) {
    const definition = OPENBOT_TOOL_DEFINITIONS.find((entry) => entry.name === name);
    assert.ok(definition, `${name} is advertised to the model.`);
    const parsed = z.strictObject(definition.shape).safeParse(args);
    assert.ok(parsed.success, parsed.error?.message);
  }
  const response = await runCauseEffect(
    scheduler.handleTool(
      {
        namespace: "openbot",
        tool: name,
        arguments: args,
        threadId,
        turnId: "timezone-turn",
        callId: name,
      },
      agentId,
      () => true,
    ),
  );
  assert.ok(response, `${name} is handled.`);
  const text = response.contentItems[0]?.text;
  assert.ok(text);
  assert.equal(response.success, success, text);
  return decodeRecordResponse(JSON.parse(text));
}

try {
  let dailyId = "";

  await step("A daily 09:00 routine runs at 09:00 in its first zone", async () => {
    setSystemTime(at("03", "06:30"));
    await runCauseEffect(store.initialize());
    await runCauseEffect(mailbox.initialize());
    const agent = await runCauseEffect(
      store.createAgent({
        name: "Zone fixture",
        description: "Synthetic zone fixture",
        avatarSeed: "zone",
        avatarHue: null,
      }),
    );
    agentId = agent.id;
    dailyId = save(undefined, FROM, "Morning brief", { kind: "daily", time: "09:00" }).id;
    assert.equal(routine(dailyId).trigger.nextRunAt, at("03", "07:00").toISOString());
    setSystemTime(at("03", "07:00"));
    await runCauseEffect(scheduler.processDue(at("03", "07:00")));
    assert.equal(runCount(dailyId), 1);
    await cancelQueued();
    return { nextRunAt: routine(dailyId).trigger.nextRunAt, runs: runCount(dailyId) };
  });

  await step("The move keeps the ID and runs and keeps the clock time in the new zone", async () => {
    setSystemTime(at("03", "07:10"));
    const moved = save(dailyId, TO, "Morning brief", { kind: "daily", time: "09:00" });
    assert.equal(moved.id, dailyId);
    assert.equal(routine(dailyId).timezone, TO);
    assert.equal(runCount(dailyId), 1, "The move keeps the run history.");
    assert.equal(routine(dailyId).trigger.nextRunAt, at("04", "06:00").toISOString());
    setSystemTime(at("04", "06:00"));
    await runCauseEffect(scheduler.processDue(at("04", "06:00")));
    assert.equal(runCount(dailyId), 2, "The next run is at 09:00 in the new zone.");
    await cancelQueued();
    assert.deepEqual(errors, []);
    return { timezone: routine(dailyId).timezone, nextRunAt: routine(dailyId).trigger.nextRunAt };
  });

  await step("A one-time run that is already past in the new zone is refused and keeps its zone", async () => {
    setSystemTime(at("05", "06:00"));
    const once = save(undefined, FROM, "One reminder", { kind: "once", date: "2031-03-05", time: "09:30" });
    // 09:30 in Istanbul is 06:30 UTC; 09:30 in Cairo is 07:30 UTC.
    setSystemTime(at("05", "07:00"));
    assert.throws(() => save(once.id, TO, "One reminder", { kind: "once", date: "2031-03-05", time: "09:30" }));
    assert.equal(routine(once.id).timezone, FROM);
    assert.equal(routine(once.id).trigger.nextRunAt, at("05", "07:30").toISOString());
    return { timezone: routine(once.id).timezone, nextRunAt: routine(once.id).trigger.nextRunAt };
  });

  await step("The update tool changes timezone and keeps ID, history, clock time and pause state", async () => {
    setSystemTime(at("05", "07:10"));
    const before = routine(dailyId);
    const runs = runCount(dailyId);
    const result = await tool("update_routine", { routineId: dailyId, timezone: FROM });
    assert.ok(isRoutine(result));
    assert.equal(result.id, dailyId);
    assert.equal(result.createdAt, before.createdAt);
    assert.deepEqual(result.trigger.schedule, before.trigger.schedule);
    assert.equal(result.trigger.nextRunAt, at("06", "07:00").toISOString());
    assert.equal(runCount(dailyId), runs);
    assert.equal(result.active, before.active);
    assert.equal(result.timezone, FROM);
    assert.ok(
      conversation
        .snapshot(agentId)
        ?.messages.some((message) => message.turnId === "timezone-turn" && message.text === result.name),
      "The change card belongs to the tool's turn.",
    );
    return { id: result.id, timezone: result.timezone, runs };
  });

  await step("An omitted or unchanged timezone leaves the trigger intact", async () => {
    const before = routine(dailyId);
    await tool("update_routine", { routineId: dailyId, name: "Renamed morning brief" });
    assert.deepEqual(routine(dailyId).trigger, before.trigger);
    await tool("update_routine", { routineId: dailyId, timezone: before.timezone });
    assert.deepEqual(routine(dailyId).trigger, before.trigger);
    assert.equal(routine(dailyId).timezone, before.timezone);
  });

  await step("Invalid timezones and a one-time move into the past fail without changes", async () => {
    const before = routine(dailyId);
    for (const timezone of ["Invalid/Timezone", "", null, 42, "x".repeat(129)]) {
      await tool("update_routine", { routineId: dailyId, timezone }, false);
      assert.deepEqual(routine(dailyId), before);
    }
    const once = scheduler.list(agentId).find((entry) => entry.name === "One reminder");
    assert.ok(once);
    await tool("update_routine", { routineId: once.id, timezone: TO }, false);
    assert.deepEqual(routine(once.id), once);
  });

  await step("A paused one-time routine stays paused even when its new local time is past", async () => {
    const once = scheduler.list(agentId).find((entry) => entry.name === "One reminder");
    assert.ok(once);
    await tool("update_routine", { routineId: once.id, active: false });
    const result = await tool("update_routine", { routineId: once.id, timezone: TO });
    assert.ok(isRoutine(result));
    assert.equal(result.active, false);
    assert.equal(result.id, once.id);
    assert.equal(result.timezone, TO);
    assert.deepEqual(result.trigger.schedule, once.trigger.schedule);
  });

  await step("Changing an interval timezone keeps its absolute anchor and next occurrence", async () => {
    const schedule: RoutineSchedule = {
      kind: "interval",
      amount: 1,
      unit: "hours",
      anchorAt: at("05", "07:00").toISOString(),
    };
    const interval = save(undefined, FROM, "Interval fixture", schedule);
    assert.ok(interval.trigger.kind === "schedule");
    await tool("update_routine", { routineId: interval.id, timezone: "America/Winnipeg" });
    assert.deepEqual(routine(interval.id).trigger.schedule, schedule);
    assert.equal(routine(interval.id).trigger.nextRunAt, interval.trigger.nextRunAt);
  });

  await step("Bulk changes preserve each routine's schedule and pause state across agents", async () => {
    await tool("update_routine", { routineId: dailyId, active: false });
    const secondAgent = await runCauseEffect(
      store.createAgent({
        name: "Second zone fixture",
        description: "Synthetic timezone fixture",
        avatarSeed: "zone-second",
        avatarHue: null,
      }),
    );
    const secondRoutine = scheduler.create({
      agentId: secondAgent.id,
      name: "Second morning",
      instruction: "Synthetic instruction.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "10:00" },
    });
    const before = routine(dailyId);
    const result = await tool("update_routine_timezones", {
      timezone: TO,
      routines: [{ routineId: dailyId }, { agentId: secondAgent.id, routineId: secondRoutine.id }],
    });
    assert.equal(result.updated, 2);
    assert.equal(result.failed, 0);
    assert.equal(routine(dailyId).active, false);
    assert.deepEqual(routine(dailyId).trigger.schedule, before.trigger.schedule);
    const secondSaved = scheduler.list(secondAgent.id).find((entry) => entry.id === secondRoutine.id);
    assert.ok(secondSaved);
    assert.equal(secondSaved.timezone, TO);
    assert.equal(secondSaved.active, true);
    assert.deepEqual(secondSaved.trigger.schedule, secondRoutine.trigger.schedule);
    assert.equal(secondSaved.trigger.nextRunAt, at("06", "07:00").toISOString());
    return { updated: result.updated, failed: result.failed };
  });

  await step("Bulk edits report missing routines and agents and continue after each failure", async () => {
    const result = await tool("update_routine_timezones", {
      timezone: FROM,
      routines: [
        { routineId: "missing-routine" },
        { agentId: "missing-agent", routineId: dailyId },
        { routineId: dailyId },
      ],
    });
    assert.equal(result.updated, 1);
    assert.equal(result.failed, 2);
    assert.ok(Array.isArray(result.results));
    assert.equal(result.results.length, 3);
    assert.deepEqual(
      result.results.map((entry) => {
        assert.ok(isRecord(entry));
        return { agentId: entry.agentId, routineId: entry.routineId, ok: entry.ok };
      }),
      [
        { agentId, routineId: "missing-routine", ok: false },
        { agentId: "missing-agent", routineId: dailyId, ok: false },
        { agentId, routineId: dailyId, ok: true },
      ],
    );
    assert.equal(routine(dailyId).timezone, FROM);
    return result;
  });

  await step("Malformed, duplicate and oversized bulk requests do not change any routine", async () => {
    const before = routine(dailyId);
    for (const routines of [
      [],
      [{ routineId: dailyId }, { agentId, routineId: dailyId }],
      [{ routineId: dailyId }, { routineId: 42 }],
      Array.from({ length: 101 }, (_, index) => ({ routineId: `synthetic-${index}` })),
    ]) {
      await tool("update_routine_timezones", { timezone: TO, routines }, false);
      assert.deepEqual(routine(dailyId), before);
    }
  });

  await step("Webhook and past one-time targets fail independently without changing their records", async () => {
    const webhook = scheduler.saveRecord(agentId, undefined, {
      name: "Webhook fixture",
      instruction: "Synthetic instruction.",
      active: false,
      timezone: "UTC",
      trigger: { kind: "webhook", eventType: null, filters: [], secretCiphertext: "synthetic-ciphertext" },
    });
    await tool("update_routine", { routineId: webhook.id, timezone: TO }, false);
    const once = scheduler.list(agentId).find((entry) => entry.name === "One reminder");
    assert.ok(once);
    await tool("update_routine", { routineId: once.id, timezone: FROM, active: true });
    const before = routine(once.id);
    const result = await tool("update_routine_timezones", {
      timezone: TO,
      routines: [{ routineId: webhook.id }, { routineId: once.id }, { routineId: dailyId }],
    });
    assert.equal(result.updated, 1);
    assert.equal(result.failed, 2);
    assert.deepEqual(scheduler.getRecord(agentId, webhook.id), webhook);
    assert.deepEqual(routine(once.id), before);
    assert.equal(routine(dailyId).timezone, TO);
  });

  await step("Single and bulk tool change cards stay in the calling side thread and turn", async () => {
    const thread = new AgentThreadStore(database).create({
      agentId,
      origin: "user",
      title: "Timezone task",
      titleSource: "auto",
    });
    conversation.registerTaskThread(agentId, thread.threadId);
    const mainMessages = structuredClone(conversation.snapshot(agentId)?.messages);
    await tool("update_routine", { routineId: dailyId, timezone: FROM }, true, thread.threadId);
    await tool("update_routine_timezones", { timezone: TO, routines: [{ routineId: dailyId }] }, true, thread.threadId);
    const messages = conversation.loadedExecutionSnapshot(thread.threadId)?.messages;
    assert.ok(messages);
    assert.equal(
      messages.filter((message) => message.turnId === "timezone-turn" && message.text === routine(dailyId).name).length,
      2,
    );
    assert.deepEqual(conversation.snapshot(agentId)?.messages, mainMessages);
  });

  await step("Changing timezone leaves the existing queued run and its delivery intact", async () => {
    const queued = await runCauseEffect(scheduler.test({ agentId, routineId: dailyId }));
    assert.ok(queued.deliveryId);
    const runs = runStore.listRuns(agentId, dailyId);
    const delivery = mailbox.getDelivery(queued.deliveryId);
    await tool("update_routine", { routineId: dailyId, timezone: FROM });
    assert.deepEqual(runStore.listRuns(agentId, dailyId), runs);
    assert.deepEqual(mailbox.getDelivery(queued.deliveryId), delivery);
    await cancelQueued();
  });

  await step("The edited daily clock follows the new timezone across spring DST", async () => {
    setSystemTime(new Date("2031-03-08T12:00:00.000Z"));
    const daily = save(undefined, "UTC", "DST fixture", { kind: "daily", time: "09:00" });
    await tool("update_routine", { routineId: daily.id, timezone: "America/New_York" });
    assert.equal(routine(daily.id).trigger.nextRunAt, "2031-03-08T14:00:00.000Z");
    setSystemTime(new Date("2031-03-08T14:00:00.000Z"));
    await runCauseEffect(scheduler.processDue(new Date()));
    assert.equal(routine(daily.id).trigger.nextRunAt, "2031-03-09T13:00:00.000Z");
    assert.equal(runCount(daily.id), 1);
    await cancelQueued();
    assert.deepEqual(errors, []);
  });

  report.passed = true;
} finally {
  setSystemTime();
  timer.dispose();
  conversation.dispose();
  database.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}
