import assert from "node:assert/strict";
import type { ConversationSnapshot } from "@openbot/contracts/ipc";
import { argument, connectChannelE2e, SHORT_PROMPT, waitFor, writeReport } from "./channel-e2e-support";

const agentArgument = argument("agent");
assert.ok(agentArgument, "Pass --agent=<agent id> of an agent whose provider is signed in.");
const agentId: string = agentArgument;
const words = { chat: `chat${crypto.randomUUID().slice(0, 6)}`, thread: `thread${crypto.randomUUID().slice(0, 6)}` };

interface Report {
  agentId: string;
  provider?: string;
  threadWordFromOwnChat?: { found: boolean; reply: string };
  chatWordFromSideThread?: { found: boolean; reply: string };
  notCovered: string[];
  passed: boolean;
}

const report: Report = {
  agentId,
  notCovered: ["The refusal in a messaging chat: it needs a connected messaging account."],
  passed: false,
};

const session = await connectChannelE2e("cross-chat-history-e2e");
const { page } = session;

const bridge = {
  agents: () => page.evaluate(() => window.openbot.agent.listAgents()),
  main: (): Promise<ConversationSnapshot> => page.evaluate((id) => window.openbot.agent.readConversation(id), agentId),
  side: (taskId: string): Promise<ConversationSnapshot> =>
    page.evaluate((input) => window.openbot.agent.readTask(input), { agentId, taskId }),
  send: (text: string, taskId?: string) =>
    page.evaluate((input) => window.openbot.agent.sendMessage({ ...input, clientMessageId: crypto.randomUUID() }), {
      agentId,
      text,
      ...(taskId ? { taskId } : {}),
    }),
};

const repliesAfter = (snapshot: ConversationSnapshot, marker: string, from = 0) => {
  const sent = snapshot.messages.findIndex(
    (message, index) => index >= from && message.author === "user" && message.text.includes(marker),
  );
  if (sent < 0 || snapshot.activeTurnId !== null) return [];
  return snapshot.messages
    .slice(sent + 1)
    .filter((message) => message.author === "assistant")
    .map((message) => message.text);
};

let taskId: string | null = null;
try {
  const agent = (await bridge.agents()).find((candidate) => candidate.id === agentId);
  assert.ok(agent, `Unknown agent: ${agentId}`);
  report.provider = agent.provider;

  const chatSeed = `The chat code word is ${words.chat}. ${SHORT_PROMPT}`;
  await bridge.send(chatSeed);
  await waitFor(page, "own chat replies", bridge.main, (snapshot) => repliesAfter(snapshot, chatSeed).length > 0);
  const task = await page.evaluate(
    (input) => window.openbot.agent.startTask({ ...input, clientMessageId: crypto.randomUUID() }),
    { agentId, text: `The thread code word is ${words.thread}. ${SHORT_PROMPT}` },
  );
  taskId = task.id;
  const sideTaskId = task.id;
  await waitFor(
    page,
    "side thread replies",
    () => bridge.side(sideTaskId),
    (snapshot) => repliesAfter(snapshot, words.thread).length > 0,
  );

  const recall =
    "I gave you a thread code word in another chat in the last hour. Find it. Reply with that code word only.";
  const mainFrom = (await bridge.main()).messages.length;
  await bridge.send(recall);
  const mainAfter = await waitFor(page, "own chat recalls the thread", bridge.main, (snapshot) =>
    Boolean(repliesAfter(snapshot, recall, mainFrom).length),
  );
  const mainReply = repliesAfter(mainAfter, recall, mainFrom).join("\n");
  report.threadWordFromOwnChat = { found: mainReply.includes(words.thread), reply: mainReply };
  assert.ok(report.threadWordFromOwnChat.found, "The own chat found the code word of the side thread.");

  const back =
    "I just gave you a chat code word in the main chat. Find the latest one. Reply with that code word only.";
  await bridge.send(back, sideTaskId);
  const sideAfter = await waitFor(
    page,
    "side thread reads the own chat",
    () => bridge.side(sideTaskId),
    (snapshot) => Boolean(repliesAfter(snapshot, back).length),
  );
  const sideReply = repliesAfter(sideAfter, back).join("\n");
  report.chatWordFromSideThread = { found: sideReply.includes(words.chat), reply: sideReply };
  assert.ok(report.chatWordFromSideThread.found, "The side thread found the code word of the own chat.");
  report.passed = true;
} finally {
  if (taskId) {
    const input = { agentId, taskId };
    await page.evaluate((value) => window.openbot.agent.stopTask(value), input).catch(() => undefined);
    await page.evaluate((value) => window.openbot.agent.deleteTask(value), input).catch(() => undefined);
  }
  writeReport("cross-chat-history-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
