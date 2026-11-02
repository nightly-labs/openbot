// Runs the real scheduler, SQLite stores and mailbox. The enqueue gate replaces only scheduling
// time at the mailbox boundary. No provider, account, network or model is started.
//
// Run: bun scripts/routine-due-revalidation-e2e.ts
// It writes .openbot-build/routine-due-revalidation-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Routine, RoutineSchedule } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { redactText } from "@openbot/logging";
import { Deferred, Effect } from "effect";
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

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "routine-due-revalidation-e2e");
const DEADLINE_MS = 10_000;
const OUTPUT_BYTES = 256 * 1024;
const CRASH_EXIT = 86;

interface Fixture {
  database: OpenBotDatabase;
  store: AgentStore;
  mailbox: MailboxStore;
  conversation: ConversationRuntime;
  timer: RoutineTimer;
  scheduler: RoutineScheduler;
  runs: AgentRoutineStore;
  agentId: string;
  errors: string[];
  limited: Set<string>;
  close(): void;
}

interface Seed {
  first: Routine;
  changed: Routine;
  last: Routine;
  now: Date;
  future: Date;
}

type ScheduleKind = "cron" | "once";
type Mutation = "pause" | "resume" | "delete" | "reschedule" | "replace" | "edit" | "skip" | "wait" | "unchanged";

const CASES = [
  { name: "cron pause", kind: "cron", mutation: "pause" },
  { name: "one-time pause", kind: "once", mutation: "pause" },
  { name: "cron pause and resume", kind: "cron", mutation: "resume" },
  { name: "cron delete", kind: "cron", mutation: "delete" },
  { name: "one-time delete", kind: "once", mutation: "delete" },
  { name: "cron future schedule", kind: "cron", mutation: "reschedule" },
  { name: "one-time future schedule", kind: "once", mutation: "reschedule" },
  { name: "cron replaced trigger at the same time", kind: "cron", mutation: "replace" },
  { name: "one-time replaced trigger at the same time", kind: "once", mutation: "replace" },
  { name: "cron current instruction and name", kind: "cron", mutation: "edit" },
  { name: "one-time current instruction and name", kind: "once", mutation: "edit" },
  { name: "cron current skip policy", kind: "cron", mutation: "skip" },
  { name: "cron current wait policy", kind: "cron", mutation: "wait" },
  { name: "cron unchanged and overlap", kind: "cron", mutation: "unchanged" },
  { name: "one-time unchanged and replay", kind: "once", mutation: "unchanged" },
] satisfies Array<{ name: string; kind: ScheduleKind; mutation: Mutation }>;

async function within<T>(operation: Promise<T>, name: string, milliseconds = DEADLINE_MS): Promise<T> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_done, fail) => {
        deadline = setTimeout(() => fail(new Error(`Fixture deadline: ${name}.`)), milliseconds);
      }),
    ]);
  } finally {
    if (deadline) clearTimeout(deadline);
  }
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
    const errors: string[] = [];
    const limited = new Set<string>();
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
        usageLimited: (agentId) => limited.has(agentId),
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
      errors,
      limited,
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

function schedule(kind: ScheduleKind, at: Date): RoutineSchedule {
  return kind === "once"
    ? { kind: "once", date: at.toISOString().slice(0, 10), time: at.toISOString().slice(11, 16) }
    : { kind: "custom", expression: `${at.getUTCMinutes()} ${at.getUTCHours()} * * *` };
}

function seed(fixture: Fixture, kind: ScheduleKind, mutation: Mutation): Seed {
  const base = Math.ceil(Date.now() / 60_000) * 60_000 + 10 * 60_000;
  const create = (name: string, at: Date, scheduleKind: ScheduleKind, limitPolicy: "wait" | "skip" = "wait") =>
    fixture.scheduler.create(
      {
        agentId: fixture.agentId,
        name,
        instruction: `Synthetic ${name}`,
        active: true,
        timezone: "UTC",
        schedule: schedule(scheduleKind, at),
        limitPolicy,
      },
      { recordConversationEvent: false },
    );
  return {
    first: create("First", new Date(base), "once"),
    changed: create("Changed", new Date(base + 60_000), kind, mutation === "wait" ? "skip" : "wait"),
    last: create("Last", new Date(base + 120_000), "once"),
    now: new Date(base + 180_000),
    // A daily cron stores the clock time only. Use a later time, not the same time tomorrow.
    future: new Date(base + 10 * 60_000),
  };
}

function deliveryCount(fixture: Fixture, routine: Routine): number {
  return fixture.mailbox
    .conversationMessages(fixture.agentId)
    .filter((message) => message.routine?.routineId === routine.id).length;
}

function runCount(fixture: Fixture, routine: Routine): number {
  return fixture.runs.listRuns(fixture.agentId, routine.id, 50, true).length;
}

async function raceCase(fixture: Fixture, kind: ScheduleKind, mutation: Mutation): Promise<void> {
  const saved = seed(fixture, kind, mutation);
  const entered = Deferred.makeUnsafe<void>();
  const release = Deferred.makeUnsafe<void>();
  const original = fixture.mailbox.enqueue;
  let gateCalls = 0;
  fixture.mailbox.enqueue = Effect.fn("RoutineDueFixture.enqueueGate")(function* (
    input: Parameters<typeof original>[0],
  ) {
    if (input.sender.kind === "routine" && input.sender.routineId === saved.first.id) {
      gateCalls += 1;
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(release);
    }
    return yield* original.call(fixture.mailbox, input);
  });
  const pass = runCauseEffect(fixture.scheduler.processDue(saved.now));
  // Observe an early pass failure even if it fails before reaching the gate.
  void pass.catch(() => {});
  try {
    await within(
      Promise.race([
        Effect.runPromise(Deferred.await(entered)),
        pass.then(() => {
          throw new Error("The pass ended before it reached the enqueue gate.");
        }),
      ]),
      "first enqueue gate",
    );
    assert.equal(runCount(fixture, saved.first), 1);
    assert.equal(runCount(fixture, saved.changed), 0);
    assert.equal(runCount(fixture, saved.last), 0);
    const update = (fields: Parameters<RoutineScheduler["update"]>[0]) =>
      fixture.scheduler.update(fields, { recordConversationEvent: false });
    const target = { agentId: fixture.agentId, routineId: saved.changed.id };
    if (mutation === "pause" || mutation === "resume") {
      update({ ...target, active: false });
      if (mutation === "resume") update({ ...target, active: true });
    } else if (mutation === "delete") {
      await runCauseEffect(fixture.scheduler.delete(target, { recordConversationEvent: false }));
    } else if (mutation === "reschedule" || mutation === "replace") {
      const at = mutation === "replace" ? new Date(saved.changed.trigger.nextRunAt) : saved.future;
      const current = update({ ...target, schedule: schedule(kind, at) });
      if (mutation === "reschedule") {
        assert.notDeepEqual(
          current.trigger.schedule,
          saved.changed.trigger.schedule,
          "The future schedule changes the stored clock time.",
        );
        assert.equal(
          current.trigger.nextRunAt,
          saved.future.toISOString(),
          "The stored next occurrence is the requested future time.",
        );
        assert.ok(
          current.trigger.nextRunAt > saved.now.toISOString(),
          "The replacement occurrence is later than this pass.",
        );
      }
    } else if (mutation === "edit") {
      update({ ...target, name: "Current name", instruction: "Current instruction" });
    } else if (mutation === "skip" || mutation === "wait") {
      update({ ...target, limitPolicy: mutation });
      fixture.limited.add(fixture.agentId);
    }
  } finally {
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await within(pass, "scheduler pass");
    fixture.mailbox.enqueue = original;
  }
  assert.equal(gateCalls, 1);
  assert.deepEqual(fixture.errors, []);
  assert.equal(deliveryCount(fixture, saved.first), 1);
  assert.equal(deliveryCount(fixture, saved.last), 1, "An unchanged later routine still fires.");

  const skipped = ["pause", "delete", "reschedule", "replace", "skip"].includes(mutation);
  assert.equal(deliveryCount(fixture, saved.changed), skipped ? 0 : 1, "The pass honors the current routine.");
  assert.equal(
    runCount(fixture, saved.changed),
    skipped ? 0 : 1,
    "The current occurrence creates exactly the expected run rows.",
  );
  if (mutation === "edit") {
    const [run] = fixture.runs.listRuns(fixture.agentId, saved.changed.id);
    assert.equal(run?.instruction, "Current instruction");
    assert.equal(run?.routineName, "Current name");
    assert.equal(
      fixture.mailbox
        .conversationMessages(fixture.agentId)
        .filter((message) => message.routine?.routineId === saved.changed.id)[0]?.text,
      "Current instruction",
    );
  }
  if (mutation === "pause") {
    assert.equal(fixture.scheduler.list(fixture.agentId).find((row) => row.id === saved.changed.id)?.active, false);
    if (kind === "cron")
      fixture.scheduler.update(
        { agentId: fixture.agentId, routineId: saved.changed.id, active: true },
        { recordConversationEvent: false },
      );
    else
      fixture.scheduler.update(
        { agentId: fixture.agentId, routineId: saved.changed.id, active: true, schedule: schedule(kind, saved.future) },
        { recordConversationEvent: false },
      );
  }
  if (mutation === "delete") {
    assert.equal(
      fixture.scheduler.list(fixture.agentId).some((row) => row.id === saved.changed.id),
      false,
    );
    await runCauseEffect(fixture.scheduler.processDue(saved.now));
    assert.deepEqual(fixture.errors, []);
    return;
  }
  if (mutation === "replace") {
    assert.notEqual(fixture.runs.get(fixture.agentId, saved.changed.id)?.trigger.id, saved.changed.trigger.id);
    await runCauseEffect(fixture.scheduler.processDue(saved.now));
    assert.equal(deliveryCount(fixture, saved.changed), 1, "The next pass reads the replacement trigger.");
  } else if (mutation === "reschedule" || mutation === "pause") {
    await runCauseEffect(fixture.scheduler.processDue(saved.now));
    const current = fixture.runs.get(fixture.agentId, saved.changed.id);
    assert.ok(current);
    // A recurring resume before its due time retains a valid future occurrence. A one-time edit is later.
    if (mutation === "reschedule" || kind === "once")
      assert.equal(
        deliveryCount(fixture, saved.changed),
        0,
        "Another pass before the changed due time queues no delivery.",
      );
    await runCauseEffect(fixture.scheduler.processDue(new Date(current.trigger.nextRunAt)));
    assert.equal(deliveryCount(fixture, saved.changed), 1, "The changed schedule fires at its current due time.");
  } else if (mutation === "skip") {
    fixture.limited.clear();
    const current = fixture.runs.get(fixture.agentId, saved.changed.id);
    assert.ok(current);
    await runCauseEffect(fixture.scheduler.processDue(new Date(current.trigger.nextRunAt)));
    assert.equal(deliveryCount(fixture, saved.changed), 1, "A skipped occurrence does not disable later work.");
  }
  const before = deliveryCount(fixture, saved.changed);
  await runCauseEffect(fixture.scheduler.processDue(saved.now));
  assert.equal(deliveryCount(fixture, saved.changed), before, "Repeated processing creates no duplicate delivery.");
  if (kind === "cron" && !["reschedule", "pause", "skip", "replace"].includes(mutation)) {
    const current = fixture.runs.get(fixture.agentId, saved.changed.id);
    assert.ok(current);
    await runCauseEffect(fixture.scheduler.processDue(new Date(current.trigger.nextRunAt)));
    assert.equal(deliveryCount(fixture, saved.changed), before, "An unfinished run prevents a second queued run.");
  }
  assert.deepEqual(fixture.errors, []);
}

async function crashChild(root: string, kind: ScheduleKind): Promise<never> {
  const fixture = await openFixture(root);
  const saved = seed(fixture, kind, "unchanged");
  // Keep only the selected run. The process must stop after the durable run/trigger writes.
  await runCauseEffect(
    fixture.scheduler.delete(
      { agentId: fixture.agentId, routineId: saved.first.id },
      { recordConversationEvent: false },
    ),
  );
  await runCauseEffect(
    fixture.scheduler.delete(
      { agentId: fixture.agentId, routineId: saved.last.id },
      { recordConversationEvent: false },
    ),
  );
  await writeFile(
    join(root, "seed.json"),
    JSON.stringify({ agentId: fixture.agentId, routineId: saved.changed.id, due: saved.changed.trigger.nextRunAt }),
    { mode: 0o600 },
  );
  fixture.mailbox.enqueue = () => Effect.sync(() => process.exit(CRASH_EXIT));
  await runCauseEffect(fixture.scheduler.processDue(saved.now));
  throw new Error("The crash fixture did not reach the real enqueue boundary.");
}

const childFlag = process.argv.indexOf("--crash-child");
if (childFlag >= 0) {
  const root = process.argv[childFlag + 1];
  const kind = process.argv[childFlag + 2];
  assert.ok(root && (kind === "cron" || kind === "once"));
  await crashChild(root, kind);
  process.exit(1);
}

interface CaseResult {
  name: string;
  passed: boolean;
  error?: string;
}
const cases: CaseResult[] = [];
const ownedRoots: string[] = [];
const children = new Set<ChildProcess>();

function safe(value: string): string {
  let result = redactText(value);
  for (const root of [...ownedRoots, ROOT, homedir()]) {
    result = result.replaceAll(JSON.stringify(root).slice(1, -1), "[private-root]").replaceAll(root, "[private-root]");
  }
  return result;
}

async function newRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-routine-due-"));
  ownedRoots.push(root);
  return root;
}

async function recoverCrash(kind: ScheduleKind): Promise<void> {
  const root = await newRoot();
  const child = spawn(process.execPath, [import.meta.filename, "--crash-child", root, kind], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, TMPDIR: tmpdir() },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  let output = "";
  const capture = (chunk: Buffer) => {
    output += chunk.toString("utf8");
    if (Buffer.byteLength(output, "utf8") > OUTPUT_BYTES) {
      child.kill("SIGKILL");
      output = "Crash child output exceeded its bound.";
    }
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  const code = await within(
    new Promise<number | null>((done, fail) => {
      child.once("error", fail);
      child.once("close", (exitCode) => {
        children.delete(child);
        done(exitCode);
      });
    }),
    "owned crash child",
  );
  assert.equal(code, CRASH_EXIT, safe(output).slice(0, 8192));
  const value = JSON.parse(await readFile(join(root, "seed.json"), "utf8"));
  assert.ok(isDynamicRecord(value) && isString(value.agentId) && isString(value.routineId) && isString(value.due));
  const fixture = await openFixture(root);
  try {
    const routine = fixture.runs.get(value.agentId, value.routineId);
    assert.ok(routine);
    assert.equal(fixture.runs.pendingRuns().length, 1);
    const [before] = fixture.runs.listRuns(value.agentId, value.routineId);
    assert.ok(before);
    assert.equal(before.deliveryId, null);
    assert.equal(before.scheduledFor, value.due);
    assert.equal(routine.active, kind === "cron");
    if (kind === "cron") assert.ok(routine.trigger.nextRunAt > value.due);
    fixture.scheduler.skipMissed(new Date(value.due));
    await runCauseEffect(fixture.scheduler.resumePendingRuns());
    await runCauseEffect(fixture.scheduler.resumePendingRuns());
    await runCauseEffect(fixture.scheduler.processDue(new Date(value.due)));
    assert.equal(fixture.runs.listRuns(value.agentId, value.routineId).length, 1);
    const [after] = fixture.runs.listRuns(value.agentId, value.routineId);
    assert.equal(after?.id, before.id);
    assert.ok(after?.deliveryId);
    assert.equal(fixture.scheduler.quietRunForDelivery(after.deliveryId), true);
    assert.equal(fixture.mailbox.queuedDeliveryIds(value.agentId).length, 1);
    assert.deepEqual(fixture.errors, []);
    assert.equal(fixture.database.connection.prepare("PRAGMA quick_check").get()?.quick_check, "ok");
  } finally {
    fixture.close();
  }
}

async function runCase(name: string, work: () => Promise<void>): Promise<void> {
  const row: CaseResult = { name, passed: false };
  cases.push(row);
  try {
    await work();
    row.passed = true;
  } catch (error) {
    row.error = safe(error instanceof Error ? error.message : String(error)).slice(0, 8192);
  }
  process.stdout.write(`${row.passed ? "PASS" : "FAIL"} ${name}${row.error ? `: ${row.error}` : ""}\n`);
}

try {
  for (const entry of CASES)
    await runCase(entry.name, async () => {
      const fixture = await openFixture(await newRoot());
      try {
        await raceCase(fixture, entry.kind, entry.mutation);
      } finally {
        fixture.close();
      }
    });
  for (const kind of ["cron", "once"] satisfies ScheduleKind[])
    await runCase(`${kind} crash and restart`, () => recoverCrash(kind));
} finally {
  for (const child of children) child.kill("SIGKILL");
  for (const root of ownedRoots) await rm(root, { recursive: true, force: true });
  const passed = cases.length === CASES.length + 2 && cases.every((row) => row.passed);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${safe(JSON.stringify({ passed, cases }, null, 2))}\n`);
  process.stdout.write(`${passed ? "PASS" : "FAIL"}: report in ${join(OUT, "report.json")}\n`);
  if (!passed) process.exitCode = 1;
}
