import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentSummary, ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { ChannelImages } from "../src/backend/channel-images";
import { ChannelService } from "../src/backend/channel-service";
import type { ChannelAssignment } from "../src/backend/channel-store";
import { withTransaction } from "../src/backend/database/sqlite-transaction";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/channel-large-history-e2e");
const PERSON = { id: "member-e2e", name: "Owner" };
const HISTORY_MESSAGES = 20_000;
const SETTLED_TASKS = 3_000;
const SNAPSHOT_HISTORY = 2_000;
const RUNS = 5;
const ANSWER_BODY = " Details of the earlier work.".repeat(50);

const agent = (id: string, name: string): AgentSummary => ({
  id,
  name,
  title: "",
  description: "",
  notifications: false,
  provider: "codex",
  model: "gpt-5.5",
  reasoningEffort: "xhigh",
  threadId: null,
  workspacePath: "/workspace",
  preview: "",
  updatedAt: null,
  avatarSeed: id,
  avatarHue: null,
  avatarUrl: null,
});
const lead = agent("agent-lead", "Lead");
const writer = agent("agent-writer", "Writer");
const helper = agent("agent-helper", "Helper");
const agents = [lead, writer, helper];

function task(channelId: string, id: string, ownerAgentId: string | null, state: string) {
  return {
    id,
    channelId,
    parentTaskId: null,
    rootTaskId: id,
    ownerAgentId,
    requestMessageId: `${channelId}-request`,
    instruction: `Do ${id}.`,
    attachmentDraftIds: [],
    expectedResult: "",
    sourceMessageIds: [],
    dependencies: [],
    resources: [],
    state,
    revision: 0,
    assignmentCount: 1,
    error: null,
  };
}

function assignment(
  channelId: string,
  id: string,
  taskId: string,
  agentId: string,
  state: ChannelAssignment["state"],
  turnId: string | null,
): ChannelAssignment {
  return {
    id,
    channelId,
    taskId,
    agentId,
    taskRevision: 0,
    requestMessageId: null,
    resources: [],
    deliveryId: null,
    turnId,
    state,
    throughSequence: 0,
    summaryVersion: 0,
    awaitedTaskIds: [],
    pendingRevision: null,
    pendingOutcome: null,
  };
}

function historyMessage(channelId: string, sequence: number) {
  const id = `history-${sequence}`;
  return {
    id,
    channelId,
    sequence,
    author: { kind: "agent", id: writer.id, name: writer.name },
    taskId: `settled-${sequence % SETTLED_TASKS}`,
    superseded: false,
    message: {
      id,
      turnId: `turn-history-${sequence}`,
      author: "assistant",
      text: `Earlier answer ${sequence}.${ANSWER_BODY}`,
      status: "completed",
      createdAt: "2026-11-20T00:00:00.000Z",
    },
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function timed(run: () => void): number {
  const startedAt = performance.now();
  run();
  return performance.now() - startedAt;
}

const report: {
  counts?: Record<string, number>;
  waitingWork?: Record<string, boolean>;
  capture?: { written: boolean; taskId: string | null; repeatChangedRevision: boolean };
  medianMs?: Record<string, number>;
  passed: boolean;
  failure?: string;
} = { passed: false };

const directory = await mkdtemp(join(tmpdir(), "openbot-channel-large-history-"));
const database = new OpenBotDatabase(directory);

try {
  await Effect.runPromise(database.initialize());
  const mailbox = new MailboxStore(directory, join(directory, "shared"), database);
  const service = new ChannelService(database, mailbox, new ChannelImages(join(directory, "channel-images")), {
    agents: () => agents,
    generate: () => Effect.never,
    schedule: () => {},
    interrupt: () => Effect.void,
    busy: () => false,
    changed: () => {},
    error: (error) => {
      throw error;
    },
  });
  const channelId = randomUUID();
  await runCauseEffect(
    service.command(
      {
        type: "save",
        operationId: randomUUID(),
        channelId,
        draft: {
          name: "Large history",
          title: "",
          instructions: "",
          members: agents.map((item) => ({ agentId: item.id })),
          leadAgentId: lead.id,
        },
      },
      PERSON,
    ),
  );
  const { threadId } = service.store.context(channelId, writer.id);

  const connection = database.connection;
  const insertMessage = connection.prepare(
    "INSERT INTO projection_channel_messages (channel_id, message_id, sequence, message_json) VALUES (?, ?, ?, ?)",
  );
  const insertTask = connection.prepare(
    "INSERT INTO projection_channel_tasks (task_id, channel_id, task_json) VALUES (?, ?, ?)",
  );
  const insertAssignment = connection.prepare(
    "INSERT INTO projection_channel_assignments (assignment_id, channel_id, task_id, assignment_json) VALUES (?, ?, ?, ?)",
  );
  const addTask = (value: ReturnType<typeof task>) => insertTask.run(value.id, channelId, JSON.stringify(value));
  const addAssignment = (value: ChannelAssignment) =>
    insertAssignment.run(value.id, channelId, value.taskId, JSON.stringify(value));
  withTransaction(connection, () => {
    for (let index = 0; index < SETTLED_TASKS; index += 1) {
      addTask(task(channelId, `settled-${index}`, writer.id, index % 50 === 0 ? "cancelled" : "completed"));
      addAssignment(
        assignment(
          channelId,
          `settled-assignment-${index}`,
          `settled-${index}`,
          writer.id,
          "completed",
          `turn-${index}`,
        ),
      );
    }
    for (let sequence = 1; sequence <= HISTORY_MESSAGES; sequence += 1) {
      const entry = historyMessage(channelId, sequence);
      insertMessage.run(channelId, entry.id, sequence, JSON.stringify(entry));
    }
    addTask(task(channelId, "queued-for-writer", writer.id, "queued"));
    addTask(task(channelId, "queued-for-helper-assigned", helper.id, "queued"));
    addAssignment(assignment(channelId, "helper-queued", "queued-for-helper-assigned", helper.id, "queued", null));
    addTask(task(channelId, "live", writer.id, "running"));
    addAssignment(assignment(channelId, "writer-live", "live", writer.id, "running", "turn-live"));
  });

  report.counts = {
    historyMessages: HISTORY_MESSAGES,
    settledTasks: SETTLED_TASKS,
    settledAssignments: SETTLED_TASKS,
    snapshotMessages: SNAPSHOT_HISTORY + 1,
  };

  report.waitingWork = Object.fromEntries(agents.map((item) => [item.id, service.ownsWaitingWork(item.id)]));
  assert.equal(report.waitingWork[writer.id], true, "A queued task with no assignment was not found as waiting work.");
  assert.equal(
    report.waitingWork[helper.id],
    false,
    "A queued task with an active assignment counted as waiting work.",
  );
  assert.equal(report.waitingWork[lead.id], false, "The lead got waiting work that another member owns.");

  const history: ConversationMessage[] = Array.from({ length: SNAPSHOT_HISTORY }, (_, index) => ({
    id: `history-${HISTORY_MESSAGES - index}`,
    turnId: `turn-history-${HISTORY_MESSAGES - index}`,
    author: "assistant",
    text: `Earlier answer ${HISTORY_MESSAGES - index}`,
    status: "completed",
    createdAt: "2026-11-20T00:00:00.000Z",
  }));
  const live: ConversationMessage = {
    id: "live-answer",
    turnId: "turn-live",
    author: "assistant",
    text: "The live answer.",
    status: "completed",
    itemType: "agentMessage",
    createdAt: "2026-11-27T00:00:00.000Z",
  };
  const snapshot: ConversationSnapshot = {
    agentId: writer.id,
    threadId,
    activeTurnId: "turn-live",
    revision: 1,
    messages: [...history.reverse(), live],
  };
  const firstCaptureMs = timed(() => assert.equal(service.event({ type: "conversation", snapshot }), true));
  const written = service.store.message(channelId, live.id);
  const revision = service.store.get(channelId).revision;
  const repeatMs = Array.from({ length: RUNS }, () => timed(() => service.event({ type: "conversation", snapshot })));
  report.capture = {
    written: written !== null,
    taskId: written?.taskId ?? null,
    repeatChangedRevision: service.store.get(channelId).revision !== revision,
  };
  assert.equal(report.capture.written, true, "The live answer did not reach the channel.");
  assert.equal(report.capture.taskId, "live", "The live answer is not on the task of its running assignment.");
  assert.equal(report.capture.repeatChangedRevision, false, "The same snapshot wrote the channel again.");
  assert.equal(service.store.message(channelId, "history-1")?.message.text, `Earlier answer 1.${ANSWER_BODY}`);

  report.medianMs = {
    waitingWork: median(
      Array.from({ length: RUNS }, () => timed(() => agents.map((item) => service.ownsWaitingWork(item.id)))),
    ),
    fullHistoryRead: median(
      Array.from({ length: RUNS }, () =>
        timed(() => {
          service.store.tasks(channelId);
          service.store.assignments(channelId);
          service.store.messages(channelId);
        }),
      ),
    ),
    firstCapture: firstCaptureMs,
    repeatCapture: median(repeatMs),
  };
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
} finally {
  database.close();
  await rm(directory, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
