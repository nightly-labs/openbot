// Checks that one agent can start an independent side thread for another agent and that the answers
// keep their routing (#8134). It runs the real SQLite database, mailbox store, agent thread store,
// agent tasks and conversation runtime on a temporary profile. No app, provider, account or network
// is started: the agents are roster rows only, no turn ever runs, and the script sends the exact
// enqueue inputs that the `send_message` tool path and the automatic result relay produce. The
// scheduling chain is checked through the lane reads that the drain scheduler makes (`listQueue`,
// `queuedTaskMessages`, `taskBusy`, `laneActive`), beside a `start_task` brief that takes the same
// path.
//
// 1. A plain `send_message` (no `newThread`) keeps the old routing: the request waits in B's own
//    chat queue, and no task exists.
// 2. A new-thread send creates one open task of B, named by the message's first line, and the
//    request runs in that task's lane: B's own chat and queue do not show it.
// 3. A retried call with the same idempotency key finds the same task and starts no second one.
// 4. A's own chat shows the outgoing request; B's chat hides it.
// 5. B's automatic result for the request comes back to A's own chat, as the relay routes it.
// 6. A later reply to the result, or to A's own request, continues the task: it runs in the task's
//    lane, and B's chat still hides it.
// 7. A reply to a message that no thread owns routes to B's own chat.
// 8. A request that a Slack turn sent keeps its external return: a reply to it does not go to the task.
// 9. The relay direction is unchanged: a result for a task request never routes into that task.
// 10. When A asks from its own side thread, the request carries that thread id, the result comes
//     back to that side thread, and a reply to the result continues B's task.
// 11. The limits of `start_task` hold for a teammate's thread: the ninth unfinished task is
//     refused, a full task list is, and the oldest finished tasks that the agent started give way.
// Writes .openbot-build/teammate-new-thread-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { AgentTasks } from "../src/backend/agent-tasks/agent-tasks";
import { AgentThreadStore } from "../src/backend/agent-threads/agent-thread-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/teammate-new-thread-e2e");

interface Step {
  name: string;
  details: Record<string, string | number | boolean | null>;
  error?: string;
}

const report: { steps: Step[]; passed: boolean } = { steps: [], passed: false };
const step = (name: string, details: Step["details"]): void => {
  report.steps.push({ name, details });
  process.stdout.write(`${name}: passed\n`);
};

const root = await mkdtemp(join(tmpdir(), "openbot-teammate-thread-"));
try {
  const database = new OpenBotDatabase(join(root, "state"));
  const store = new AgentStore(join(root, "state"), join(root, "home"), database);
  await runCauseEffect(store.initialize());

  const agent = (id: string, name: string, threadId: string): AgentSummary => ({
    id,
    provider: "codex",
    name,
    title: name,
    description: "",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
    threadId,
    workspacePath: join(root, id),
    preview: "",
    updatedAt: "2026-11-14T00:00:00.000Z",
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
  });
  const alpha = agent("agent-alpha", "Alpha", "openbot-thread-alpha");
  const beta = agent("agent-beta", "Beta", "openbot-thread-beta");
  database.replaceAgents("teammate-new-thread-e2e", [alpha, beta], "agents.updated");

  const mailbox = new MailboxStore(join(root, "state"), store.sharedRoot, database);
  await runCauseEffect(mailbox.initialize());

  const conversation = new ConversationRuntime(
    store,
    () => {},
    () => store.list(),
  );
  const threadStore = new AgentThreadStore(database);
  const archivedTasks: string[] = [];
  const tasks = new AgentTasks({
    store: threadStore,
    mailbox,
    conversation,
    hooks: {
      emit: () => {},
      agent: (agentId) => store.list().find((entry) => entry.id === agentId),
      hold: () => null,
      defaultTaskLimit: () => 4,
      queued: () => {},
      turnActive: (agentId, threadId) => database.readActiveTurnId(agentId, threadId) !== null,
      archived: (_agentId, closed) =>
        Effect.sync(() => {
          for (const task of closed) archivedTasks.push(task.taskId);
        }),
    },
  });

  /** The idempotency key that one `send_message` tool call uses for one recipient. */
  const callKey = (callId: string, recipient: string) => `teammate-thread:e2e-${callId}-${recipient}`;
  /** The idempotency key that one automatic teammate result uses. */
  const resultKey = (turnId: string, messageId: string) => `auto-result:${turnId}:${messageId}`;

  const chat = (agentId: string) => mailbox.conversationMessages(agentId);
  const has = (agentId: string, text: string) => chat(agentId).some((message) => message.text.includes(text));
  /** The message of the typed failure that `run` rejects with, or an empty string when it passes. */
  const refusedMessage = async (run: () => Promise<unknown>): Promise<string> => {
    try {
      await run();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    return "";
  };

  // -- 1. A plain send keeps the old routing. ---------------------------------------------
  {
    const plain = `plain${crypto.randomUUID().slice(0, 6)} request from Alpha`;
    const receipt = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: alpha.id },
        recipientAgentIds: [beta.id],
        text: plain,
        replyToMessageId: null,
        idempotencyKey: `plain:${crypto.randomUUID()}`,
      }),
    );
    assert.ok(
      chat(beta.id).some((message) => message.text.includes(plain)),
      "B's chat keeps the plain request",
    );
    assert.equal(
      mailbox.listQueue(beta.id).deliveries.some((delivery) => delivery.id === receipt.deliveries[0]?.id),
      true,
      "B's own chat queue shows the plain request",
    );
    assert.equal(tasks.openTaskIds(beta.id).length, 0, "a plain request starts no task");
    step("1-plain-routing-unchanged", { plainMessageId: receipt.messageId });
  }

  // -- 2. The new-thread send starts B's task, and the request runs in its lane. ------------
  const run = crypto.randomUUID().slice(0, 6);
  const requestText = `Review the pull request ${run}\nThe branch is feat/teammate-new-thread-8134.`;
  const titleLine = `Review the pull request ${run}`;
  let taskId = "";
  let requestId = "";
  {
    const task = await runCauseEffect(tasks.teammateThread(beta.id, requestText));
    taskId = task.taskId;
    assert.equal(task.agentId, beta.id, "the task belongs to the recipient");
    assert.equal(task.origin, "agent", "an agent started the task");
    assert.equal(task.title, titleLine, "the title is the message's first line");
    assert.match(task.threadId, /^openbot-thread-/, "the task has a thread id");
    const receipt = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: alpha.id },
        recipientAgentIds: [beta.id],
        taskId: task.taskId,
        text: requestText,
        replyToMessageId: null,
        idempotencyKey: callKey("call-1", beta.id),
      }),
    );
    requestId = receipt.messageId;
    const deliveryId = receipt.deliveries[0]?.id ?? "";
    assert.equal(
      mailbox.listQueue(beta.id).deliveries.some((delivery) => delivery.id === deliveryId),
      false,
      "B's own chat queue hides the request",
    );
    assert.equal(
      mailbox.queuedTaskMessages(beta.id, task.taskId).some((message) => message.text.includes(requestText)),
      true,
      "the task lane holds the request",
    );
    assert.equal(mailbox.taskBusy(beta.id, task.taskId), true, "the task lane reads busy for the drain");
    assert.equal(
      mailbox.laneQueuedIds(beta.id, task.taskId).includes(deliveryId),
      true,
      "the drain's lane read sees the queued request",
    );
    assert.equal(
      mailbox.laneActive(beta.id, task.taskId),
      false,
      "no turn runs in the lane before the drain starts one",
    );
    // A `start_task` brief takes the same lane reads.
    const ownTask = await runCauseEffect(tasks.teammateThread(alpha.id, `Own brief ${run}`));
    await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: alpha.id },
        recipientAgentIds: [alpha.id],
        taskId: ownTask.taskId,
        text: `Own brief ${run}`,
        replyToMessageId: null,
        idempotencyKey: `brief:${ownTask.taskId}`,
      }),
    );
    assert.equal(mailbox.taskBusy(alpha.id, ownTask.taskId), true, "a start_task brief reads the same lane state");
    step("2-new-thread-lane", { taskId, requestId, threadId: task.threadId });
  }

  // -- 3. A retried call reuses the thread. -----------------------------------------------
  {
    const earlier = mailbox.deliveryForKey(callKey("call-1", beta.id));
    assert.ok(earlier, "the retried call finds the first message");
    const reused = tasks.require(beta.id, mailbox.taskIdForDelivery(earlier.delivery.id) ?? "");
    assert.equal(reused.taskId, taskId, "the retry reuses the first task");
    assert.equal(tasks.openTaskIds(beta.id).length, 1, "the retry starts no second task");
    step("3-retry-reuses-thread", { taskId: reused.taskId });
  }
  assert.equal(has(beta.id, requestText), false, "B's own chat hides the request");
  assert.equal(has(alpha.id, requestText), true, "A's own chat shows the outgoing request");
  step("4-chat-visibility", {
    inAlphaChat: chat(alpha.id).filter((message) => message.text.includes(requestText)).length,
  });

  // -- 5. B's automatic result comes back to A's own chat. ---------------------------------
  let resultId = "";
  {
    assert.equal(tasks.threadId(taskId) !== null, true, "the task is open before the result");
    // The relay asks for the thread that the answer to the request runs in, before it enqueues.
    assert.equal(
      mailbox.answerTaskId(beta.id, requestId, [alpha.id]),
      null,
      "a result for a request from A's chat goes to A's chat",
    );
    const receipt = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: beta.id },
        recipientAgentIds: [alpha.id],
        text: `Review done ${run}: two comments.`,
        replyToMessageId: requestId,
        expectsReply: false,
        idempotencyKey: resultKey("turn-1", requestId),
      }),
    );
    resultId = receipt.messageId;
    assert.equal(has(alpha.id, `Review done ${run}`), true, "A's chat shows the result");
    assert.equal(has(beta.id, `Review done ${run}`), true, "B's chat shows the result it sent");
    assert.equal(mailbox.expectsReply(requestId), true, "the request expected a reply");
    step("5-result-to-chat", { resultId });
  }

  // -- 6. A later reply continues the task. ------------------------------------------------
  {
    const followUp = `Add the test names ${run}`;
    assert.equal(
      mailbox.answerTaskId(alpha.id, resultId, [beta.id]),
      taskId,
      "a reply to the result continues the task",
    );
    assert.equal(
      mailbox.answerTaskId(alpha.id, requestId, [beta.id]),
      taskId,
      "a reply to the request continues the task",
    );
    const receipt = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: alpha.id },
        recipientAgentIds: [beta.id],
        taskId: mailbox.answerTaskId(alpha.id, resultId, [beta.id]) ?? undefined,
        text: followUp,
        replyToMessageId: resultId,
        idempotencyKey: `followup:${crypto.randomUUID()}`,
      }),
    );
    assert.equal(
      mailbox.queuedTaskMessages(beta.id, taskId).some((message) => message.text.includes(followUp)),
      true,
      "the follow-up runs in the task lane",
    );
    assert.equal(has(beta.id, followUp), false, "B's own chat hides the follow-up");
    step("6-reply-continues-thread", { followUpDeliveryId: receipt.deliveries[0]?.id ?? null });
  }

  // -- 7. A reply to a message that no thread owns routes to B's own chat. ------------------
  {
    const receipt = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: beta.id },
        recipientAgentIds: [alpha.id],
        text: `A plain question ${run}`,
        replyToMessageId: null,
        idempotencyKey: `question:${crypto.randomUUID()}`,
      }),
    );
    assert.equal(mailbox.answerTaskId(alpha.id, receipt.messageId, [beta.id]), null, "no thread owns the question");
    step("7-unrelated-reply-stays-in-chat", { questionId: receipt.messageId });
  }

  // -- 8. A request from an external conversation keeps its return. ------------------------
  {
    const external = {
      linkId: "link-slack",
      authorId: "slack-user-1",
      authorName: "Slack user",
      platformMessageId: "slack-msg-1",
    };
    const thread = await runCauseEffect(tasks.teammateThread(beta.id, `External ask ${run}`));
    const receipt = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: alpha.id },
        recipientAgentIds: [beta.id],
        taskId: thread.taskId,
        text: `External ask ${run}`,
        replyToMessageId: null,
        messagingReturn: external,
        idempotencyKey: `external:${crypto.randomUUID()}`,
      }),
    );
    assert.ok(mailbox.deliveryForKey(`external:${crypto.randomUUID()}`) === null, "an unknown key finds nothing");
    assert.equal(
      mailbox.answerTaskId(alpha.id, receipt.messageId, [beta.id]),
      null,
      "a reply to an external request stays in the external conversation",
    );
    step("8-messaging-return-guard", { externalId: receipt.messageId, threadId: thread.threadId });
  }
  assert.equal(
    mailbox.answerTaskId(beta.id, requestId, [alpha.id]),
    null,
    "a result never routes into the task that the request ran in",
  );
  step("9-relay-direction-unchanged", {});

  // -- 10. A request from A's own side thread. ---------------------------------------------
  {
    const sideTask = tasks.create(alpha.id, `Alpha side thread ${run}`, "user");
    const sideRequestText = `Check the logs ${run}`;
    const betaThread = await runCauseEffect(tasks.teammateThread(beta.id, sideRequestText));
    const sideRequest = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: alpha.id },
        recipientAgentIds: [beta.id],
        taskId: betaThread.taskId,
        text: sideRequestText,
        replyToMessageId: null,
        senderTaskId: sideTask.taskId,
        idempotencyKey: `side:${crypto.randomUUID()}`,
      }),
    );
    assert.equal(
      mailbox.answerTaskId(beta.id, sideRequest.messageId, [alpha.id]),
      sideTask.taskId,
      "the result runs in A's side thread",
    );
    const sideResult = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: beta.id },
        recipientAgentIds: [alpha.id],
        text: `Log check done ${run}`,
        replyToMessageId: sideRequest.messageId,
        taskId: sideTask.taskId,
        expectsReply: false,
        idempotencyKey: resultKey("turn-side", sideRequest.messageId),
      }),
    );
    assert.equal(
      mailbox
        .queuedTaskMessages(alpha.id, sideTask.taskId)
        .some((message) => message.text.includes(`Log check done ${run}`)),
      true,
      "A's side thread lane holds the result",
    );
    assert.equal(
      chat(alpha.id).some((message) => message.text.includes(`Log check done ${run}`)),
      false,
      "A's own chat hides a result that runs in its side thread",
    );
    assert.equal(
      mailbox.answerTaskId(alpha.id, sideResult.messageId, [beta.id]),
      betaThread.taskId,
      "a reply to the result continues B's task",
    );
    step("10-side-thread-ask", { sideThreadId: sideTask.threadId, betaTaskId: betaThread.taskId });
  }

  // -- 11. The limits of start_task hold for a teammate's thread. --------------------------
  {
    // Eight tasks with queued work are eight unfinished tasks; the earlier steps left some.
    for (let index = 0; tasks.openTaskIds(beta.id).length < 8; index += 1) {
      const text = `Parallel thread ${run} ${index}`;
      const thread = await runCauseEffect(tasks.teammateThread(beta.id, text));
      await runCauseEffect(
        mailbox.enqueue({
          sender: { kind: "agent", agentId: alpha.id },
          recipientAgentIds: [beta.id],
          taskId: thread.taskId,
          text,
          replyToMessageId: null,
          idempotencyKey: `parallel:${index}:${run}`,
        }),
      );
    }
    const unfinished = await refusedMessage(() => runCauseEffect(tasks.teammateThread(beta.id, `One too many ${run}`)));
    assert.match(unfinished, /8 unfinished tasks/, "the unfinished limit names its count");
    step("11a-unfinished-limit", { openTasks: tasks.openTaskIds(beta.id).length, refused: unfinished });

    // The task list room: 50 tasks of the person that never give way.
    const person = agent("agent-room", "Roomy", "openbot-thread-room");
    database.replaceAgents("teammate-new-thread-e2e-room", [alpha, beta, person], "agents.updated");
    for (let index = 0; index < 50; index += 1) tasks.create(person.id, `Person task ${index}`, "user");
    const room = await refusedMessage(() => runCauseEffect(tasks.teammateThread(person.id, `One too many ${run}`)));
    assert.match(room, /50 open threads/, "a full task list refuses a teammate's thread");
    tasks.close(tasks.require(person.id, tasks.openTaskIds(person.id)[0] ?? ""));
    const fits = await runCauseEffect(tasks.teammateThread(person.id, `Fits now ${run}`));
    assert.equal(fits.agentId, person.id, "room for one more task takes a teammate's thread");
    step("11b-task-list-room", { refused: room, openAfterClose: tasks.openTaskIds(person.id).length });

    // The oldest finished tasks that the agent started give way, as `start_task` archives them.
    const closer = agent("agent-arch", "Closer", "openbot-thread-arch");
    database.replaceAgents("teammate-new-thread-e2e-arch", [alpha, beta, person, closer], "agents.updated");
    for (let index = 0; index < 11; index += 1)
      await runCauseEffect(tasks.teammateThread(closer.id, `Finished ${run} ${index}`));
    assert.equal(tasks.openTaskIds(closer.id).length, 9, "the list keeps the newest finished tasks and the new one");
    assert.equal(archivedTasks.length, 2, "the two oldest finished tasks were archived");
    step("11c-archival", { openTasks: tasks.openTaskIds(closer.id).length, archived: archivedTasks.length });
  }

  report.passed = report.steps.every((entry) => entry.error === undefined);
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  report.steps.push({ name: "uncaught", details: {}, error: message });
  process.stdout.write(`uncaught: ${message}\n`);
  report.passed = false;
} finally {
  await rm(root, { recursive: true, force: true });
}
mkdirSync(OUT, { recursive: true });
const reportPath = join(OUT, "report.json");
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`passed: ${report.passed}, report: ${reportPath}\n`);
if (!report.passed) process.exitCode = 1;
