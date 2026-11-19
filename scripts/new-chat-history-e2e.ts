import assert from "node:assert/strict";
import { resolve } from "node:path";
import { CONTEXT_RESET_ITEM_TYPE, type ConversationMessage, type ConversationSnapshot } from "@openbot/contracts/ipc";
import { argument, connectChannelE2e, SHORT_PROMPT, waitFor, writeReport } from "./channel-e2e-support";

const agentArgument = argument("agent");
assert.ok(agentArgument, "Pass --agent=<agent id> of an agent whose provider is signed in.");
const agentId: string = agentArgument;
const word = `word${crypto.randomUUID().slice(0, 6)}`;

interface Report {
  agentId: string;
  provider?: string;
  word: string;
  resetMarkerBetween: boolean;
  wordInMemories?: boolean;
  recall?: { found: boolean; reply: string; toolSteps: string[] };
  screenshot?: string;
  passed: boolean;
}

const report: Report = { agentId, word, resetMarkerBetween: false, passed: false };
const session = await connectChannelE2e("new-chat-history-e2e");
const { page } = session;

const main = (): Promise<ConversationSnapshot> =>
  page.evaluate((id) => window.openbot.agent.readConversation(id), agentId);
const send = (text: string) =>
  page.evaluate((input) => window.openbot.agent.sendMessage({ ...input, clientMessageId: crypto.randomUUID() }), {
    agentId,
    text,
  });
const repliesAfter = (snapshot: ConversationSnapshot, marker: string): ConversationMessage[] => {
  const sent = snapshot.messages.findLastIndex((message) => message.author === "user" && message.text.includes(marker));
  if (sent < 0 || snapshot.activeTurnId !== null) return [];
  return snapshot.messages.slice(sent + 1).filter((message) => message.author === "assistant");
};
const toolSteps = (messages: readonly ConversationMessage[]) =>
  messages.flatMap((message) =>
    (message.trace?.steps ?? []).flatMap((step) => (step.kind === "tool" ? [step.command ?? step.text ?? "tool"] : [])),
  );

try {
  const agent = (await page.evaluate(() => window.openbot.agent.listAgents())).find(
    (candidate) => candidate.id === agentId,
  );
  assert.ok(agent, `Unknown agent: ${agentId}`);
  report.provider = agent.provider;

  const seed = `This is a one-time test value. Do not save it as a memory. The test value is ${word}. ${SHORT_PROMPT}`;
  await send(seed);
  await waitFor(page, "seed reply", main, (snapshot) => repliesAfter(snapshot, seed).length > 0);

  await page.evaluate((id) => window.openbot.agent.clearContext(id), agentId);

  const recall =
    "Before I started this new chat, I gave you a one-time test value. Find it. Reply with that test value only.";
  await send(recall);
  const after = await waitFor(page, "recall reply", main, (snapshot) => repliesAfter(snapshot, recall).length > 0);
  const seedIndex = after.messages.findLastIndex((message) => message.text.includes(seed));
  const recallIndex = after.messages.findLastIndex((message) => message.text.includes(recall));
  report.resetMarkerBetween = after.messages
    .slice(seedIndex + 1, recallIndex)
    .some((message) => message.itemType === CONTEXT_RESET_ITEM_TYPE);
  const replies = repliesAfter(after, recall);
  const reply = replies.map((message) => message.text).join("\n");
  report.recall = { found: reply.includes(word), reply, toolSteps: toolSteps(replies) };

  const memories = await page.evaluate((id) => window.openbot.agent.listMemories(id), agentId);
  report.wordInMemories = memories.some((memory) => JSON.stringify(memory).includes(word));

  const screenshot = resolve(import.meta.dirname, "../.openbot-build/new-chat-history-e2e/chat.png");
  await page.screenshot({ path: screenshot });
  report.screenshot = screenshot;

  assert.ok(report.resetMarkerBetween, "A New chat divider is between the seed and the question.");
  assert.ok(!report.wordInMemories, "The test value is not in a saved memory, so only the chat history holds it.");
  assert.ok(report.recall.found, "After New chat, the agent found the test value in the earlier messages.");
  report.passed = true;
} finally {
  writeReport("new-chat-history-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
