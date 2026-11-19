import assert from "node:assert/strict";
import { resolve } from "node:path";
import { CONTEXT_RESET_ITEM_TYPE, type ConversationMessage, type ConversationSnapshot } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n";
import { argument, connectChannelE2e, SHORT_PROMPT, waitFor, writeReport } from "./channel-e2e-support";

const agentArgument = argument("agent");
assert.ok(agentArgument, "Pass --agent=<agent id> of an agent whose provider is signed in.");
const agentId: string = agentArgument;
const word = `word${crypto.randomUUID().slice(0, 6)}`;

interface Turn {
  reply: string;
  toolSteps: string[];
  seconds: number | null;
  tokens: number | null;
}

interface Report {
  agentId: string;
  provider?: string;
  word: string;
  resetMarkerBetween: boolean;
  wordInMemories?: boolean;
  firstTurn?: Turn & { searchedChats: boolean };
  recall?: Turn & { found: boolean };
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
const turn = async (prompt: string, label: string) => {
  await send(prompt);
  const snapshot = await waitFor(page, label, main, (current) => repliesAfter(current, prompt).length > 0);
  const replies = repliesAfter(snapshot, prompt);
  const trace = replies.findLast((message) => message.trace)?.trace;
  const result: Turn = {
    reply: replies.map((message) => message.text).join("\n"),
    toolSteps: toolSteps(replies),
    seconds: trace?.endedAt ? (Date.parse(trace.endedAt) - Date.parse(trace.startedAt)) / 1000 : null,
    tokens: trace?.tokens ?? null,
  };
  return { snapshot, result };
};

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

  const first = await turn("What is 7 times 6? Reply with the number only.", "first reply after New chat");
  report.firstTurn = {
    ...first.result,
    searchedChats: first.result.toolSteps.includes(sourceText("status.agent.chatsSearching")),
  };

  const recall = "What was the one-time test value that I gave you? Reply with that test value only.";
  const { snapshot: after, result } = await turn(recall, "recall reply");
  const sentIndex = (text: string) =>
    after.messages.findLastIndex((message) => message.author === "user" && message.text.includes(text));
  const seedIndex = sentIndex(seed);
  const recallIndex = sentIndex(recall);
  report.resetMarkerBetween =
    seedIndex >= 0 &&
    recallIndex > seedIndex &&
    after.messages.slice(seedIndex + 1, recallIndex).some((message) => message.itemType === CONTEXT_RESET_ITEM_TYPE);
  report.recall = { ...result, found: result.reply.includes(word) };

  const memories = await page.evaluate((id) => window.openbot.agent.listMemories(id), agentId);
  report.wordInMemories = memories.some((memory) => JSON.stringify(memory).includes(word));

  const screenshot = resolve(import.meta.dirname, "../.openbot-build/new-chat-history-e2e/chat.png");
  await page.screenshot({ path: screenshot });
  report.screenshot = screenshot;

  assert.ok(!report.firstTurn.searchedChats, "An unrelated first turn after New chat does not search past chats.");
  assert.ok(report.resetMarkerBetween, "A New chat divider is between the seed and the question.");
  assert.ok(!report.wordInMemories, "The test value is not in a saved memory, so only the chat history holds it.");
  assert.ok(
    report.recall.found,
    "After New chat, the agent found the test value without being told about the new chat.",
  );
  report.passed = true;
} finally {
  writeReport("new-chat-history-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
