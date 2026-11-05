// Checks member-to-member replies in a channel (#4847), in this worktree's running dev app with real
// provider turns. Start the app with `bun run dev` (never `--shared`), then run
// `bun scripts/channel-reply-e2e.ts --allow-mutations`. It needs two visible agents whose provider is
// signed in and follows tool instructions.
//
// It checks that `channel_reply` posts a reply to the other member's message, that the other member
// gets one turn for it and its answer replies to the reply, that the caller waits for that answer and
// continues after it, and that a request that asks for more
// replies than the limit gets no more than two. The model does the tool calls, so a model that does
// not follow the instructions fails a step. It makes its own channel and deletes it.
// Writes .openbot-build/channel-reply-e2e/report.json.
import assert from "node:assert/strict";
import type { ChannelMessage, ChannelPage, ChannelTask } from "@openbot/contracts/ipc";
import { ChannelClient, connectChannelE2e, waitFor, writeReport } from "./channel-e2e-support";

const REPLY_PREFIX = "channel-reply-";
const LIMIT = 2;

interface Report {
  target?: { messageId: string; text: string };
  reply?: { messageId: string; replyToMessageId: string | null; text: string };
  replyTask?: { ownerAgentId: string | null; parentTaskId: string | null; state: string; awaited: boolean };
  answer?: { replyToMessageId: string | null; text: string };
  final?: string | null;
  limit?: { replies: number; texts: string[] };
  passed: boolean;
}

const report: Report = { passed: false };
const session = await connectChannelE2e("channel-reply-e2e");
const { page } = session;
const client = new ChannelClient(page);

const ended = (task: ChannelTask) =>
  task.state === "completed" || task.state === "failed" || task.state === "paused" || task.state === "cancelled";
const runOf = (channel: ChannelPage, rootTaskId: string) =>
  channel.tasks.filter((task) => task.rootTaskId === rootTaskId);
const agentText = (message: ChannelMessage) =>
  message.message.author === "assistant" &&
  !message.message.uiBlock &&
  (!message.message.itemType || message.message.itemType === "agentMessage");

/** The root task of the agent for a person's message after `sequence`. */
function newRoot(channel: ChannelPage, agentId: string, sequence: number): ChannelTask | undefined {
  const requests = new Set(
    channel.messages
      .filter((message) => message.sequence > sequence && message.author.kind === "member")
      .map((message) => message.id),
  );
  return channel.tasks.find(
    (task) => task.parentTaskId === null && task.ownerAgentId === agentId && requests.has(task.requestMessageId),
  );
}

/** Sends one request to the agent and waits until each task of its run ends. */
async function ask(channelId: string, agentId: string, text: string, label: string) {
  const sequence = (await client.read(channelId)).throughSequence;
  await client.send(channelId, text, agentId);
  const channel = await waitFor(
    page,
    label,
    () => client.read(channelId),
    (value) => {
      const root = newRoot(value, agentId, sequence);
      return root !== undefined && runOf(value, root.rootTaskId).every(ended);
    },
  );
  const root = newRoot(channel, agentId, sequence);
  assert.ok(root);
  return { channel, root, run: runOf(channel, root.rootTaskId), sequence };
}

try {
  const [a, b] = await client.agents();
  assert.ok(a && b, "This check needs two visible agents.");
  const channel = await client.create(`Reply e2e ${Date.now()}`, [a.id, b.id], null);

  // B writes the message that A replies to.
  const first = await ask(channel.id, b.id, "Reply with the single word FALCON. Do not use tools.", "B answers");
  const target = first.channel.messages.find(
    (message) => message.sequence > first.sequence && message.author.id === b.id && agentText(message),
  );
  assert.ok(target, "B posted no answer.");
  report.target = { messageId: target.id, text: target.message.text };

  // A replies to it with a question, so B gets one turn to answer.
  const second = await ask(
    channel.id,
    a.id,
    `Call channel_reply once with messageId "${target.id}" and the text "Which bird is that? Answer with one word." Then reply with the single word DONE. Do not call any other tool.`,
    "A replies and B answers",
  );
  const reply = second.channel.messages.find(
    (message) => message.sequence > second.sequence && message.id.startsWith(REPLY_PREFIX),
  );
  assert.ok(reply, "A posted no member reply.");
  report.reply = {
    messageId: reply.id,
    replyToMessageId: reply.message.replyToMessageId ?? null,
    text: reply.message.text,
  };
  assert.equal(reply.author.id, a.id, "The reply does not have A as author.");
  assert.equal(reply.message.replyToMessageId, target.id, "The reply does not reply to B's message.");

  const replyTask = second.run.find((task) => task.requestMessageId === reply.id);
  assert.ok(replyTask, "The reply started no turn.");
  const parent = second.run.find((task) => task.id === replyTask.parentTaskId);
  report.replyTask = {
    ownerAgentId: replyTask.ownerAgentId,
    parentTaskId: replyTask.parentTaskId,
    state: replyTask.state,
    awaited: parent?.dependencies.includes(replyTask.id) ?? false,
  };
  assert.equal(replyTask.ownerAgentId, b.id, "The reply turn is not B's.");
  assert.equal(replyTask.state, "completed", "B's reply turn did not complete.");
  assert.equal(report.replyTask.awaited, true, "A does not wait for the reply turn.");

  const answer = second.channel.messages.find(
    (message) => message.taskId === replyTask.id && message.author.id === b.id && agentText(message),
  );
  assert.ok(answer, "B did not answer the reply.");
  report.answer = { replyToMessageId: answer.message.replyToMessageId ?? null, text: answer.message.text };
  assert.equal(answer.message.replyToMessageId, reply.id, "B's answer does not reply to the reply.");
  // A continues with the answer, so its last answer comes after B's.
  const final = second.channel.messages.findLast(
    (message) => message.taskId === second.root.id && message.author.id === a.id && agentText(message),
  );
  report.final = final?.message.text ?? null;
  assert.ok(final && final.sequence > answer.sequence, "A did not continue after B's answer.");

  // A request that asks for more replies than the limit gets the limit.
  const third = await ask(
    channel.id,
    a.id,
    `Call channel_reply three times, one call after the other, each with messageId "${target.id}" and the text "Say one more bird name." Then reply with the single word DONE.`,
    "A tries more replies than the limit",
  );
  const run = new Set(third.run.map((task) => task.id));
  const replies = third.channel.messages.filter(
    (message) => message.id.startsWith(REPLY_PREFIX) && message.taskId !== null && run.has(message.taskId),
  );
  report.limit = { replies: replies.length, texts: replies.map((message) => message.message.text) };
  assert.ok(replies.length >= 1, "A posted no reply in the limit run.");
  assert.ok(replies.length <= LIMIT, `The run has more than ${LIMIT} member replies.`);

  report.passed = true;
} finally {
  await client.cleanup();
  writeReport("channel-reply-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
