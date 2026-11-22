import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { deliveryPromptInput } from "../src/backend/agent/delivery-content";
import { RoutineScheduler } from "../src/backend/agent/routine-scheduler";
import type { OpenBotToolResponse } from "../src/backend/agent/routine-tools";
import { AgentStore } from "../src/backend/agent-store";
import { AgentTasks } from "../src/backend/agent-tasks/agent-tasks";
import { AgentThreadStore } from "../src/backend/agent-threads/agent-thread-store";
import { AgentWaitStore } from "../src/backend/agent-waits/agent-wait-store";
import { AgentWaits, AWAIT_EVENT_TOOL } from "../src/backend/agent-waits/agent-waits";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { RoutineTimer } from "../src/backend/routine-timer";
import { parseCreateRoutine } from "../src/main/ipc/agent-inputs";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "agent-waits-side-thread-e2e");

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; steps: Step[] } = { passed: false, steps: [] };

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  try {
    const value = await run();
    report.steps.push({ name, passed: true, detail: value });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

function body(response: OpenBotToolResponse | null): { success: boolean; value: DynamicRecord } {
  assert.ok(response, "AgentWaits answers the tool.");
  const item = response.contentItems[0];
  assert.ok(item && item.type === "inputText", "The answer is text.");
  const value = JSON.parse(item.text);
  assert.ok(isDynamicRecord(value), "The answer is a JSON object.");
  return { success: response.success, value };
}

const root = await mkdtemp(join(tmpdir(), "openbot-agent-waits-side-thread-"));
const database = new OpenBotDatabase(join(root, "state"));
const store = new AgentStore(join(root, "state"), join(root, "home"), database);
const mailbox = new MailboxStore(join(root, "state"), store.sharedRoot, database);
const conversation = new ConversationRuntime(
  store,
  () => {},
  () => store.list(),
);
const threads = new AgentThreadStore(database);
const events: AgentEvent[] = [];
const tasks = new AgentTasks({
  store: threads,
  mailbox,
  conversation,
  hooks: {
    emit: (event) => events.push(event),
    agent: (agentId) => store.list().find((agent) => agent.id === agentId),
    defaultTaskLimit: () => 4,
    hold: () => null,
    queued: () => {},
    turnActive: () => false,
    archived: () => Effect.void,
    turnAnswer: () => null,
    closeTask: () => Effect.void,
    fork: (work) => {
      Effect.runFork(work);
    },
  },
});
const waits = new AgentWaits({
  store: new AgentWaitStore({ database }),
  mailbox,
  hooks: {
    emit: (event) => events.push(event),
    ownsRoutine: () => true,
    hasRoutine: () => true,
    requireKnownAgent: (agentId) => {
      conversation.requireKnownAgent(agentId);
    },
    isSideThread: (agentId, taskId) => tasks.isSideThread(agentId, taskId),
  },
});
const timer = new RoutineTimer(
  () => [],
  () => false,
  () => {},
);
const drains: string[] = [];
const scheduler = new RoutineScheduler({
  store,
  mailbox,
  conversation,
  timer,
  waits,
  timezone: () => "UTC",
  hooks: {
    emit: (event) => events.push(event),
    emitError: () => {},
    emitQueue: () => {},
    scheduleDrain: (agentId) => drains.push(agentId),
    interrupt: () => Effect.void,
    awaitDrain: () => undefined,
    syncMailboxMessages: () => {},
    listAgents: () => store.list(),
    excludedAgents: () => new Set(),
    isRunning: () => false,
    usageLimited: () => false,
    routineThread: () => null,
    waitThread: (agentId, taskId) => tasks.waitThread(agentId, taskId),
    queueHold: () => null,
    routineDeleted: () => Effect.void,
  },
});

let turn = 0;

async function requestInTurn(agentId: string, text: string, taskId?: string): Promise<string> {
  const receipt = await runCauseEffect(
    mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [agentId], text, ...(taskId ? { taskId } : {}) }),
  );
  const delivery = receipt.deliveries[0];
  assert.ok(delivery, "The request has a delivery.");
  const turnId = `side-thread-wait-turn-${++turn}`;
  await runCauseEffect(mailbox.markStarting(delivery.id));
  await runCauseEffect(mailbox.markRunning(delivery.id, turnId));
  return turnId;
}

function awaitEvent(agentId: string, threadId: string, turnId: string, note: string) {
  return body(
    waits.handleTool(
      {
        threadId,
        turnId,
        callId: crypto.randomUUID(),
        namespace: "openbot",
        tool: AWAIT_EVENT_TOOL,
        arguments: { note },
      },
      { agentId, inExecutionThread: false },
    ),
  );
}

function deliveryTask(deliveryId: string | null | undefined): string | null {
  assert.ok(deliveryId, "The run has a delivery.");
  return mailbox.taskIdForDelivery(deliveryId);
}

function promptText(agentId: string, deliveryId: string): string {
  const context = mailbox.getDelivery(deliveryId);
  assert.ok(context, "The delivery is stored.");
  const input = deliveryPromptInput(context, {
    agentNames: new Map(store.list().map((agent) => [agent.id, agent.name])),
    snapshot: { agentId, threadId: null, activeTurnId: null, revision: 0, messages: [] },
    routineRun: scheduler.runForDelivery(deliveryId),
    wokenWaits: scheduler.wokenWaits(deliveryId),
    continuesWait: scheduler.continuesWait(deliveryId),
    routineTimezone: "UTC",
  });
  return input.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
}

async function finish(agentId: string, deliveryIds: readonly (string | null | undefined)[]): Promise<void> {
  for (const deliveryId of deliveryIds) {
    if (!deliveryId) continue;
    if (mailbox.getDelivery(deliveryId)?.delivery.status === "queued")
      await runCauseEffect(mailbox.cancel(agentId, deliveryId));
  }
}

try {
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const agent = await runCauseEffect(
    store.createAgent({ name: "Builder", description: "Waits for builds", avatarSeed: "side-wait", avatarHue: null }),
  );
  const routine = scheduler.create(
    parseCreateRoutine({
      agentId: agent.id,
      name: "Build finished",
      instruction: "Check the result of the build.",
      active: false,
      timezone: "UTC",
      schedule: { kind: "custom", expression: "0 9 * * *" },
    }),
    { recordConversationEvent: false },
  );
  const side = tasks.create(agent.id, "Run the long build", "user");

  const opened = await step("A side thread and the agent's own chat each open a wait", async () => {
    const chatTurn = await requestInTurn(agent.id, "Deploy the site.");
    const chat = awaitEvent(agent.id, agent.threadId ?? "", chatTurn, "Deploy runs");
    assert.equal(chat.success, true);
    const sideTurn = await requestInTurn(agent.id, "Build the release and tell me the result.", side.taskId);
    const fromSide = awaitEvent(agent.id, side.threadId, sideTurn, "Release build runs");
    assert.equal(fromSide.success, true, "await_event works in a side thread.");
    assert.equal(waits.sideThreadOfWait(agent.id, String(fromSide.value.waitId)), side.taskId);
    assert.equal(waits.sideThreadOfWait(agent.id, String(chat.value.waitId)), null);
    return { chatWait: String(chat.value.waitId), sideWait: String(fromSide.value.waitId) };
  });

  await step("A routine run continues each wait in the chat where it opened", async () => {
    const run = await runCauseEffect(
      scheduler.runWithPayload({ agentId: agent.id, routineId: routine.id, payload: "exit 0", source: "script" }),
    );
    assert.equal(deliveryTask(run.deliveryId), null, "The run stays in the agent's own chat.");
    const chatWoken = waits.wokenBy(run.deliveryId ?? "");
    assert.deepEqual(
      chatWoken.map((wait) => wait.id),
      [opened.chatWait],
      "The run continues only the wait of the own chat.",
    );
    const sideWait = waits.list(agent.id).waits.find((wait) => wait.id === opened.sideWait);
    assert.ok(sideWait?.wakeDeliveryId, "The side-thread wait is woken.");
    assert.notEqual(sideWait.wakeDeliveryId, run.deliveryId);
    assert.equal(deliveryTask(sideWait.wakeDeliveryId), side.taskId, "The side thread gets its own message.");
    const sideDelivery = mailbox.getDelivery(sideWait.wakeDeliveryId)?.delivery;
    assert.equal(sideDelivery?.sender.kind, "routine");
    assert.ok(sideDelivery?.text.includes("exit 0"), "The side thread gets the event of the script.");
    assert.deepEqual(
      scheduler.wokenWaits(sideWait.wakeDeliveryId).map((wait) => wait.id),
      [opened.sideWait],
      "The side-thread turn sees its wait.",
    );
    assert.ok(drains.includes(agent.id), "The side-thread message is drained.");
    const sidePrompt = promptText(agent.id, sideWait.wakeDeliveryId);
    assert.ok(sidePrompt.includes(opened.sideWait), "The side-thread turn names its wait.");
    assert.ok(
      !sidePrompt.includes("Perform the task below now"),
      "The side-thread turn does not run the routine again.",
    );
    assert.ok(
      promptText(agent.id, run.deliveryId ?? "").includes("Perform the task below now"),
      "The run does the task.",
    );
    assert.equal(
      waits.sideThreadOfWait(agent.id, opened.sideWait),
      null,
      "A script event does not take a side thread while its wake is pending.",
    );
    await finish(agent.id, [run.deliveryId, sideWait.wakeDeliveryId]);
    return { runDelivery: run.deliveryId, sideDelivery: sideWait.wakeDeliveryId };
  });

  await step("A script event that names a side-thread wait runs in that side thread", async () => {
    const run = await runCauseEffect(
      scheduler.runWithPayload({
        agentId: agent.id,
        routineId: routine.id,
        payload: "exit 1",
        source: "script",
        waitId: opened.sideWait,
      }),
    );
    assert.equal(deliveryTask(run.deliveryId), side.taskId, "The run goes to the side thread.");
    assert.deepEqual(
      waits.wokenBy(run.deliveryId ?? "").map((wait) => wait.id),
      [opened.sideWait],
    );
    await finish(agent.id, [run.deliveryId]);
    return { runDelivery: run.deliveryId };
  });

  await step("An archived side thread opens again when its wait wakes", async () => {
    threads.close(side.taskId);
    assert.notEqual(threads.task(side.taskId)?.closedAt, null);
    const run = await runCauseEffect(
      scheduler.runWithPayload({
        agentId: agent.id,
        routineId: routine.id,
        payload: "exit 0",
        source: "script",
        waitId: opened.sideWait,
      }),
    );
    assert.equal(deliveryTask(run.deliveryId), side.taskId);
    assert.equal(threads.task(side.taskId)?.closedAt, null, "The side thread is open again.");
    await finish(agent.id, [run.deliveryId]);
    return { runDelivery: run.deliveryId };
  });

  await step("A side-thread message whose wait closed still does not run the routine again", async () => {
    const sideTurn = await requestInTurn(agent.id, "Tell me when the nightly build ends.", side.taskId);
    const opened = awaitEvent(agent.id, side.threadId, sideTurn, "Nightly build runs");
    const waitId = String(opened.value.waitId);
    const run = await runCauseEffect(
      scheduler.runWithPayload({ agentId: agent.id, routineId: routine.id, payload: "exit 0", source: "script" }),
    );
    const wakeDeliveryId = waits.list(agent.id).waits.find((wait) => wait.id === waitId)?.wakeDeliveryId;
    assert.ok(wakeDeliveryId && wakeDeliveryId !== run.deliveryId, "The side thread gets its own message.");
    for (const wait of scheduler.wokenWaits(wakeDeliveryId)) waits.cancel(agent.id, wait.id);
    assert.deepEqual(scheduler.wokenWaits(wakeDeliveryId), [], "Each wait of the side-thread message is closed.");
    const sidePrompt = promptText(agent.id, wakeDeliveryId);
    assert.ok(!sidePrompt.includes("Perform the task below now"), "The closed wait does not start a second run.");
    const handoff = await runCauseEffect(
      scheduler.enqueueHandoff({
        run,
        agentId: agent.id,
        text: "Publish the build notes.",
        idempotencyKey: `handoff:${run.id}`,
      }),
    );
    assert.equal(scheduler.continuesWait(handoff), false, "A routine flow handoff is not a wait message.");
    assert.ok(promptText(agent.id, handoff).includes("Perform the task below now"), "A handoff does its task.");
    await finish(agent.id, [run.deliveryId, wakeDeliveryId, handoff]);
    return { runDelivery: run.deliveryId, sideDelivery: wakeDeliveryId, handoff };
  });

  await step("A thread that the agent started is not a side thread for waits", async () => {
    const delegated = tasks.create(agent.id, "Check the logs", "agent");
    assert.equal(tasks.isSideThread(agent.id, delegated.taskId), false);
    assert.equal(tasks.waitThread(agent.id, delegated.taskId), null);
    return { taskId: delegated.taskId };
  });

  report.passed = true;
} finally {
  timer.dispose();
  conversation.dispose();
  database.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}
