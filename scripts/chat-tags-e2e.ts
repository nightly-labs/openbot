// Tags a browser tab and a side thread in chat, in this worktree's running dev app, through the
// preload bridge, the agent service and a real provider. It adds messages to the agent's own chat,
// and opens tabs and a side thread that it closes and deletes at the end. Start the app with
// `bun run dev` (never `--shared`), and pass an agent whose provider is signed in:
// `bun scripts/chat-tags-e2e.ts --allow-mutations --agent=<agent id>`.
//
// 1. A side thread gets a tag of a tab that the agent's own chat owns. It reads the code word on
//    that page with its browser tool: the tag shared the tab with the thread.
// 2. The agent's own chat gets a tag of the side thread. It finds the code word that only the
//    thread holds, with `history_read` and the task id.
// 3. A tag of another agent's tab shares nothing: the agent does not read that page.
// 4. The stored messages keep the markers, so each delivery reads the current tab and thread.
// The provider input is not visible here, so the script does not measure the tokens of a tag.
// Writes .openbot-build/chat-tags-e2e/report.json.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import type { ConversationSnapshot } from "@openbot/contracts/ipc";
import { argument, connectChannelE2e, SHORT_PROMPT, waitFor, writeReport } from "./channel-e2e-support";

const agentArgument = argument("agent");
assert.ok(agentArgument, "Pass --agent=<agent id> of an agent whose provider is signed in.");
const agentId: string = agentArgument;
const run = crypto.randomUUID().slice(0, 6);
const words = { tab: `tab${run}`, thread: `thread${run}`, other: `other${run}`, blocked: `blocked${run}` };

interface Report {
  agentId: string;
  provider?: string;
  sharedTabRead?: boolean;
  threadWordFound?: boolean;
  foreignTab?: { otherAgentId: string; pageTextLeaked: boolean; reply: string } | null;
  markersStored?: { tab: boolean; thread: boolean };
  notCovered: string[];
  passed: boolean;
}

const report: Report = {
  agentId,
  notCovered: ["The tokens of each expanded tag: the dev app does not show the provider input."],
  passed: false,
};

const pages: Record<string, { title: string; text: string }> = {
  "/own": { title: `Tag page ${run}`, text: `The tab code word is ${words.tab}.` },
  "/other": { title: `Other page ${run}`, text: `The other code word is ${words.other}.` },
};
const server = createServer((request, response) => {
  const page = pages[request.url ?? ""];
  response.writeHead(page ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
  response.end(page ? `<!doctype html><title>${page.title}</title><p>${page.text}</p>` : "");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address === "object", "The test page server listens on a port.");
const origin = `http://127.0.0.1:${address.port}`;

const session = await connectChannelE2e("chat-tags-e2e");
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
  openTab: (url: string, ownerAgentId: string, ownerThreadId: string) =>
    page.evaluate((input) => window.openbot.browser.open({ ...input, focus: false }), {
      url,
      ownerAgentId,
      ownerThreadId,
    }),
  tabs: () => page.evaluate(() => window.openbot.browser.listTabs()),
};

/** The assistant reply that names one of `needles`, after the turn ends. */
const replyWith = (snapshot: ConversationSnapshot, needles: string[]) =>
  snapshot.activeTurnId === null
    ? snapshot.messages.find(
        (message) => message.author === "assistant" && needles.some((needle) => message.text.includes(needle)),
      )
    : undefined;

/** The assistant replies after the user message that holds `marker`. */
const repliesAfter = (snapshot: ConversationSnapshot, marker: string) => {
  const sent = snapshot.messages.findIndex((message) => message.author === "user" && message.text.includes(marker));
  if (sent < 0) return [];
  return snapshot.messages
    .slice(sent + 1)
    .filter((message) => message.author === "assistant")
    .map((message) => message.text);
};
const answeredAfter = (snapshot: ConversationSnapshot, marker: string) =>
  snapshot.activeTurnId === null && repliesAfter(snapshot, marker).length > 0;

const openedTabs: string[] = [];
let taskId: string | null = null;
try {
  const agents = await bridge.agents();
  const agent = agents.find((candidate) => candidate.id === agentId);
  assert.ok(agent, `Unknown agent: ${agentId}`);
  report.provider = agent.provider;

  // The agent's own chat needs a thread to own a tab.
  await bridge.send(SHORT_PROMPT);
  const ready = await waitFor(page, "own chat replies", bridge.main, (snapshot) =>
    Boolean(replyWith(snapshot, ["ready"])),
  );
  const mainThreadId = ready.threadId;
  assert.ok(mainThreadId, "The agent's own chat has a thread.");

  const ownTab = await bridge.openTab(`${origin}/own`, agentId, mainThreadId);
  openedTabs.push(ownTab.id);
  await waitFor(page, "own tab loads", bridge.tabs, (tabs) =>
    tabs.some((tab) => tab.id === ownTab.id && tab.title === pages["/own"]?.title && !tab.loading),
  );

  const task = await page.evaluate(
    (input) => window.openbot.agent.startTask({ ...input, clientMessageId: crypto.randomUUID() }),
    {
      agentId,
      text: `The thread code word is ${words.thread}. Keep it. Reply with the single word ready. Do not use tools.`,
    },
  );
  taskId = task.id;
  const sideTaskId = task.id;
  await waitFor(
    page,
    "side thread replies",
    () => bridge.side(sideTaskId),
    (snapshot) => Boolean(replyWith(snapshot, ["ready"])),
  );

  // 1. The side thread reads a tab of the agent's own chat.
  const tabTag = serializeChatTagReference("tab", pages["/own"]?.title ?? "", ownTab.id);
  await bridge.send(
    `${tabTag} Read the text of this tab with your browser tool. Reply with the code word only.`,
    sideTaskId,
  );
  const sideAfter = await waitFor(
    page,
    "side thread reads the tab",
    () => bridge.side(sideTaskId),
    (snapshot) => answeredAfter(snapshot, tabTag),
  );
  report.sharedTabRead = repliesAfter(sideAfter, tabTag).some((text) => text.includes(words.tab));
  assert.ok(report.sharedTabRead, "The side thread read the tagged tab of the agent's own chat.");

  // 2. The agent's own chat reads the side thread.
  const threadTag = serializeChatTagReference("thread", task.title, sideTaskId);
  await bridge.send(
    `${threadTag} Read that thread. Its first message names the thread code word; the thread also holds a tab code word. Reply with the thread code word only.`,
  );
  const mainAfter = await waitFor(
    page,
    "own chat reads the thread",
    bridge.main,
    (snapshot) =>
      snapshot.activeTurnId === null &&
      snapshot.messages.at(-1)?.author === "assistant" &&
      snapshot.messages.some((message) => message.text.includes(threadTag)),
  );
  report.threadWordFound = repliesAfter(mainAfter, threadTag).some((text) => text.includes(words.thread));
  assert.ok(report.threadWordFound, "The agent's own chat found the code word of the tagged thread.");

  // 3. A tag of another agent's tab shares nothing.
  const other = agents.find((candidate) => candidate.id !== agentId);
  if (!other) {
    report.foreignTab = null;
    report.notCovered.push("Another agent's tab: the profile has one agent.");
  } else {
    const otherTab = await bridge.openTab(`${origin}/other`, other.id, `chat-tags-e2e-${run}`);
    openedTabs.push(otherTab.id);
    await waitFor(page, "other tab loads", bridge.tabs, (tabs) =>
      tabs.some((tab) => tab.id === otherTab.id && !tab.loading),
    );
    const otherTag = serializeChatTagReference("tab", pages["/other"]?.title ?? "", otherTab.id);
    await bridge.send(
      `${otherTag} Read the text of this tab with your browser tool. Use only this tab id. Reply with the code word only. If the tool cannot read it, reply with the single word ${words.blocked}.`,
    );
    const foreign = await waitFor(page, "own chat answers about the other tab", bridge.main, (snapshot) =>
      answeredAfter(snapshot, otherTag),
    );
    // The agent can fall back to a tab of its own; only the other page's code word is a leak.
    const reply = repliesAfter(foreign, otherTag).join("\n");
    report.foreignTab = { otherAgentId: other.id, pageTextLeaked: reply.includes(words.other), reply };
    assert.ok(!report.foreignTab.pageTextLeaked, "The agent did not read another agent's tab.");
  }

  // 4. The stored messages keep the markers.
  const stored = [...(await bridge.main()).messages, ...(await bridge.side(sideTaskId)).messages];
  report.markersStored = {
    tab: stored.some((message) => message.author === "user" && message.text.includes(tabTag)),
    thread: stored.some((message) => message.author === "user" && message.text.includes(threadTag)),
  };
  assert.deepEqual(report.markersStored, { tab: true, thread: true }, "The stored messages keep the markers.");
  report.passed = true;
} finally {
  for (const tabId of openedTabs) {
    await page.evaluate((id) => window.openbot.browser.close(id), tabId).catch(() => undefined);
  }
  if (taskId) {
    const input = { agentId, taskId };
    await page.evaluate((value) => window.openbot.agent.stopTask(value), input).catch(() => undefined);
    await page.evaluate((value) => window.openbot.agent.deleteTask(value), input).catch(() => undefined);
  }
  writeReport("chat-tags-e2e", report);
  await session.close();
  server.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
