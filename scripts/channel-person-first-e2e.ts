// Checks that a person's request in a channel starts before the queued subtasks of a lead (#8761), on
// the real SQLite, the real mailbox and the real channel service, on a temporary profile. No provider,
// account or network is started. The lead waits for three subtasks: two run, so the channel is full,
// and one is queued. The person then asks the lead a question. When one subtask ends, the question
// takes the free place, and the queued subtask waits for the next one. While the question runs, the
// next free place goes in the order the tasks were made: the queued subtask starts before a later
// routine request and before a later message of a person, so delegated work is not held back for ever.
//
// Run: bun scripts/channel-person-first-e2e.ts
// Writes .openbot-build/channel-person-first-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AgentSummary, CHANNEL_PARALLEL_LIMIT, type ChannelTask } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { ChannelImages } from "../src/backend/channel-images";
import { ChannelService } from "../src/backend/channel-service";
import type { ChannelAssignment } from "../src/backend/channel-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/channel-person-first-e2e");
const PERSON = { id: "member-e2e", name: "Owner" };
const WAIT_MS = 5_000;

interface Report {
  started: { question: boolean; queuedSubtask: boolean; activeInChannel: number } | null;
  next?: { queuedSubtask: boolean; routine: boolean; personFollowUp: boolean };
  passed: boolean;
  failure?: string;
}
const report: Report = { started: null, passed: false };

const agent = (id: string, name: string): AgentSummary => ({
  id,
  name,
  title: "",
  description: "",
  notifications: false,
  provider: "codex",
  model: "gpt-5.5",
  reasoningEffort: "medium",
  threadId: null,
  workspacePath: "/workspace",
  preview: "",
  updatedAt: null,
  avatarSeed: id,
  avatarHue: null,
  avatarUrl: null,
});
const lead = agent("agent-lead", "Chief of Staff");
const workers = [agent("agent-one", "Ana"), agent("agent-two", "Ben"), agent("agent-three", "Cleo")];
const agents = [lead, ...workers];

const directory = await mkdtemp(join(tmpdir(), "openbot-channel-person-first-"));
const database = new OpenBotDatabase(directory);
let channels: ChannelService | null = null;

const active = (assignment: ChannelAssignment) =>
  assignment.state === "starting" || assignment.state === "running" || assignment.state === "queued";

/** Waits for the channel to hold a state, not for a time. */
async function until<T>(read: () => T | undefined, what: string): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${what}`);
    await new Promise((done) => setImmediate(done));
  }
}

try {
  await Effect.runPromise(database.initialize());
  const service = new ChannelService(
    database,
    new MailboxStore(directory, join(directory, "shared"), database),
    new ChannelImages(join(directory, "channel-images")),
    {
      agents: () => agents,
      generate: () => Effect.die(new Error("No routing runs in this test.")),
      schedule: () => {},
      interrupt: () => Effect.void,
      busy: () => false,
      changed: () => {},
      error: (error) => {
        throw error;
      },
    },
  );
  channels = service;
  const channelId = randomUUID();
  await runCauseEffect(
    service.command(
      {
        type: "save",
        operationId: randomUUID(),
        channelId,
        draft: {
          name: "Launch",
          title: "Prepare the launch",
          instructions: "",
          members: agents.map((item) => ({ agentId: item.id })),
          leadAgentId: lead.id,
        },
      },
      PERSON,
    ),
  );
  const send = (text: string) =>
    runCauseEffect(
      service.command(
        {
          type: "send",
          operationId: randomUUID(),
          channelId,
          text,
          recipientAgentId: lead.id,
          replyToMessageId: null,
          attachmentDraftIds: [],
        },
        PERSON,
      ),
    );
  const assignmentOf = (taskId: string) =>
    service.store.assignments(channelId).find((item) => item.taskId === taskId && active(item));

  // The person's first request starts the lead. The lead gives three subtasks and waits for them.
  await send("Prepare the launch notes with the team.");
  const request = await until(
    () => service.store.tasks(channelId).find((task) => task.parentTaskId === null),
    "the first request",
  );
  const leadTurn = await until(() => assignmentOf(request.id), "the lead's first turn");
  const subtasks = workers.map(
    (worker, index): ChannelTask => ({
      ...request,
      id: randomUUID(),
      parentTaskId: request.id,
      ownerAgentId: worker.id,
      requestMessageId: randomUUID(),
      instruction: `Write part ${index + 1} of the notes.`,
      sourceMessageIds: [],
      dependencies: [],
      state: index < CHANNEL_PARALLEL_LIMIT ? "running" : "queued",
      revision: 1,
      assignmentCount: index < CHANNEL_PARALLEL_LIMIT ? 1 : 0,
    }),
  );
  const work = subtasks.slice(0, CHANNEL_PARALLEL_LIMIT).map(
    (task): ChannelAssignment => ({
      ...leadTurn,
      id: randomUUID(),
      taskId: task.id,
      agentId: task.ownerAgentId ?? "",
      taskRevision: task.revision,
      requestMessageId: task.requestMessageId,
      deliveryId: null,
      turnId: null,
      state: "running",
      awaitedTaskIds: [],
    }),
  );
  service.store.update(service.store.get(channelId), {
    tasks: [{ ...request, state: "waiting", dependencies: subtasks.map((task) => task.id) }, ...subtasks],
    assignments: [{ ...leadTurn, state: "completed" }, ...work],
  });

  // The channel is full, so the question waits.
  await send("Is only one worker active?");
  const question = await until(
    () =>
      service.store
        .tasks(channelId)
        .find((task) => task.parentTaskId === null && task.id !== request.id && task.state === "queued"),
    "the question",
  );
  assert.equal(assignmentOf(question.id), undefined, "The question started while the channel was full.");

  // One subtask ends. The question takes its place before the queued subtask.
  const [ended] = work;
  const [endedTask, , queuedSubtask] = subtasks;
  assert.ok(ended && endedTask && queuedSubtask);
  service.store.update(service.store.get(channelId), {
    tasks: [{ ...endedTask, state: "completed" }],
    assignments: [{ ...ended, state: "completed" }],
  });
  await runCauseEffect(service.wake(channelId));
  await until(() => assignmentOf(question.id), "the question to start after a subtask ended");
  report.started = {
    question: true,
    queuedSubtask: assignmentOf(queuedSubtask.id) !== undefined,
    activeInChannel: service.store.assignments(channelId).filter(active).length,
  };
  assert.deepEqual(report.started, { question: true, queuedSubtask: false, activeInChannel: CHANNEL_PARALLEL_LIMIT });

  // While the question runs, the next place goes in the order the tasks were made: the queued
  // subtask starts before a routine's request and before another message of a person.
  const routineMessageId = randomUUID();
  await runCauseEffect(
    service.command(
      {
        type: "request",
        operationId: randomUUID(),
        channelId,
        text: "Post the daily launch status.",
        recipientAgentId: workers[1]?.id ?? null,
        requestMessageId: routineMessageId,
        origin: { kind: "routine", routineId: "routine-e2e", routineName: "Daily status", runId: randomUUID() },
      },
      PERSON,
    ),
  );
  await runCauseEffect(
    service.command(
      {
        type: "send",
        operationId: randomUUID(),
        channelId,
        text: "Can you check the launch date?",
        recipientAgentId: workers[0]?.id ?? null,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      PERSON,
    ),
  );
  const tasks = service.store.tasks(channelId);
  const routine = tasks.find((task) => task.requestMessageId === routineMessageId);
  const followUp = tasks.find((task) => task.ownerAgentId === workers[0]?.id && task.state === "queued");
  const [, running] = work;
  const [, runningTask] = subtasks;
  assert.ok(routine && followUp && running && runningTask);
  service.store.update(service.store.get(channelId), {
    tasks: [{ ...runningTask, state: "completed" }],
    assignments: [{ ...running, state: "completed" }],
  });
  await runCauseEffect(service.wake(channelId));
  await until(() => assignmentOf(queuedSubtask.id), "the queued subtask to start");
  report.next = {
    queuedSubtask: true,
    routine: assignmentOf(routine.id) !== undefined,
    personFollowUp: assignmentOf(followUp.id) !== undefined,
  };
  assert.deepEqual(report.next, { queuedSubtask: true, routine: false, personFollowUp: false });
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (channels) await Effect.runPromise(channels.stop());
  database.close();
  await rm(directory, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
