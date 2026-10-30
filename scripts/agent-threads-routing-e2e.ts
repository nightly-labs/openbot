// Checks that a search result opens the thread that has the message, in this worktree's running dev
// app, through the real UI, preload bridge, agent service and provider. It changes the data of the
// profile, so start the app with `bun run dev` (never `--shared`), and pass an agent whose provider is
// signed in: `bun scripts/agent-threads-routing-e2e.ts --allow-mutations --agent=<agent id>`.
//
// 1. A side thread gets a message with a word that no other message has.
// 2. The search on this computer finds the word only when it includes side threads, and the result
//    names the side thread.
// 3. In the search dialog, the result opens the thread's tab, also when the agent's own chat is open.
// 4. An archived thread is not in the results.
// The script does not cover a notification click: only the main process sends it, and the dev app has
// no main-process inspector. The app has no link to one message, so there is no link to check.
// Writes .openbot-build/agent-threads-routing-e2e/report.json and a screenshot.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentTask, AgentTasksSnapshot, ConversationSearchPage } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { argument, connectChannelE2e, waitFor, writeReport } from "./channel-e2e-support";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-threads-routing-e2e");
mkdirSync(OUT, { recursive: true });
const UI_WAIT_MS = 15_000;
const english = translateFor("en");
const agentArgument = argument("agent");
assert.ok(agentArgument, "Pass --agent=<agent id> of an agent whose provider is signed in.");
const agentId: string = agentArgument;
const word = `routing${crypto.randomUUID().slice(0, 8)}`;

interface Report {
  agentId: string;
  word: string;
  taskId?: string;
  bridgeSearch?: { withoutSideThreads: number; withSideThreads: number; taskId: string | null };
  searchDialog?: { resultShown: boolean; tabSelected: boolean; threadViewShown: boolean };
  archived?: { withSideThreads: number };
  notCovered: string[];
  pageErrors: string[];
  passed: boolean;
}

const report: Report = {
  agentId,
  word,
  notCovered: [
    "Notification click: the main process sends it, and the dev app has no main-process inspector to click one.",
    "Link to a message: the app has none.",
    "File search and the Storage panel: they still leave out side threads.",
  ],
  pageErrors: [],
  passed: false,
};
const session = await connectChannelE2e("agent-threads-routing-e2e");
const { page } = session;
page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
let taskId: string | null = null;

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tab = (title: string) =>
  page
    .getByRole("tablist", { name: english("conversation.threads.open") })
    .getByRole("tab", { name: new RegExp(`^${literal(title)}`) });

function listTasks(): Promise<AgentTasksSnapshot> {
  return page.evaluate((id) => window.openbot.agent.listTasks(id), agentId);
}

async function readTask(): Promise<AgentTask | undefined> {
  return (await listTasks()).tasks.find((task) => task.id === taskId);
}

function search(includeSideThreads: boolean): Promise<ConversationSearchPage> {
  return page.evaluate(
    (input) => window.openbot.agent.searchConversationMessages(input),
    includeSideThreads ? { query: word, agentId, includeSideThreads } : { query: word, agentId },
  );
}

const agent = await page.evaluate(async (id) => {
  const found = (await window.openbot.agent.listAgents()).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown agent: ${id}`);
  return { name: found.name };
}, agentId);

try {
  await page.bringToFront();

  // 1. A side thread with the word.
  const task = await page.evaluate(
    (input) => window.openbot.agent.startTask({ ...input, clientMessageId: crypto.randomUUID() }),
    { agentId, text: `Reply with the single word ready. Do not use tools. Reference ${word}.` },
  );
  taskId = task.id;
  report.taskId = task.id;
  await waitFor(page, "the side thread's turn ends", readTask, (current) => current?.state === "idle");

  // 2. The bridge search.
  const without = await search(false);
  const withSide = await waitFor(
    page,
    "the search finds the side thread",
    () => search(true),
    (result) => result.results.length > 0,
  );
  report.bridgeSearch = {
    withoutSideThreads: without.results.length,
    withSideThreads: withSide.results.length,
    taskId: withSide.results[0]?.taskId ?? null,
  };
  assert.equal(without.results.length, 0, "A search without side threads finds a side-thread message.");
  assert.equal(report.bridgeSearch.taskId, task.id, "The result does not name its side thread.");

  // 3. The search dialog opens the thread's tab from the agent's own chat. "What's new" shows after
  //    a version change and covers the window.
  const whatsNew = page.getByRole("dialog", { name: english("update.whatsNew.title") });
  if (await whatsNew.isVisible()) {
    await whatsNew.getByRole("button", { name: english("update.whatsNew.done") }).click();
    await whatsNew.waitFor({ state: "detached", timeout: UI_WAIT_MS });
  }
  await page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${literal(agent.name)}[,.]`) })
    .first()
    .click();
  await page
    .getByRole("button", { name: english("conversation.globalSearch.title") })
    .first()
    .click();
  const input = page.getByRole("combobox", { name: english("conversation.globalSearch.title") });
  await input.waitFor({ timeout: UI_WAIT_MS });
  await input.fill(word);
  const result = page
    .getByRole("listbox", { name: english("conversation.globalSearch.results") })
    .getByRole("option", { name: new RegExp(literal(word)) })
    .first();
  await result.waitFor({ timeout: UI_WAIT_MS });
  await result.click();
  const current = await readTask();
  assert.ok(current);
  await tab(current.title).waitFor({ timeout: UI_WAIT_MS });
  const tabSelected = (await tab(current.title).getAttribute("aria-selected")) === "true";
  const threadView = page.getByRole("region", {
    name: english("conversation.threads.view.label", { title: current.title }),
  });
  await threadView.waitFor({ timeout: UI_WAIT_MS });
  report.searchDialog = { resultShown: true, tabSelected, threadViewShown: true };
  assert.ok(tabSelected, "The search result does not select the thread's tab.");
  await page.screenshot({ path: resolve(OUT, "3-search-opened-thread.png") });

  // 4. An archived thread is not in the results.
  await page.evaluate((input) => window.openbot.agent.closeTask(input), { agentId, taskId: task.id });
  await waitFor(page, "the archive", readTask, (archived) => archived?.state === "closed");
  report.archived = { withSideThreads: (await search(true)).results.length };
  assert.equal(report.archived.withSideThreads, 0, "The search finds an archived thread.");
  report.passed = true;
} finally {
  if (taskId) {
    const id = taskId;
    await page
      .evaluate((input) => window.openbot.agent.deleteTask(input), { agentId, taskId: id })
      .catch(() => undefined);
  }
  writeReport("agent-threads-routing-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
