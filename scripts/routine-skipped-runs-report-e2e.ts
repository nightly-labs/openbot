import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Routine, RoutineRun } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { deliveryPromptInput, type SkippedRoutineRuns } from "../src/backend/agent/delivery-content";
import { RoutineScheduler } from "../src/backend/agent/routine-scheduler";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { AgentStore } from "../src/backend/agent-store";
import { AgentWaitStore } from "../src/backend/agent-waits/agent-wait-store";
import { AgentWaits } from "../src/backend/agent-waits/agent-waits";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { RoutineTimer } from "../src/backend/routine-timer";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "routine-skipped-runs-report-e2e");
const STEP = 5 * 60_000;
const NOTE_START = "OpenBot note, not from the user:";
const RUN_OPEN_REASON = sourceText("status.agent.routineSkippedRunOpen");
const CLOSED_REASON = "Skipped: OpenBot was closed at the scheduled time.";

interface Fixture {
  store: AgentStore;
  mailbox: MailboxStore;
  scheduler: RoutineScheduler;
  runs: AgentRoutineStore;
  agentId: string;
  errors: string[];
  close(): void;
}

interface CaseDetails {
  skipped: SkippedRoutineRuns;
  note: string;
}

interface CaseResult {
  name: string;
  passed: boolean;
  details?: CaseDetails;
  error?: string;
}

const ownedRoots: string[] = [];
const cases: CaseResult[] = [];

async function openFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "openbot-routine-skipped-"));
  ownedRoots.push(root);
  const database = new OpenBotDatabase(join(root, "state"));
  const store = new AgentStore(join(root, "state"), join(root, "home"), database);
  const mailbox = new MailboxStore(join(root, "state"), store.sharedRoot, database);
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const agent = await runCauseEffect(
    store.createAgent({
      name: "Skipped runs fixture",
      description: "Synthetic routine fixture",
      avatarSeed: "routine-skipped",
      avatarHue: null,
    }),
  );
  const errors: string[] = [];
  const conversation = new ConversationRuntime(
    store,
    () => {},
    () => store.list(),
  );
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
    conversation,
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
      syncMailboxMessages: () => {},
      listAgents: () => store.list(),
      excludedAgents: () => new Set(),
      isRunning: () => false,
      usageLimited: () => false,
      routineThread: () => null,
      routineDeleted: () => Effect.void,
    },
  });
  return {
    store,
    mailbox,
    scheduler,
    runs: new AgentRoutineStore(database),
    agentId: agent.id,
    errors,
    close() {
      timer.dispose();
      conversation.dispose();
      database.close();
    },
  };
}

function everyFiveMinutes(fixture: Fixture): Routine {
  return fixture.scheduler.create(
    {
      agentId: fixture.agentId,
      name: "Publish match notes",
      instruction: "Publish the prepared match notes. Report only when something changed.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "custom", expression: "*/5 * * * *" },
      limitPolicy: "wait",
    },
    { recordConversationEvent: false },
  );
}

function deliveredRuns(fixture: Fixture, routine: Routine): RoutineRun[] {
  return fixture.runs
    .listRuns(fixture.agentId, routine.id, 50, false)
    .filter((run) => run.deliveryId !== null)
    .reverse();
}

function routineTaskText(fixture: Fixture, run: RoutineRun): string {
  assert.ok(run.deliveryId);
  const context = fixture.mailbox.getDelivery(run.deliveryId);
  assert.ok(context, "The run has a stored delivery.");
  const input = deliveryPromptInput(context, {
    agentNames: new Map(fixture.store.list().map((agent) => [agent.id, agent.name])),
    snapshot: { agentId: fixture.agentId, threadId: null, activeTurnId: null, revision: 0, messages: [] },
    routineRun: run,
    skippedRoutineRuns: fixture.scheduler.skippedBefore(run),
    routineTimezone: "UTC",
  });
  return input.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
}

function skipNote(text: string): string | null {
  return text.split("\n").find((line) => line.startsWith(NOTE_START)) ?? null;
}

async function skippedWhileRunOpen(): Promise<CaseDetails> {
  const fixture = await openFixture();
  try {
    const routine = everyFiveMinutes(fixture);
    const start = new Date(routine.trigger.nextRunAt);
    await runCauseEffect(fixture.scheduler.processDue(start));
    const [first] = deliveredRuns(fixture, routine);
    assert.ok(first, "The first occurrence starts a run.");
    for (let step = 1; step <= 6; step += 1) {
      await runCauseEffect(fixture.scheduler.processDue(new Date(start.getTime() + step * STEP)));
    }
    assert.equal(deliveredRuns(fixture, routine).length, 1, "No run starts while the first run is open.");
    fixture.runs.updateRunStatus(first.id, "succeeded");
    await runCauseEffect(fixture.scheduler.processDue(new Date(start.getTime() + 7 * STEP)));
    const second = deliveredRuns(fixture, routine)[1];
    assert.ok(second, "The next occurrence after the open run ends starts a run.");
    assert.ok(second.deliveryId);
    const firstNote = skipNote(routineTaskText(fixture, first));
    assert.equal(firstNote, null, "A run with no skips before it gets no note.");
    const skipped = fixture.scheduler.skippedBefore(second);
    assert.ok(skipped, "The skipped runs before the second run are found.");
    assert.deepEqual(skipped, { count: 6, reasons: [RUN_OPEN_REASON] });
    const note = skipNote(routineTaskText(fixture, second));
    assert.ok(note, "The run after the skips gets the skip note.");
    assert.match(note, /6 scheduled runs of this routine did not happen/);
    assert.ok(note.includes(RUN_OPEN_REASON), "The note gives the stored reason.");
    assert.match(note, /do not call the routine_no_update tool/);
    fixture.runs.updateRunStatus(second.id, "succeeded");
    await runCauseEffect(fixture.scheduler.processDue(new Date(start.getTime() + 8 * STEP)));
    const third = deliveredRuns(fixture, routine)[2];
    assert.ok(third?.deliveryId);
    assert.equal(fixture.scheduler.skippedBefore(third), null, "The skips are reported once.");
    assert.equal(skipNote(routineTaskText(fixture, third)), null);
    assert.deepEqual(fixture.errors, []);
    return { skipped, note };
  } finally {
    fixture.close();
  }
}

async function skippedWhileClosed(): Promise<CaseDetails> {
  const fixture = await openFixture();
  try {
    const routine = everyFiveMinutes(fixture);
    const start = new Date(routine.trigger.nextRunAt);
    fixture.scheduler.skipMissed(new Date(start.getTime() + 3 * STEP + 30_000));
    await runCauseEffect(fixture.scheduler.processDue(new Date(start.getTime() + 4 * STEP)));
    const [run] = deliveredRuns(fixture, routine);
    assert.ok(run?.deliveryId, "The first occurrence after the restart starts a run.");
    const skipped = fixture.scheduler.skippedBefore(run);
    assert.ok(skipped && skipped.count >= 1, "The runs missed while OpenBot was closed are counted.");
    assert.deepEqual(skipped.reasons, [CLOSED_REASON]);
    const note = skipNote(routineTaskText(fixture, run));
    assert.ok(note, "The run after the restart gets the skip note.");
    assert.ok(note.includes(CLOSED_REASON), "The note says OpenBot was closed.");
    assert.deepEqual(fixture.errors, []);
    return { skipped, note };
  } finally {
    fixture.close();
  }
}

function safe(value: string): string {
  let result = redactText(value);
  for (const root of [...ownedRoots, ROOT, homedir()]) result = result.replaceAll(root, "[private-root]");
  return result;
}

async function runCase(name: string, work: () => Promise<CaseDetails>): Promise<void> {
  const row: CaseResult = { name, passed: false };
  cases.push(row);
  try {
    row.details = await work();
    row.passed = true;
  } catch (error) {
    row.error = safe(error instanceof Error ? (error.stack ?? error.message) : String(error)).slice(0, 8192);
  }
  process.stdout.write(`${row.passed ? "PASS" : "FAIL"} ${name}${row.error ? `: ${row.error}` : ""}\n`);
}

try {
  await runCase("skipped while the last run was open", skippedWhileRunOpen);
  await runCase("skipped while OpenBot was closed", skippedWhileClosed);
} finally {
  for (const root of ownedRoots) await rm(root, { recursive: true, force: true });
  const passed = cases.length === 2 && cases.every((row) => row.passed);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${safe(JSON.stringify({ passed, cases }, null, 2))}\n`);
  process.stdout.write(`${passed ? "PASS" : "FAIL"}: report in ${join(OUT, "report.json")}\n`);
  if (!passed) process.exitCode = 1;
}
