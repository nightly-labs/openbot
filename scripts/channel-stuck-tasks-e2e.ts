// Checks stopped and unassignable channel work, in this worktree's running dev app with real provider
// turns. Start the app with `bun run dev` (never `--shared`), then run
// `bun scripts/channel-stuck-tasks-e2e.ts --allow-mutations`. It needs two visible agents whose
// provider is signed in and runs turns at the same time.
//
// It checks that a stopped task has the stop reason (so Continue and Reassign show), that "continue"
// resumes the tasks of the newest stopped request and not an older stopped one, that the resumed
// members answer that request, that a typed "@Name" goes to that member with no routing turn, that a
// lead that answers alone gets no "Assigned to" row, and that a restore gives archived work the stop
// reason. It makes its own channel and deletes it. Writes
// .openbot-build/channel-stuck-tasks-e2e/report.json.
import assert from "node:assert/strict";
import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import { type ChannelPage, type ChannelTask, channelRoutingConversationEvent } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import {
  ChannelClient,
  connectChannelE2e,
  LONG_PROMPT,
  SHORT_PROMPT,
  waitFor,
  writeReport,
} from "./channel-e2e-support";

const MOUNTAINS = "Write a numbered list of 300 short facts about mountains, one per line. Do not use tools.";

interface Report {
  stopReason?: string | null;
  continued?: { taskIds: string[]; olderTaskState: string; newTasks: number; instructions: string[] };
  continuedReplies?: { agentId: string; mentionsMountains: boolean; mentionsRivers: boolean }[];
  typedAddress?: { ownerAgentId: string | null; routingRows: number };
  leadAlone?: { ownerAgentId: string | null; routingRows: number; checked: boolean };
  restoreReason?: string | null;
  passed: boolean;
}

const report: Report = { passed: false };
const session = await connectChannelE2e("channel-stuck-tasks-e2e");
const { page } = session;
const client = new ChannelClient(page);
const stopped = sourceText("error.backend.channelTaskStopped");

const taskOf = (channel: ChannelPage, id: string): ChannelTask | undefined =>
  channel.tasks.find((task) => task.id === id);
const requestTasks = (channel: ChannelPage, messageId: string) =>
  channel.tasks.filter((task) => task.parentTaskId === null && task.sourceMessageIds[0] === messageId);
const lastMessageId = (channel: ChannelPage) => channel.messages.filter((m) => m.author.kind === "member").at(-1)?.id;
const routingRows = (channel: ChannelPage, taskId: string) =>
  channel.messages.filter((message) => message.taskId === taskId && channelRoutingConversationEvent(message.message))
    .length;

try {
  const agents = (await client.agents()).filter((agent) => agentProviderDescriptor(agent.provider).concurrentTurns);
  assert.ok(agents.length >= 2, "This check needs two visible agents whose provider runs turns at the same time.");
  const [lead, other] = agents;
  assert.ok(lead && other);
  assert.notEqual(lead.name.toLowerCase(), other.name.toLowerCase(), "The two agents need different names.");
  const channel = await client.create("E2E stuck tasks", [lead.id, other.id], lead.id);

  // 1. An older request to one member, stopped while it runs. It has the stop reason.
  await client.send(channel.id, LONG_PROMPT, other.id);
  const olderId = lastMessageId(await client.read(channel.id));
  assert.ok(olderId);
  const older = await waitFor(
    page,
    "the older request runs",
    () => client.read(channel.id),
    (current) => requestTasks(current, olderId)[0]?.state === "running",
  );
  const olderTask = requestTasks(older, olderId)[0];
  assert.ok(olderTask);
  await client.taskCommand("stop", channel.id, olderTask.id);
  const afterStop = await waitFor(
    page,
    "the older request stops",
    () => client.read(channel.id),
    (current) => taskOf(current, olderTask.id)?.state === "paused",
  );
  report.stopReason = taskOf(afterStop, olderTask.id)?.error ?? null;
  assert.equal(report.stopReason, stopped);

  // 2. A newer request to both members, stopped while both run.
  await client.send(channel.id, `@everyone ${MOUNTAINS}`, null);
  const newerId = lastMessageId(await client.read(channel.id));
  assert.ok(newerId);
  const newer = await waitFor(
    page,
    "both members run the newer request",
    () => client.read(channel.id),
    (current) => {
      const tasks = requestTasks(current, newerId);
      return tasks.length === 2 && tasks.every((task) => task.state === "running");
    },
  );
  const newerTasks = requestTasks(newer, newerId);
  for (const task of newerTasks) await client.taskCommand("stop", channel.id, task.id);
  const bothStopped = await waitFor(
    page,
    "the newer request stops",
    () => client.read(channel.id),
    (current) => newerTasks.every((task) => taskOf(current, task.id)?.state === "paused"),
  );
  const tasksBefore = bothStopped.tasks.length;

  // 3. "continue" resumes the newer request, not the older one, and starts no new task.
  await client.send(channel.id, "continue", null);
  const continueId = lastMessageId(await client.read(channel.id));
  assert.ok(continueId);
  const resumed = await waitFor(
    page,
    "continue resumes the newer request",
    () => client.read(channel.id),
    (current) => newerTasks.every((task) => taskOf(current, task.id)?.requestMessageId === continueId),
  );
  report.continued = {
    taskIds: newerTasks.map((task) => task.id),
    olderTaskState: taskOf(resumed, olderTask.id)?.state ?? "missing",
    newTasks: resumed.tasks.length - tasksBefore,
    instructions: newerTasks.map((task) => taskOf(resumed, task.id)?.instruction ?? ""),
  };
  assert.equal(report.continued.olderTaskState, "paused", "continue resumed the older request.");
  assert.equal(report.continued.newTasks, 0, "continue started new tasks.");
  assert.ok(
    report.continued.instructions.every((instruction) => instruction.includes("mountains")),
    "continue replaced the instruction.",
  );

  // The resumed members answer the request they were stopped on: mountains, not rivers.
  const continueSequence = resumed.messages.find((message) => message.id === continueId)?.sequence ?? 0;
  const replies = await waitFor(
    page,
    "the resumed members write their answers",
    () => client.read(channel.id),
    (current) =>
      newerTasks.every((task) =>
        current.messages.some(
          (message) =>
            message.taskId === task.id &&
            message.sequence > continueSequence &&
            message.message.author === "assistant" &&
            message.message.itemType !== "commentary" &&
            message.message.text.length > 300,
        ),
      ),
  );
  report.continuedReplies = newerTasks.map((task) => {
    const text = replies.messages
      .filter((message) => message.taskId === task.id && message.sequence > continueSequence)
      .map((message) => message.message.text)
      .join("\n");
    return {
      agentId: task.ownerAgentId ?? "",
      mentionsMountains: /mountain/iu.test(text),
      mentionsRivers: /\briver/iu.test(text) && !/mountain/iu.test(text),
    };
  });
  assert.ok(
    report.continuedReplies.every((reply) => reply.mentionsMountains && !reply.mentionsRivers),
    "A resumed member did not answer the request it was stopped on.",
  );
  for (const task of newerTasks) await client.taskCommand("stop", channel.id, task.id).catch(() => undefined);

  // 4. A typed "@Name" with no mention tag goes to that member, with no routing turn.
  await client.send(channel.id, `@${other.name} ${SHORT_PROMPT}`, null);
  const typedId = lastMessageId(await client.read(channel.id));
  assert.ok(typedId);
  const typed = await client.read(channel.id);
  const typedTask = requestTasks(typed, typedId)[0];
  assert.ok(typedTask);
  await waitFor(
    page,
    "the typed address completes",
    () => client.read(channel.id),
    (current) => taskOf(current, typedTask.id)?.state === "completed",
  );
  report.typedAddress = {
    ownerAgentId: typedTask.ownerAgentId,
    routingRows: routingRows(await client.read(channel.id), typedTask.id),
  };
  assert.equal(report.typedAddress.ownerAgentId, other.id, "The typed address did not choose its member.");
  assert.equal(report.typedAddress.routingRows, 0, "The typed address went through routing.");

  // 5. A request that the lead takes alone has no "Assigned to" row. The model chooses, so the check
  // applies only when it chose the lead.
  const current = await client.read(channel.id);
  await client.command({
    type: "save",
    operationId: crypto.randomUUID(),
    channelId: channel.id,
    draft: {
      name: current.channel.name,
      title: current.channel.title,
      instructions: `An end-to-end test channel. ${lead.name} answers every request alone.`,
      members: current.channel.members,
      leadAgentId: lead.id,
    },
    update: true,
  });
  await client.send(channel.id, `What is two plus two? ${SHORT_PROMPT.replace("ready", "four")}`, null);
  const aloneId = lastMessageId(await client.read(channel.id));
  assert.ok(aloneId);
  const alone = await waitFor(
    page,
    "the lead routes the question",
    () => client.read(channel.id),
    (now) =>
      requestTasks(now, aloneId).every((task) => task.state === "completed") && requestTasks(now, aloneId).length > 0,
  );
  const aloneTasks = requestTasks(alone, aloneId);
  const leadAlone = aloneTasks.length === 1 && aloneTasks[0]?.ownerAgentId === lead.id;
  report.leadAlone = {
    ownerAgentId: aloneTasks[0]?.ownerAgentId ?? null,
    routingRows: aloneTasks.reduce((count, task) => count + routingRows(alone, task.id), 0),
    checked: leadAlone,
  };
  if (leadAlone) assert.equal(report.leadAlone.routingRows, 0, "The lead's self-assignment has a routing row.");

  // 6. Work that an archive paused gets the stop reason on restore.
  await client.send(channel.id, LONG_PROMPT, lead.id);
  const archivedId = lastMessageId(await client.read(channel.id));
  assert.ok(archivedId);
  const running = await waitFor(
    page,
    "the request before the archive runs",
    () => client.read(channel.id),
    (now) => requestTasks(now, archivedId)[0]?.state === "running",
  );
  const archivedTask = requestTasks(running, archivedId)[0];
  assert.ok(archivedTask);
  await client.command({ type: "archive", operationId: crypto.randomUUID(), channelId: channel.id });
  const archived = await client.read(channel.id);
  assert.equal(taskOf(archived, archivedTask.id)?.error, null, "The archive gave its paused task a reason.");
  await client.command({ type: "restore", operationId: crypto.randomUUID(), channelId: channel.id });
  report.restoreReason = taskOf(await client.read(channel.id), archivedTask.id)?.error ?? null;
  assert.equal(report.restoreReason, stopped);
  report.passed = true;
} finally {
  await client.cleanup();
  writeReport("channel-stuck-tasks-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
