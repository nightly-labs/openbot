// Checks the move of a routine to a new time zone, as the desktop prompt does after the device zone
// changed. Each save goes through the real IPC decoder (`parseSaveEventRoutine`) into
// `RoutineScheduler.saveRecord` on the real SQLite stores. The clock is moved with `setSystemTime`.
// No provider, account or network is started: a queued delivery is cancelled to end its run.
// Run: `bun scripts/routine-timezone-move-e2e.ts`.
// Writes .openbot-build/routine-timezone-move-e2e/report.json.

import { setSystemTime } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Routine, RoutineSchedule } from "@openbot/contracts/ipc";
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
