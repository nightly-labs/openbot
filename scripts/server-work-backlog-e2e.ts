// Moves selected backlog requests through real SQLite, task and mailbox stores in a Node process.
// No provider, account, user profile or network is used.
// Run: bun scripts/server-work-backlog-e2e.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ServerWorkBacklog } from "../src/backend/agent/server-work-backlog";
import { ServerWorkDispatch } from "../src/backend/agent/server-work-dispatch";
import { isServerWorkThread } from "../src/backend/agent/server-work-identity";
import type { AgentServerWorkPolicy } from "../src/backend/agent/server-work-policy";
import { AgentStore } from "../src/backend/agent-store";
import { AgentTasks } from "../src/backend/agent-tasks/agent-tasks";
import { AgentThreadStore } from "../src/backend/agent-threads/agent-thread-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const projectRoot = process.env.OPENBOT_BACKLOG_TEST_ROOT ?? resolve(import.meta.dirname, "..");
const output = join(projectRoot, ".openbot-build", "server-work-backlog-e2e");
const report: { passed: boolean; checks: string[]; error?: string } = { passed: false, checks: [] };

async function fixture(): Promise<void> {
  const root = mkdtempSync(join(output, "run-"));
  const profile = join(root, "profile");
  let policy: AgentServerWorkPolicy | null = {
    maxConcurrentTasks: 50,
    maxUnfinishedTasks: 50,
    dispatchMode: "new-thread",
  };
  let queueSignals = 0;
  const sharingScope = () => "section:backlog-fixture";

  async function open() {
    const database = new OpenBotDatabase(profile);
    const store = new AgentStore(profile, join(root, "home"), database);
    const mailbox = new MailboxStore(profile, store.sharedRoot, database);
    await runCauseEffect(store.initialize());
    await runCauseEffect(mailbox.initialize());
    const conversation = new ConversationRuntime(
      store,
      () => {},
      () => store.list(),
    );
    const tasks = new AgentTasks({
      store: new AgentThreadStore(database),
      mailbox,
      conversation,
      hooks: {
        agent: (id) => store.list().find((agent) => agent.id === id),
        emit: () => {},
        defaultTaskLimit: () => 4,
        serverWorkPolicy: () => policy,
        hold: () => null,
        queued: () => {},
        turnActive: () => false,
        archived: () => Effect.void,
      },
    });
    const backlog = new ServerWorkBacklog({
      tasks,
      mailbox,
      policy: () => policy,
      sharingScope,
      queued: () => queueSignals++,
    });
    const dispatch = new ServerWorkDispatch({
      tasks,
      mailbox,
      policy: () => policy,
      sharingScope,
      visibleAgents: () => store.list(),
      queued: () => {},
    });
    return { database, store, mailbox, conversation, tasks, backlog, dispatch };
  }

  let state = await open();
  try {
    const create = (name: string) =>
      runCauseEffect(
        state.store.createAgent({
          name,
          description: "Isolated backlog fixture",
          avatarSeed: name.toLowerCase(),
          avatarHue: null,
        }),
      );
    const worker = await create("Worker");
    const sender = await create("Coordinator");
    const other = await create("Other");
    const source = state.tasks.create(sender.id, "Requester side chat", "user");
    const enqueue = (input: Parameters<MailboxStore["enqueue"]>[0]) => runCauseEffect(state.mailbox.enqueue(input));
    const move = (deliveryId: string, title?: string) =>
      runCauseEffect(state.backlog.dispatch(worker.id, deliveryId, title));

    const userRequest = await enqueue({
      sender: { kind: "user" },
      recipientAgentIds: [worker.id],
      text: "Independently count fixture records.",
      idempotencyKey: "fixture:user-request",
    });
    const userId = userRequest.deliveries[0]?.id;
    assert.ok(userId);
    assert.equal(state.backlog.list(worker.id).find((candidate) => candidate.deliveryId === userId)?.eligible, true);
    const userMoved = await move(userId);
    assert.equal(isServerWorkThread(userMoved.work.taskId), true);
    assert.equal(userMoved.deliveryId, userId);
    assert.equal(userMoved.messageId, userRequest.messageId);
    assert.equal(state.mailbox.taskQueue(worker.id, userMoved.work.taskId)[0]?.id, userId);
    assert.equal(
      state.mailbox.listQueue(worker.id).deliveries.some((delivery) => delivery.id === userId),
      false,
    );
    assert.deepEqual(state.mailbox.receiptForKey("fixture:user-request"), userRequest);
    assert.deepEqual(state.mailbox.getDelivery(userId)?.delivery.sender, { kind: "user" });
    const retry = await move(userId);
    assert.equal(retry.work.taskId, userMoved.work.taskId);
    assert.equal(state.tasks.openTaskIds(worker.id).length, 1);
    report.checks.push(
      "A selected user delivery moves once without changing its message, sender, receipt or delivery id.",
    );

    const agentRequest = await enqueue({
      sender: { kind: "agent", agentId: sender.id },
      recipientAgentIds: [worker.id],
      senderTaskId: source.taskId,
      text: "Independently inspect fixture metadata.",
      idempotencyKey: "fixture-thread:source-turn:request",
    });
    const agentId = agentRequest.deliveries[0]?.id;
    assert.ok(agentId);
    const legacyTask = state.tasks.create(worker.id, "Legacy action target", "user");
    await assert.rejects(runCauseEffect(state.mailbox.moveToTask(worker.id, agentId, legacyTask.taskId)));
    state.tasks.discard(legacyTask);
    const agentMoved = await move(agentId, "Selected teammate work");
    assert.equal(state.mailbox.taskIdForDelivery(agentId), agentMoved.work.taskId);
    assert.deepEqual(state.mailbox.getDelivery(agentId)?.delivery.sender, { kind: "agent", agentId: sender.id });
    assert.equal(state.mailbox.answerTaskId(worker.id, agentRequest.messageId, [sender.id]), source.taskId);
    assert.equal(state.mailbox.hasRequestFromTurn(sender.id, "source-turn"), true);
    assert.equal(
      state.dispatch.find({ callerAgentId: sender.id, recipientAgentId: worker.id, taskId: agentMoved.work.taskId })[0]
        ?.taskId,
      agentMoved.work.taskId,
      "The original sender can find work in the same scope.",
    );
    assert.equal(state.mailbox.receiptForKey("fixture-thread:source-turn:request")?.deliveries[0]?.id, agentId);
    report.checks.push(
      "A selected teammate request keeps its sender, source turn, source reply chat and permitted discovery.",
    );

    const related = await enqueue({
      sender: { kind: "user" },
      recipientAgentIds: [worker.id],
      text: "Selected related fixture details for the same issue.",
    });
    const relatedId = related.deliveries[0]?.id;
    assert.ok(relatedId);
    await assert.rejects(runCauseEffect(state.backlog.dispatch(worker.id, relatedId, undefined, source.taskId)));
    const beforeGroup = state.tasks.openTaskIds(worker.id).length;
    const grouped = await runCauseEffect(
      state.backlog.dispatch(worker.id, relatedId, undefined, userMoved.work.taskId),
    );
    assert.equal(grouped.work.taskId, userMoved.work.taskId);
    assert.equal(state.tasks.openTaskIds(worker.id).length, beforeGroup);
    assert.deepEqual(
      state.mailbox.taskQueue(worker.id, userMoved.work.taskId).map((delivery) => delivery.id),
      [userId, relatedId],
    );
    const groupedRetry = await runCauseEffect(
      state.backlog.dispatch(worker.id, relatedId, undefined, userMoved.work.taskId),
    );
    assert.equal(groupedRetry.deliveryId, relatedId);
    assert.equal(state.mailbox.taskQueue(worker.id, userMoved.work.taskId).length, 2);
    report.checks.push(
      "Two selected related requests share one existing managed chat; retry does not duplicate either request.",
    );

    const information = await enqueue({
      sender: { kind: "agent", agentId: sender.id },
      recipientAgentIds: [worker.id],
      text: "Independently store this fixture information.",
      expectsReply: false,
    });
    const informationId = information.deliveries[0]?.id;
    assert.ok(informationId);
    await move(informationId);
    assert.equal(state.mailbox.expectsReply(information.messageId), false);
    report.checks.push("An explicitly selected independent information message retains its no-reply policy.");

    const rejected = [
      await enqueue({
        sender: { kind: "agent", agentId: sender.id },
        recipientAgentIds: [worker.id],
        text: "A reply that needs context.",
        replyToMessageId: agentRequest.messageId,
        expectsReply: false,
      }),
      await enqueue({
        sender: { kind: "agent", agentId: sender.id },
        recipientAgentIds: [worker.id, other.id],
        text: "One shared multicast request.",
      }),
      await enqueue({
        sender: {
          kind: "routine",
          routineId: "routine-fixture",
          runId: "run-fixture",
          routineName: "Fixture routine",
          scheduledFor: new Date().toISOString(),
        },
        recipientAgentIds: [worker.id],
        text: "Routine work.",
      }),
      await enqueue({
        sender: { kind: "user" },
        recipientAgentIds: [worker.id],
        text: "Welcome setup.",
        welcome: true,
      }),
      await enqueue({
        sender: { kind: "user" },
        recipientAgentIds: [worker.id],
        text: "Agent-created setup.",
        agentSetup: true,
      }),
      await enqueue({
        sender: { kind: "user" },
        recipientAgentIds: [worker.id],
        text: "Channel work.",
        channelId: "channel-fixture",
      }),
      await enqueue({
        sender: { kind: "user" },
        recipientAgentIds: [worker.id],
        text: "External conversation.",
        messaging: {
          linkId: "link-fixture",
          authorId: "author",
          authorName: "Fixture",
          platformMessageId: "platform-fixture",
        },
      }),
    ];
    const beforeRefusal = state.tasks.openTaskIds(worker.id).length;
    for (const receipt of rejected) {
      const deliveryId = receipt.deliveries.find((delivery) => delivery.recipientAgentId === worker.id)?.id;
      assert.ok(deliveryId);
      await assert.rejects(move(deliveryId));
      assert.equal(state.mailbox.taskIdForDelivery(deliveryId), null);
    }
    assert.equal(state.tasks.openTaskIds(worker.id).length, beforeRefusal);
    assert.ok(
      state.backlog
        .list(worker.id)
        .filter((candidate) => rejected.some((receipt) => receipt.messageId === candidate.messageId))
        .every((candidate) => !candidate.eligible && candidate.reason),
    );
    assert.ok(
      state.backlog
        .list(other.id)
        .every((candidate) => state.mailbox.getDelivery(candidate.deliveryId)?.delivery.recipientAgentId === other.id),
    );
    await assert.rejects(runCauseEffect(state.backlog.dispatch(other.id, rejected[0]?.deliveries[0]?.id ?? "missing")));
    report.checks.push(
      "Replies, multicast, routines, welcome, agent setup, channel, external and another agent's requests stay in their original context.",
    );

    const continuation = await enqueue({
      sender: { kind: "user" },
      recipientAgentIds: [worker.id],
      text: "Plan continuation.",
    });
    const continuationId = continuation.deliveries[0]?.id;
    assert.ok(continuationId);
    await runCauseEffect(state.mailbox.markStarting(continuationId));
    await runCauseEffect(state.mailbox.markRunning(continuationId, "continuation-turn"));
    await runCauseEffect(state.mailbox.requeueForPlan(continuationId, "continuation-turn"));
    await assert.rejects(move(continuationId));
    report.checks.push("A queued plan continuation cannot be split from its original context.");

    const waiting = await enqueue({
      sender: { kind: "user" },
      recipientAgentIds: [worker.id],
      text: "Independent request beyond admission.",
    });
    const waitingId = waiting.deliveries[0]?.id;
    assert.ok(waitingId);
    const fullPolicy = policy;
    assert.ok(fullPolicy);
    policy = { ...fullPolicy, maxUnfinishedTasks: beforeRefusal };
    await assert.rejects(move(waitingId));
    assert.equal(state.mailbox.taskIdForDelivery(waitingId), null);
    assert.equal(state.tasks.openTaskIds(worker.id).length, beforeRefusal);
    policy = null;
    assert.ok(state.backlog.list(worker.id).every((candidate) => !candidate.eligible));
    await assert.rejects(move(waitingId));
    policy = fullPolicy;
    report.checks.push("The shared unfinished-work bound and disabled policy refuse moves without duplicating work.");

    state.conversation.dispose();
    state.database.close();
    state = await open();
    const recovered = await move(agentId);
    assert.equal(recovered.work.taskId, agentMoved.work.taskId);
    assert.equal(state.mailbox.answerTaskId(worker.id, agentRequest.messageId, [sender.id]), source.taskId);
    assert.equal(state.mailbox.hasRequestFromTurn(sender.id, "source-turn"), true);
    assert.ok(queueSignals >= 3);
    report.checks.push("Restart preserves the moved delivery, receipt and reply route; retry creates no second task.");
    report.passed = true;
  } finally {
    state.conversation.dispose();
    state.database.close();
  }
}

mkdirSync(output, { recursive: true });
if (process.argv.includes("--fixture")) {
  try {
    await fixture();
  } catch (error) {
    report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.exitCode = 1;
  } finally {
    writeFileSync(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  }
} else {
  const build = await Bun.build({
    entrypoints: [import.meta.filename],
    target: "node",
    format: "esm",
    outdir: output,
    naming: "fixture.mjs",
  });
  assert.ok(build.success, String(build.logs));
  const child = spawnSync("node", [join(output, "fixture.mjs"), "--fixture"], {
    cwd: projectRoot,
    env: { ...process.env, OPENBOT_BACKLOG_TEST_ROOT: projectRoot },
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  process.stdout.write(child.stdout);
  process.stderr.write(child.stderr);
  assert.ifError(child.error);
  assert.equal(child.status, 0, "Server work backlog fixture failed.");
}
