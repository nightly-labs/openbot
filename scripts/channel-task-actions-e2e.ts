// Drives the real channel service, SQLite, routine scheduler and HTTP route on temporary data.
// No app, account, provider turn or real task is used. Node needs node:sqlite:
// node --import tsx scripts/channel-task-actions-e2e.ts
// Writes .openbot-build/channel-task-actions-e2e/report.json.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type AgentSummary,
  type CancelChannelTaskInput,
  CHANNEL_CHATS_CAPABILITY,
  CHANNEL_TASK_ACTIONS_CAPABILITY,
  type ChannelTask,
  isChannelChangeMarker,
  parseCancelChannelTask,
  parseRecoverChannelTask,
} from "@openbot/contracts/ipc";
import {
  CHANNEL_TASK_CANCEL_PATH,
  CHANNEL_TASK_RECOVER_PATH,
} from "@openbot/contracts/team-protocol/channel-task-actions-v1";
import { CHANNEL_ROUTES, channelRequest } from "@openbot/contracts/team-protocol/channels-v1";
import {
  legacyTeamCapabilities,
  TEAM_CURRENT_CAPABILITIES,
  teamCapabilitiesForProtocol,
} from "@openbot/contracts/team-protocol/current";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import { matchingSourceKeys, sourceText } from "@openbot/i18n/source";
import { teamChannelsApi } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import { channelFailure } from "../src/backend/channel-effects";
import { ChannelRoutineScheduler } from "../src/backend/channel-routine-scheduler";
import { type ChannelHooks, ChannelService } from "../src/backend/channel-service";
import type { ChannelAssignment } from "../src/backend/channel-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { ChannelImages } from "../src/backend/channel-images";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { HttpError } from "../src/main/team-api/http-error";
import { type ChannelSettingsAgents, routeChannels } from "../src/main/team-api/route-channels";

const output = resolve(import.meta.dirname, "../.openbot-build/channel-task-actions-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-channel-task-actions-"));
const database = new OpenBotDatabase(root);
const mailbox = new MailboxStore(root, join(root, "shared"), database);
const actor = { id: "local", name: "Fixture reader" };
const agent: AgentSummary = {
  id: "fixture-agent",
  name: "Fixture agent",
  title: "Engineer",
  description: "Fixture only",
  notifications: false,
  provider: "codex",
  model: "gpt-5.5",
  reasoningEffort: "medium",
  threadId: null,
  workspacePath: root,
  preview: "",
  updatedAt: null,
  avatarSeed: "fixture-agent",
  avatarHue: null,
  avatarUrl: null,
};
const interruptions: string[] = [];
const errors: unknown[] = [];
let generations = 0;
let scheduler: ChannelRoutineScheduler | null = null;
let failInterrupt = false;
let denyRecovery = false;
const images = new ChannelImages(join(root, "avatars", "channels"));
const hooks: ChannelHooks = {
  agents: () => [agent],
  generate: () => {
    generations += 1;
    return Effect.succeed("{}");
  },
  schedule: () => undefined,
  // Keep all new work queued; no fixture can start a provider.
  busy: () => true,
  personAgentLevel: () => (denyRecovery ? "view" : "manage"),
  interrupt: (_agentId, turnId) => {
    interruptions.push(turnId);
    return failInterrupt ? Effect.fail(channelFailure(new Error("Synthetic interruption failure."))) : Effect.void;
  },
  changed: (channelId) => scheduler?.reconcile(channelId),
  error: (error) => errors.push(error),
};
let channels = new ChannelService(database, mailbox, images, hooks);
const report: { passed: boolean; cases: string[]; interruptions: string[]; providerGenerations: number } = {
  passed: false,
  cases: [],
  interruptions,
  providerGenerations: 0,
};
const unavailable = (): never => {
  throw new Error("The fixture does not use channel settings routes.");
};
const settings: ChannelSettingsAgents = {
  listChannelMemories: unavailable,
  createChannelMemory: unavailable,
  updateChannelMemory: unavailable,
  deleteChannelMemory: unavailable,
  clearChannelMemories: unavailable,
  listChannelRoutines: unavailable,
  createChannelRoutine: unavailable,
  updateChannelRoutine: unavailable,
  deleteChannelRoutine: unavailable,
  testChannelRoutine: unavailable,
  listChannelRoutineRuns: unavailable,
};
const server = createServer((request, response) => {
  const handle = async () => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const capabilities = new Set([CHANNEL_CHATS_CAPABILITY]);
    if (request.headers["x-fixture-actions"] === "yes") capabilities.add(CHANNEL_TASK_ACTIONS_CAPABILITY);
    const result = await routeChannels(
      {
        request,
        response,
        url,
        method: request.method ?? "GET",
        protocol: 9,
        capabilities,
        member: {
          ...actor,
          username: "fixture",
          email: null,
          role: "member",
          createdAt: "2026-01-01T00:00:00Z",
          disabled: false,
        },
        token: "fixture",
        sessionId: "fixture",
        sessionExpiresAt: "2099-01-01T00:00:00Z",
        agentLevel: () => "manage",
        json: (status, value) => {
          const codec = teamSideRouteCodec(url.pathname);
          response.writeHead(status, { "content-type": "application/json" });
          response.end(JSON.stringify(codec?.response(url.pathname, status, value) ?? value));
          return "handled";
        },
        empty: (status) => {
          response.writeHead(status);
          response.end();
          return "handled";
        },
      },
      channels,
      settings,
    );
    if (result === "unmatched") {
      response.writeHead(404);
      response.end();
    }
  };
  void handle().catch((error: unknown) => {
    response.writeHead(error instanceof HttpError ? error.status : 400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Fixture request failed." }));
  });
});

const task = (channelId: string, id: string) => {
  const found = channels.store.tasks(channelId).find((item) => item.id === id);
  assert.ok(found);
  return found;
};
const snapshot = (channelId: string, taskId: string): CancelChannelTaskInput => ({
  channelId,
  taskId,
  operationId: randomUUID(),
  expectedRevision: task(channelId, taskId).revision,
  expectedChannelRevision: channels.store.get(channelId).revision,
});
async function fixture(name: string) {
  const channelId = randomUUID();
  await runCauseEffect(
    channels.command(
      {
        type: "save",
        operationId: randomUUID(),
        channelId,
        draft: { name, title: "", instructions: "", members: [{ agentId: agent.id }], leadAgentId: agent.id },
      },
      actor,
    ),
  );
  await runCauseEffect(
    channels.command(
      {
        type: "send",
        operationId: randomUUID(),
        channelId,
        text: `Fixture request ${name}`,
        recipientAgentId: agent.id,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      actor,
    ),
  );
  const selected = channels.store.tasks(channelId)[0];
  assert.ok(selected);
  await runCauseEffect(
    channels.command(
      { type: "stop", operationId: randomUUID(), channelId, taskId: selected.id, recipientAgentId: null },
      actor,
    ),
  );
  return { channelId, taskId: selected.id };
}
async function until(label: string, ready: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (ready()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Fixture state was not reached: ${label}`);
}

try {
  await Effect.runPromise(database.initialize());
  await runCauseEffect(mailbox.initialize());
  const first = await fixture("cancel branch");
  const original = task(first.channelId, first.taskId);
  const child: ChannelTask = {
    ...original,
    id: randomUUID(),
    parentTaskId: original.id,
    rootTaskId: original.id,
    state: "failed",
    error: "Synthetic child failure.",
  };
  const completed: ChannelTask = { ...child, id: randomUUID(), state: "completed", error: null };
  const sibling: ChannelTask = { ...original, id: randomUUID(), rootTaskId: randomUUID(), state: "paused" };
  channels.store.update(channels.store.get(first.channelId), { tasks: [child, completed, sibling] });
  const before = channels.store.page(first.channelId);
  const cancel = snapshot(first.channelId, original.id);
  await runCauseEffect(channels.cancelTask(cancel, actor));
  assert.equal(task(first.channelId, original.id).state, "cancelled");
  assert.equal(task(first.channelId, child.id).state, "cancelled");
  assert.deepEqual(task(first.channelId, completed.id), completed);
  assert.deepEqual(task(first.channelId, sibling.id), sibling);
  const after = channels.store.page(first.channelId);
  assert.deepEqual(after.messages.slice(0, before.messages.length), before.messages);
  assert.equal(after.messages.length, before.messages.length + 1);
  assert.equal(
    after.messages.at(-1)?.message.text,
    sourceText("status.agent.channelTaskCancelled", { person: actor.name, task: original.id }),
  );
  const cancellationNote = after.messages.at(-1);
  assert.ok(cancellationNote && isChannelChangeMarker(cancellationNote.message));
  await runCauseEffect(channels.cancelTask(cancel, actor));
  assert.deepEqual(channels.store.page(first.channelId), after);
  channels.store.rebuild(first.channelId);
  assert.deepEqual(channels.store.page(first.channelId), after);
  report.cases.push(
    "Cancel preserves history and terminal siblings, cancels unfinished descendants once, and rebuilds from events.",
  );

  // Waiting ancestors need review; a late child completion must never restart them.
  const waiting = await fixture("cancel child");
  const parent = task(waiting.channelId, waiting.taskId);
  const late: ChannelTask = {
    ...parent,
    id: randomUUID(),
    parentTaskId: parent.id,
    rootTaskId: parent.id,
    state: "paused",
  };
  channels.store.update(channels.store.get(waiting.channelId), {
    tasks: [{ ...parent, state: "waiting", dependencies: [late.id] }, late],
  });
  const turnId = randomUUID();
  const context = channels.store.context(waiting.channelId, agent.id);
  const assignment: ChannelAssignment = {
    id: randomUUID(),
    channelId: waiting.channelId,
    taskId: late.id,
    agentId: agent.id,
    taskRevision: late.revision,
    requestMessageId: late.requestMessageId,
    resources: [],
    deliveryId: null,
    turnId,
    state: "running",
    throughSequence: 0,
    summaryVersion: 0,
    awaitedTaskIds: [],
    pendingRevision: null,
    pendingOutcome: null,
  };
  channels.store.update(channels.store.get(waiting.channelId), { assignments: [assignment] });
  failInterrupt = true;
  const uncertain = snapshot(waiting.channelId, late.id);
  await assert.rejects(runCauseEffect(channels.cancelTask(uncertain, actor)), /Synthetic interruption failure/);
  assert.equal(task(waiting.channelId, late.id).state, "cancelled");
  assert.equal(task(waiting.channelId, parent.id).error, sourceText("error.backend.channelTaskDependencyCancelled"));
  failInterrupt = false;
  await runCauseEffect(channels.cancelTask(uncertain, actor));
  channels.event({
    type: "turn-completed",
    agentId: agent.id,
    threadId: context.threadId,
    turnId,
    status: "completed",
  });
  await until(
    "late assignment completes",
    () =>
      channels.store.assignments(waiting.channelId).find((item) => item.id === assignment.id)?.state === "completed",
  );
  assert.equal(task(waiting.channelId, late.id).state, "cancelled");
  assert.equal(task(waiting.channelId, parent.id).state, "paused");
  assert.equal(channels.store.assignments(waiting.channelId).length, 1);
  report.cases.push(
    "Interruption failure leaves durable cancellation; retry and late completion cannot revive a child or its waiting parent.",
  );
  const parentRecovery = {
    ...snapshot(waiting.channelId, parent.id),
    action: "resume" as const,
    recipientAgentId: null,
  };
  const cancelledChild = task(waiting.channelId, late.id);
  await runCauseEffect(channels.recoverTask(parentRecovery, actor));
  assert.equal(task(waiting.channelId, parent.id).state, "queued");
  assert.deepEqual(task(waiting.channelId, parent.id).dependencies, []);
  assert.deepEqual(task(waiting.channelId, late.id), cancelledChild);
  const parentAfterRecovery = channels.store.page(waiting.channelId);
  channels.store.rebuild(waiting.channelId);
  assert.deepEqual(channels.store.page(waiting.channelId), parentAfterRecovery);
  await runCauseEffect(channels.recoverTask(parentRecovery, actor));
  assert.deepEqual(channels.store.page(waiting.channelId), parentAfterRecovery);
  report.cases.push(
    "Reviewed recovery atomically removes cancelled child dependencies from remaining work, without reviving cancelled children.",
  );

  const race = await fixture("recovery race");
  const reviewed = snapshot(race.channelId, race.taskId);
  const outcomes = await Promise.allSettled([
    runCauseEffect(channels.recoverTask({ ...reviewed, action: "resume", recipientAgentId: null }, actor)),
    runCauseEffect(channels.cancelTask({ ...reviewed, operationId: randomUUID() }, actor)),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(task(race.channelId, race.taskId).state, "queued");
  const revision = task(race.channelId, race.taskId).revision;
  await runCauseEffect(channels.recoverTask({ ...reviewed, action: "resume", recipientAgentId: null }, actor));
  assert.equal(task(race.channelId, race.taskId).revision, revision);
  await assert.rejects(
    runCauseEffect(
      channels.recoverTask({ ...reviewed, operationId: randomUUID(), action: "resume", recipientAgentId: null }, actor),
    ),
    /changed/,
  );
  report.cases.push(
    "Concurrent guarded resume and cancel accept one snapshot once; duplicate recovery has no replay and fresh stale operations fail.",
  );

  const changed = await fixture("changed descendant");
  const stale = snapshot(changed.channelId, changed.taskId);
  channels.store.update(channels.store.get(changed.channelId), {
    tasks: [{ ...task(changed.channelId, changed.taskId), error: "Synthetic state update." }],
  });
  await assert.rejects(runCauseEffect(channels.cancelTask(stale, actor)), /changed/);
  await assert.rejects(
    runCauseEffect(channels.recoverTask({ ...stale, action: "reassign", recipientAgentId: agent.id }, actor)),
    /changed/,
  );
  report.cases.push(
    "A changed channel snapshot rejects cancel and reassign even when the selected task revision did not change.",
  );
  const restricted = await fixture("view only recovery");
  denyRecovery = true;
  await assert.rejects(
    runCauseEffect(
      channels.recoverTask(
        { ...snapshot(restricted.channelId, restricted.taskId), action: "reassign", recipientAgentId: agent.id },
        actor,
      ),
    ),
    /view|read|chat/i,
  );
  assert.equal(task(restricted.channelId, restricted.taskId).state, "paused");
  denyRecovery = false;
  report.cases.push("Guarded recovery cannot start an agent for a person whose access is view only.");

  // Identifiers can contain colons: receipt keys must encode tuple boundaries.
  const scoped = async (channelId: string, taskId: string) => {
    const channel = channels.store.create(channelId, {
      name: "Receipt fixture",
      title: "",
      instructions: "",
      members: [{ agentId: agent.id }],
      leadAgentId: agent.id,
    });
    channels.store.update(channel, { tasks: [{ ...original, channelId, id: taskId, rootTaskId: taskId }] });
    return snapshot(channelId, taskId);
  };
  const colonA = await scoped("fixture:colon", "task");
  const colonB = await scoped("fixture", "colon:task");
  const sharedOperation = randomUUID();
  await runCauseEffect(channels.cancelTask({ ...colonA, operationId: sharedOperation }, actor));
  await runCauseEffect(channels.cancelTask({ ...colonB, operationId: sharedOperation }, actor));
  assert.equal(task(colonA.channelId, colonA.taskId).state, "cancelled");
  assert.equal(task(colonB.channelId, colonB.taskId).state, "cancelled");
  const recoverA = await scoped("recover:colon", "work");
  const recoverB = await scoped("recover", "colon:work");
  await runCauseEffect(
    channels.recoverTask(
      { ...recoverA, operationId: sharedOperation, action: "resume", recipientAgentId: null },
      actor,
    ),
  );
  await runCauseEffect(
    channels.recoverTask(
      { ...recoverB, operationId: sharedOperation, action: "resume", recipientAgentId: null },
      actor,
    ),
  );
  assert.equal(task(recoverA.channelId, recoverA.taskId).state, "queued");
  assert.equal(task(recoverB.channelId, recoverB.taskId).state, "queued");
  report.cases.push(
    "Cancellation and recovery receipts distinguish channel/task identifier tuples that contain colons.",
  );

  scheduler = new ChannelRoutineScheduler({
    channels,
    hooks: {
      changed: () => undefined,
      emitError: (_code, error) => errors.push(error),
      excludedChannels: () => new Set(),
      usageLimited: () => false,
    },
  });
  const routineChannel = await fixture("routine cancellation");
  const routine = scheduler.create({
    channelId: routineChannel.channelId,
    name: "Fixture routine",
    instruction: "A separate fixture request.",
    active: true,
    timezone: "UTC",
    schedule: { kind: "daily", time: "09:00" },
  });
  const run = await runCauseEffect(scheduler.test({ channelId: routineChannel.channelId, routineId: routine.id }));
  const routineTask = channels.store
    .tasks(routineChannel.channelId)
    .find((item) => item.requestMessageId === run.requestMessageId);
  assert.ok(routineTask);
  await runCauseEffect(
    channels.command(
      {
        type: "stop",
        operationId: randomUUID(),
        channelId: routineChannel.channelId,
        taskId: routineTask.id,
        recipientAgentId: null,
      },
      actor,
    ),
  );
  await runCauseEffect(channels.cancelTask(snapshot(routineChannel.channelId, routineTask.id), actor));
  assert.equal(
    scheduler
      .listRuns({ channelId: routineChannel.channelId, routineId: routine.id })
      .find((item) => item.id === run.id)?.status,
    "cancelled",
  );
  const failedRun = await runCauseEffect(
    scheduler.test({ channelId: routineChannel.channelId, routineId: routine.id }),
  );
  const failedTask = channels.store
    .tasks(routineChannel.channelId)
    .find((item) => item.requestMessageId === failedRun.requestMessageId);
  assert.ok(failedTask);
  channels.store.update(channels.store.get(routineChannel.channelId), {
    tasks: [{ ...failedTask, state: "failed", error: "Synthetic routine failure." }],
  });
  scheduler.reconcile(routineChannel.channelId);
  assert.equal(
    scheduler
      .listRuns({ channelId: routineChannel.channelId, routineId: routine.id })
      .find((item) => item.id === failedRun.id)?.status,
    "failed",
  );
  await runCauseEffect(channels.cancelTask(snapshot(routineChannel.channelId, failedTask.id), actor));
  assert.equal(
    scheduler
      .listRuns({ channelId: routineChannel.channelId, routineId: routine.id })
      .find((item) => item.id === failedRun.id)?.status,
    "cancelled",
  );
  const noWork = await runCauseEffect(scheduler.test({ channelId: routineChannel.channelId, routineId: routine.id }));
  const noWorkTask = channels.store
    .tasks(routineChannel.channelId)
    .find((item) => item.requestMessageId === noWork.requestMessageId);
  assert.ok(noWorkTask);
  channels.store.update(channels.store.get(routineChannel.channelId), {
    tasks: [{ ...noWorkTask, state: "cancelled", error: null }],
  });
  scheduler.reconcile(routineChannel.channelId);
  assert.equal(
    scheduler
      .listRuns({ channelId: routineChannel.channelId, routineId: routine.id })
      .find((item) => item.id === noWork.id)?.status,
    "succeeded",
  );
  report.cases.push(
    "Stopped and already-failed routine user cancellation reports cancelled; the released lead no-work outcome remains succeeded.",
  );

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const remote = teamChannelsApi(async (method, path, decode, body) => {
    const response = await fetch(new URL(path, base), {
      method,
      headers: { "content-type": "application/json", "x-fixture-actions": "yes" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Fixture HTTP status ${response.status}`);
    return decode(await response.json());
  });
  const httpFixture = await fixture("remote cancellation");
  const httpInput = snapshot(httpFixture.channelId, httpFixture.taskId);
  const denied = await fetch(new URL(CHANNEL_TASK_CANCEL_PATH, base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(httpInput),
  });
  assert.equal(denied.status, 400);
  assert.equal(task(httpFixture.channelId, httpFixture.taskId).state, "paused");
  const malformed = await fetch(new URL(CHANNEL_TASK_CANCEL_PATH, base), {
    method: "POST",
    headers: { "content-type": "application/json", "x-fixture-actions": "yes" },
    body: JSON.stringify({ ...httpInput, expectedRevision: -1 }),
  });
  assert.equal(malformed.status, 400);
  assert.equal((await fetch(new URL(CHANNEL_TASK_CANCEL_PATH, base))).status, 404);
  const cancelled = await remote.cancelChannelTask(httpInput);
  assert.equal(cancelled.id, httpFixture.channelId);
  assert.equal(task(httpFixture.channelId, httpFixture.taskId).state, "cancelled");
  const recoverHttp = await fixture("remote recovery");
  await remote.recoverChannelTask({
    ...snapshot(recoverHttp.channelId, recoverHttp.taskId),
    action: "reassign",
    recipientAgentId: agent.id,
  });
  assert.equal(task(recoverHttp.channelId, recoverHttp.taskId).state, "queued");
  assert.deepEqual(channelRequest(CHANNEL_ROUTES.command, { ...httpInput, type: "cancel", recipientAgentId: null }), {
    type: "cancel",
    operationId: httpInput.operationId,
    channelId: httpInput.channelId,
    taskId: httpInput.taskId,
    recipientAgentId: null,
  });
  assert.throws(() => parseCancelChannelTask({ ...httpInput, expectedChannelRevision: undefined }));
  assert.throws(() => parseRecoverChannelTask({ ...httpInput, action: "reassign", recipientAgentId: null }));
  assert.throws(() => parseRecoverChannelTask({ ...httpInput, action: "resume", recipientAgentId: agent.id }));
  const cancelCodec = teamSideRouteCodec(CHANNEL_TASK_CANCEL_PATH);
  const recoveryCodec = teamSideRouteCodec(CHANNEL_TASK_RECOVER_PATH);
  assert.ok(cancelCodec && recoveryCodec);
  const wireFixture = (name: string) =>
    JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "../packages/contracts/src/team-protocol/fixtures/channel-task-actions-v1", name),
        "utf8",
      ),
    );
  const cancelRequest = wireFixture("client-cancel-request.json");
  const recoverRequest = wireFixture("client-recover-request.json");
  const actionResponse = wireFixture("host-action-response.json");
  const errorResponse = wireFixture("host-error-response.json");
  assert.deepEqual(cancelCodec.request(CHANNEL_TASK_CANCEL_PATH, cancelRequest), cancelRequest);
  assert.deepEqual(recoveryCodec.request(CHANNEL_TASK_RECOVER_PATH, recoverRequest), recoverRequest);
  assert.deepEqual(cancelCodec.response(CHANNEL_TASK_CANCEL_PATH, 200, actionResponse), actionResponse);
  assert.deepEqual(recoveryCodec.response(CHANNEL_TASK_RECOVER_PATH, 200, actionResponse), actionResponse);
  assert.deepEqual(cancelCodec.response(CHANNEL_TASK_CANCEL_PATH, 400, errorResponse), errorResponse);
  for (const invalid of [
    { ...httpInput, channelId: "" },
    { ...httpInput, taskId: "x".repeat(129) },
    { ...httpInput, operationId: null },
    { ...httpInput, expectedRevision: 1.5 },
    { ...httpInput, expectedChannelRevision: -1 },
  ])
    assert.throws(() => cancelCodec.request(CHANNEL_TASK_CANCEL_PATH, invalid));
  assert.throws(() =>
    recoveryCodec.request(CHANNEL_TASK_RECOVER_PATH, { ...httpInput, action: "resume", recipientAgentId: agent.id }),
  );
  assert.throws(() =>
    recoveryCodec.request(CHANNEL_TASK_RECOVER_PATH, { ...httpInput, action: "delete", recipientAgentId: null }),
  );
  assert.ok(teamSideRouteCodec(CHANNEL_TASK_RECOVER_PATH));
  const legacyCapabilities = legacyTeamCapabilities(TEAM_CURRENT_CAPABILITIES);
  assert.ok(legacyCapabilities.length <= 64);
  assert.ok(!legacyCapabilities.includes(CHANNEL_TASK_ACTIONS_CAPABILITY));
  for (const protocol of [7, 8]) {
    const capabilities = teamCapabilitiesForProtocol(protocol);
    assert.ok(!capabilities.includes(CHANNEL_TASK_ACTIONS_CAPABILITY));
    assert.ok(capabilities.length <= 128);
  }
  assert.ok(teamCapabilitiesForProtocol(9).includes(CHANNEL_TASK_ACTIONS_CAPABILITY));
  report.cases.push(
    "Remote client drives real HTTP routes; capability/method/payload gates fail closed and frozen commands stay unchanged for old peers.",
  );
  for (const text of [
    sourceText("error.backend.channelTaskCancelled"),
    sourceText("error.backend.channelTaskChanged"),
    sourceText("error.backend.channelTaskNotStopped"),
    sourceText("error.backend.channelTaskDependencyCancelled"),
    sourceText("error.backend.channelTaskCancelUnsupported"),
    sourceText("error.backend.channelTaskActionsUnsupported"),
    sourceText("status.agent.channelTaskCancelled", { person: actor.name, task: original.id }),
  ])
    assert.equal(matchingSourceKeys(text).length, 1);

  scheduler = null;
  await runCauseEffect(channels.stop());
  database.close();
  await Effect.runPromise(database.initialize());
  channels = new ChannelService(database, mailbox, images, hooks);
  await runCauseEffect(channels.cancelTask(cancel, actor));
  assert.deepEqual(channels.store.page(first.channelId), after);
  await runCauseEffect(channels.recover());
  assert.equal(task(first.channelId, original.id).state, "cancelled");
  assert.equal(task(first.channelId, child.id).state, "cancelled");
  assert.deepEqual(errors, []);
  assert.equal(generations, 0);
  report.providerGenerations = generations;
  report.cases.push(
    "Restart retains cancellation receipts, history and cancelled tasks; startup recovery starts no cancelled work.",
  );
  report.passed = true;
} finally {
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (server.listening)
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await runCauseEffect(channels.stop()).catch(() => undefined);
  database.close();
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
