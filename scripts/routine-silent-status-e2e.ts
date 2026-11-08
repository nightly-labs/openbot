import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentEvent, ConversationMessage, ConversationPage, Routine, RoutineRun } from "@openbot/contracts/ipc";
import { isConversationMessage, isRoutine, routineRunConversationEvent } from "@openbot/contracts/ipc";
import { ROUTINE_STATUS_CODECS, ROUTINE_STATUS_ROUTES } from "@openbot/contracts/team-protocol/routine-status-v1";
import { Effect } from "effect";
import { projectChatMessages } from "../apps/mobile/src/features/chat/model/chat-messages";
import { AttachmentGateway } from "../src/backend/agent/attachment-gateway";
import { ConversationReader } from "../src/backend/agent/conversation-reader";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { MailboxSync } from "../src/backend/agent/mailbox-sync";
import { settleQuietRoutineTurn } from "../src/backend/agent/routine-quiet-runs";
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
import {
  parseCreateChannelRoutine,
  parseCreateRoutine,
  parseUpdateChannelRoutine,
  parseUpdateRoutine,
} from "../src/main/ipc/agent-inputs";
import { decodeRoutine, decodeRoutineRun } from "../src/preload/agent-decoding";
import { decodeConversation } from "../src/preload/conversation-decoding";

const OUT = resolve(import.meta.dirname, "../.openbot-build/routine-silent-status-e2e");
async function openFixture(root: string) {
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
      (event) => events.push(event),
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
        syncMailboxMessages: (snapshot) => sync.syncMailboxMessages(snapshot),
        listAgents: () => store.list(),
        excludedAgents: () => new Set(),
        isRunning: () => false,
        usageLimited: () => false,
        routineThread: () => null,
        routineDeleted: () => Effect.void,
      },
    });
    const sync = new MailboxSync({
      database,
      mailbox,
      conversation: runtime,
      routines: scheduler,
      scope: () => {
        throw new Error("No background work in this fixture.");
      },
      hooks: { emit: (event) => events.push(event), emitError: (code) => errors.push(code), queueHold: () => null },
    });
    const reader = new ConversationReader({
      store,
      conversation: runtime,
      mailboxSync: sync,
      hooks: { emit: (event) => events.push(event), listAgents: () => store.list() },
    });
    return {
      reader,
      store,
      conversation: runtime,
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

const root = await mkdtemp(join(tmpdir(), "openbot-silent-status-"));
let fixture = await openFixture(root);
const checks: string[] = [];
let passed = false;
let error: string | undefined;
try {
  const { scheduler, agentId, mailbox, runs, reader, database, store } = fixture;
  const created = scheduler.create(
    parseCreateRoutine({
      agentId,
      name: "Silent fixture",
      instruction: "Write a useful report.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "hourly", minute: 0 },
      silent: true,
    }),
    { recordConversationEvent: false },
  );
  assert.equal(created.silent, true);
  assert.equal(
    scheduler.update(parseUpdateRoutine({ agentId, routineId: created.id, name: "Renamed fixture" }), {
      recordConversationEvent: false,
    }).silent,
    true,
  );
  await runCauseEffect(scheduler.processDue(new Date(created.trigger.nextRunAt)));
  const run = runs.listRuns(agentId, created.id)[0];
  assert.ok(run?.deliveryId);
  const deliveryId = run.deliveryId;
  await runCauseEffect(mailbox.markStarting(deliveryId));
  await runCauseEffect(mailbox.markRunning(deliveryId, "silent-fixture-turn"));
  const running = mailbox.getDelivery(deliveryId);
  assert.ok(running);
  scheduler.reconcileDelivery(running.delivery);
  await runCauseEffect(mailbox.markTerminal(deliveryId, "completed"));
  const completed = mailbox.getDelivery(deliveryId);
  assert.ok(completed);
  scheduler.reconcileDelivery(completed.delivery);
  const visible = await runCauseEffect(reader.read(agentId));
  assert.equal(
    visible.messages.some((message) => routineRunConversationEvent(message)?.runId === run.id),
    false,
    "Silent scheduled run must have no lifecycle status rows in the production conversation read.",
  );
  checks.push("silent scheduled lifecycle is absent from the production read");
  assert.equal(runs.listRuns(agentId, created.id)[0]?.status, "succeeded");
  const threadId = store.list().find((agent) => agent.id === agentId)?.threadId;
  assert.ok(threadId);
  assert.equal(
    database
      .readConversation(agentId, threadId)
      .messages.some((message) => routineRunConversationEvent(message)?.runId === run.id),
    true,
  );
  checks.push("the run and durable transition history remain");
  const page = await runCauseEffect(reader.readPageFor(agentId, "fixture-reader", { type: "latest" }, 100));
  assert.equal(
    page.messages.some((message) => message.silentRoutineStatus),
    false,
  );
  assert.equal(
    fixture.events
      .filter((event) => event.type === "conversation")
      .some(
        (event) =>
          event.type === "conversation" && event.snapshot.messages.some((message) => message.silentRoutineStatus),
      ),
    false,
  );
  assert.equal(
    projectChatMessages(visible.messages).some((row) => row.kind === "routine"),
    false,
  );
  checks.push("paged reads, live snapshots, and the native message projection omit silent status");

  const boundaryInput = {
    agentId,
    name: created.name,
    instruction: created.instruction,
    active: created.active,
    timezone: created.timezone,
    schedule: created.trigger.schedule,
  };
  const boundaryMessage: ConversationMessage = {
    id: "boundary",
    author: "assistant",
    source: "agent",
    text: "Fixture.",
    createdAt: new Date().toISOString(),
    status: "completed",
    silentRoutineStatus: true,
  };
  assert.equal(parseCreateRoutine({ ...boundaryInput, silent: true }).silent, true);
  assert.equal(decodeRoutineRun(run).silent, true);
  assert.equal(decodeConversation({ ...visible, messages: [boundaryMessage] }).messages[0]?.silentRoutineStatus, true);
  for (const invalid of [null, 0, 1, "true", {}, []]) {
    assert.throws(() => parseCreateRoutine({ ...boundaryInput, silent: invalid }));
    assert.throws(() => parseUpdateRoutine({ agentId, routineId: created.id, silent: invalid }));
    assert.equal(isRoutine({ ...created, silent: invalid }), false);
    assert.throws(() => decodeRoutine({ ...created, silent: invalid }));
    assert.throws(() => decodeRoutineRun({ ...run, silent: invalid }));
    assert.throws(() => parseCreateChannelRoutine({ ...boundaryInput, channelId: "fixture", silent: invalid }));
    assert.throws(() => parseUpdateChannelRoutine({ channelId: "fixture", routineId: created.id, silent: invalid }));
    assert.throws(() =>
      parseSaveEventRoutine({
        ...created,
        owner: { kind: "agent", id: agentId },
        trigger: { kind: "schedule", schedule: created.trigger.schedule },
        silent: invalid,
      }),
    );
    assert.throws(() =>
      decodeConversation({ ...visible, messages: [{ ...boundaryMessage, silentRoutineStatus: invalid }] }),
    );
    assert.equal(
      isConversationMessage({
        id: "invalid",
        author: "system",
        source: "system",
        text: "fixture",
        createdAt: new Date().toISOString(),
        status: "completed",
        silentRoutineStatus: invalid,
      }),
      false,
    );
    assert.throws(() =>
      ROUTINE_STATUS_CODECS.get(ROUTINE_STATUS_ROUTES.set)?.request({
        owner: { kind: "agent", id: agentId },
        routineId: created.id,
        silent: invalid,
      }),
    );
  }
  assert.equal(decodeRoutine(created).silent, true);
  const legacyRoutine = { ...created };
  delete legacyRoutine.silent;
  assert.equal(decodeRoutine(legacyRoutine).silent, undefined);
  checks.push("IPC, persisted message, typed routine, and capability boundaries reject invalid flags including null");

  const config = {
    agentId,
    name: "Visible fixture",
    instruction: "Write a useful report.",
    active: true,
    timezone: "UTC",
    schedule: { kind: "hourly", minute: 0 },
  };
  function create(silent?: boolean): Routine {
    return scheduler.create(parseCreateRoutine({ ...config, ...(silent === undefined ? {} : { silent }) }), {
      recordConversationEvent: false,
    });
  }
  async function queue(routine: Routine): Promise<RoutineRun> {
    await runCauseEffect(scheduler.processDue(new Date(routine.trigger.nextRunAt)));
    const run = runs.listRuns(agentId, routine.id)[0];
    assert.ok(run?.deliveryId);
    return run;
  }
  async function start(run: RoutineRun): Promise<string> {
    assert.ok(run.deliveryId);
    const turn = randomUUID();
    await runCauseEffect(mailbox.markStarting(run.deliveryId));
    await runCauseEffect(mailbox.markRunning(run.deliveryId, turn));
    const delivery = mailbox.getDelivery(run.deliveryId);
    assert.ok(delivery);
    scheduler.reconcileDelivery(delivery.delivery);
    return turn;
  }
  async function finish(run: RoutineRun, status: "completed" | "failed" | "interrupted"): Promise<void> {
    assert.ok(run.deliveryId);
    await runCauseEffect(
      mailbox.markTerminal(run.deliveryId, status, status === "completed" ? null : "Fixture needs action."),
    );
    const delivery = mailbox.getDelivery(run.deliveryId);
    assert.ok(delivery);
    scheduler.reconcileDelivery(delivery.delivery);
  }
  async function statusShown(run: RoutineRun, status: string): Promise<boolean> {
    const snapshot = await runCauseEffect(reader.read(agentId));
    return snapshot.messages.some((message) => {
      const marker = routineRunConversationEvent(message);
      return marker?.runId === run.id && marker.status === status;
    });
  }
  const normal = create();
  assert.equal(normal.silent, false);
  const normalRun = await queue(normal);
  assert.equal(normalRun.silent, false);
  await start(normalRun);
  await finish(normalRun, "completed");
  assert.equal(await statusShown(normalRun, "succeeded"), true);
  scheduler.update(parseUpdateRoutine({ agentId, routineId: normal.id, silent: true }), {
    recordConversationEvent: false,
  });
  assert.equal(await statusShown(normalRun, "succeeded"), true);
  checks.push("an absent legacy preference defaults to false and normal completed rows stay visible");

  const future = create(true);
  const first = await queue(future);
  scheduler.update(parseUpdateRoutine({ agentId, routineId: future.id, silent: false }), {
    recordConversationEvent: false,
  });
  assert.equal(runs.listRuns(agentId, future.id)[0]?.silent, true);
  await start(first);
  await finish(first, "completed");
  assert.equal(await statusShown(first, "succeeded"), false);
  const current = scheduler.list(agentId).find((routine) => routine.id === future.id);
  assert.ok(current);
  const nextRunAt = current.trigger.nextRunAt;
  assert.equal(current.silent, false);
  const second = await queue(current);
  assert.equal(second.silent, false);
  await start(second);
  await finish(second, "completed");
  assert.equal(await statusShown(second, "succeeded"), true);
  assert.notEqual(nextRunAt, future.trigger.nextRunAt);
  checks.push("explicit false clears the setting, old runs keep their value, and the next schedule runs normally");

  for (const status of ["failed", "interrupted"] as const) {
    const row = create(true);
    const active = await queue(row);
    const turn = await start(active);
    scheduler.markNeedsAttention(turn);
    assert.equal(await statusShown(active, "needs-attention"), true);
    scheduler.markRunningForTurn(turn);
    await finish(active, status);
    assert.equal(await statusShown(active, status), true);
  }
  const cancelled = await queue(create(true));
  assert.ok(cancelled.deliveryId);
  await runCauseEffect(mailbox.cancel(agentId, cancelled.deliveryId));
  const cancelledDelivery = mailbox.getDelivery(cancelled.deliveryId);
  assert.ok(cancelledDelivery);
  scheduler.reconcileDelivery(cancelledDelivery.delivery);
  assert.equal(await statusShown(cancelled, "cancelled"), true);
  checks.push("failure, interruption, cancellation, and needs-attention stay visible");

  const testRoutine = create(true);
  const test = await runCauseEffect(scheduler.test({ agentId, routineId: testRoutine.id }));
  assert.equal(test.silent, false);
  await start(test);
  await finish(test, "completed");
  assert.equal(await statusShown(test, "succeeded"), true);
  checks.push("an explicit Test run stays visible");

  const scriptRoutine = create(true);
  const script = await runCauseEffect(
    scheduler.runWithPayload({
      agentId,
      routineId: scriptRoutine.id,
      payload: "Synthetic script event",
      source: "script",
    }),
  );
  assert.equal(script.silent, true);
  await start(script);
  await finish(script, "completed");
  assert.equal(await statusShown(script, "succeeded"), false);
  const webhookRoutine = scheduler.saveRecord(agentId, undefined, {
    ...config,
    silent: true,
    trigger: { kind: "webhook", eventType: null, filters: [], secretCiphertext: "fixture-ciphertext" },
  });
  const received = await runCauseEffect(
    scheduler.receiveWebhook(agentId, webhookRoutine.id, {
      deliveryId: "fixture-webhook",
      eventType: "fixture",
      data: { report: true },
      occurredAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
    }),
  );
  assert.equal(received.kind, "started");
  if (received.kind !== "started") throw new Error("The fixture webhook did not queue a run.");
  const webhook = runs.listRuns(agentId, webhookRoutine.id)[0];
  assert.ok(webhook);
  assert.equal(webhook.silent, true);
  await start(webhook);
  await finish(webhook, "completed");
  assert.equal(await statusShown(webhook, "succeeded"), false);
  checks.push("script and webhook runs use the same saved visibility snapshot and complete without lifecycle rows");

  const cardRoutine = scheduler.create(parseCreateRoutine({ ...config, silent: true }));
  scheduler.update(parseUpdateRoutine({ agentId, routineId: cardRoutine.id, silent: false }));
  const settings = await runCauseEffect(reader.read(agentId));
  assert.equal(
    settings.messages.some(
      (message) => message.itemType?.startsWith("routine-event:") && message.itemType.includes(cardRoutine.id),
    ),
    true,
  );
  checks.push("routine creation and edit cards remain visible");

  function append(messages: ConversationMessage[]): void {
    fixture.conversation.withConversationTransaction(agentId, ({ threadId, snapshot }) => {
      for (const message of messages) {
        snapshot.messages.push(message);
        snapshot.revision = database.appendConversationMessage({
          agentId,
          threadId,
          activeTurnId: null,
          message,
          eventType: "fixture.message",
          detail: {},
        });
      }
      return { result: undefined, snapshot };
    });
  }
  const message = (id: string, text: string, itemType?: string): ConversationMessage => ({
    id,
    author: "assistant",
    source: "agent",
    text,
    turnId: id,
    createdAt: new Date().toISOString(),
    status: "completed",
    ...(itemType ? { itemType } : {}),
  });
  const report = message("substantive-report", "A useful report.");
  const question = {
    ...message("question", "Please choose.", "question_prompt"),
    questionPrompt: {
      requestId: "question",
      questions: [
        { id: "choice", header: "Report", question: "Which report do you need?", isSecret: false, options: null },
      ],
      resolution: null,
    },
  };
  const approval = message("approval", "Approval is required.", "commandExecution");
  const file: ConversationMessage = {
    ...message("file-report", ""),
    attachments: [
      {
        id: "fixture-file",
        name: "report.txt",
        size: 12,
        kind: "file",
        mimeType: "text/plain",
        previewKind: "text",
        previewUrl: null,
      },
    ],
  };
  const missing = {
    ...message("missing-routine", "Legacy routine.", "routine-run-event:succeeded:deleted:missing"),
    author: "system" as const,
    source: "system" as const,
  };
  append([report, question, approval, missing]);
  const fileTurn = {
    agentId,
    threadId,
    activeTurnId: null,
    revision: 0,
    messages: [file, { ...message("file-quiet-text", "No other update."), turnId: file.turnId }],
  };
  assert.equal(settleQuietRoutineTurn(fileTurn, "file-report", true, true), false);
  assert.equal(
    fileTurn.messages.some((message) => message.id === "file-report" && !message.silentRoutineStatus),
    true,
  );
  append(fileTurn.messages);
  const quiet = {
    agentId,
    threadId,
    activeTurnId: null,
    revision: 0,
    messages: [message("quiet-answer", "There is nothing to report.")],
  };
  assert.equal(settleQuietRoutineTurn(quiet, "quiet-answer", true, true), true);
  append(quiet.messages);
  const agent = store.list().find((candidate) => candidate.id === agentId);
  assert.ok(agent);
  const path = join(agent.workspacePath, "actual-report.txt");
  await writeFile(path, "Useful report.");
  const gateway = new AttachmentGateway({
    conversation: fixture.conversation,
    mailbox,
    sharedRoot: store.sharedRoot,
    hooks: { emitError: (code) => fixture.errors.push(code) },
  });
  await runCauseEffect(
    gateway.attachFiles(
      agentId,
      { threadId, turnId: report.id, callId: "fixture-attachment" },
      [path],
      "actual-attachment",
    ),
  );
  const publication = fixture.events.filter((event) => event.type === "conversation").at(-1);
  assert.ok(publication?.type === "conversation");
  assert.equal(
    publication.snapshot.messages.some((message) => message.silentRoutineStatus),
    false,
  );
  assert.equal(
    publication.snapshot.messages.some(
      (message) => message.id === "actual-attachment" && message.attachments?.[0]?.name === "actual-report.txt",
    ),
    true,
  );
  gateway.dispose();
  checks.push("the production attachment service publishes the file without revealing hidden lifecycle history");
  const content = await runCauseEffect(reader.read(agentId));
  for (const row of [report, question, approval, missing, file])
    assert.equal(
      content.messages.some((message) => message.id === row.id),
      true,
    );
  assert.equal(
    content.messages.some((message) => message.id === "quiet-answer"),
    false,
  );
  assert.equal(
    database.readConversation(agentId, threadId).messages.some((message) => message.id === "quiet-answer"),
    true,
  );
  const native = projectChatMessages(content.messages);
  assert.equal(
    native.some((row) => row.kind === "message" && row.body === report.text),
    true,
  );
  assert.equal(
    native.some((row) => row.kind === "question"),
    true,
  );
  checks.push(
    "substantive output, files, questions, approvals, and missing references stay visible; private quiet answers stay durable and hidden",
  );
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, "consumer-messages.json"),
    JSON.stringify({ messages: content.messages, silentRunId: run.id }, null, 2),
  );
  fixture.close();
  fixture = await openFixture(root);
  const reloaded = await runCauseEffect(fixture.reader.read(agentId));
  assert.equal(
    reloaded.messages.some(
      (message) => message.id === "quiet-answer" || routineRunConversationEvent(message)?.runId === run.id,
    ),
    false,
  );
  assert.equal(fixture.runs.list(agentId).find((routine) => routine.id === future.id)?.silent, false);
  assert.equal(fixture.runs.listRuns(agentId, created.id)[0]?.silent, true);
  const reloadedPage = await runCauseEffect(
    fixture.reader.readPageFor(agentId, "fixture-reader", { type: "latest" }, 100),
  );
  assert.deepEqual(
    reloadedPage.messages.map((message) => message.id),
    reloaded.messages.map((message) => message.id),
  );
  const pagedIds: string[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: ConversationPage = await runCauseEffect(
      fixture.reader.readPageFor(
        agentId,
        "fixture-reader",
        cursor ? { type: "before", cursor } : { type: "latest" },
        3,
      ),
    );
    assert.equal(
      page.messages.some((message) => message.silentRoutineStatus),
      false,
    );
    pagedIds.unshift(...page.messages.map((message) => message.id));
    if (!page.pageInfo.hasOlder) break;
    assert.ok(page.messages.length > 0 && page.pageInfo.olderCursor && page.pageInfo.olderCursor !== cursor);
    cursor = page.pageInfo.olderCursor;
  }
  assert.deepEqual(
    pagedIds,
    reloaded.messages.map((message) => message.id),
  );
  checks.push("saved preferences, run snapshots, and matching paged/full chat visibility remain after restart");
  passed = true;
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
  throw cause;
} finally {
  fixture.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ passed, checks, error }, null, 2));
  await rm(root, { recursive: true, force: true });
}
