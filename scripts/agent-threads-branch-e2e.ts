// Drives "Branch from here" in this worktree's running dev app, through the real UI, preload bridge,
// agent service and provider. It changes the data of the profile, so start the app with `bun run dev`
// (never `--shared`), and pass the id of an agent whose provider is signed in and runs turns at the
// same time (not a custom ACP agent):
// `bun scripts/agent-threads-branch-e2e.ts --allow-mutations --agent=<agent id>`.
//
// It starts a side thread with two turns, branches it from the end of the first turn with the button
// of that message, and checks the copy, the title, the open tab, the divider and its jump back to the
// source. A retry with the same request id gives the same branch. While a turn of the source runs,
// the button and the menu item are off and the host refuses a branch. A branch of the agent's own chat
// takes the last user message as its title. The thread menu shows each branch under its source, and a
// branch whose source was deleted keeps its messages and says so. Each turn is a real provider turn, so
// the prompts are short. Every thread that it started is deleted at the end.
// Writes .openbot-build/agent-threads-branch-e2e/report.json and screenshots.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { agentProviderDescriptor, isAgentProvider } from "@openbot/contracts/agent-providers";
import type {
  AgentTask,
  AgentTasksSnapshot,
  ConversationMessage,
  ConversationSnapshot,
  QueueSnapshot,
} from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { argument, connectChannelE2e, LONG_PROMPT, SHORT_PROMPT, waitFor, writeReport } from "./channel-e2e-support";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-threads-branch-e2e");
mkdirSync(OUT, { recursive: true });
const UI_WAIT_MS = 15_000;
const SECOND_PROMPT = "Reply with the single word done. Do not use tools.";
const english = translateFor("en");
const agentArgument = argument("agent");
assert.ok(agentArgument, "Pass --agent=<agent id> of an agent whose provider is signed in.");
const agentId: string = agentArgument;

interface Report {
  agentId: string;
  provider?: string;
  source?: { taskId: string; title: string; messages: number; branchButtons: number };
  branched?: {
    taskId: string;
    title: string;
    tabSelected: boolean;
    copied: number;
    sameText: boolean;
    newIds: boolean;
    link: AgentTask["branch"];
  };
  divider?: { text: string; jumpedToSource: boolean };
  retry?: { sameTask: boolean; title: string };
  threadMenu?: { order: string[] };
  whileRunning?: { buttonDisabled: boolean; menuItemDisabled: boolean; refused: boolean; error: string };
  ownChat?: { taskId: string; title: string; sourceTaskId: string | null; copied: number };
  deletedSource?: { text: string; link: boolean; messagesKept: number };
  pageErrors: string[];
  screenshots: string[];
  passed: boolean;
}

const report: Report = { agentId, pageErrors: [], screenshots: [], passed: false };
const session = await connectChannelE2e("agent-threads-branch-e2e");
const { page } = session;
page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
const started: string[] = [];

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tabs = () => page.getByRole("tablist", { name: english("conversation.threads.open") });
// A tab's name ends with the state of its thread while a turn runs or waits. A branch title adds " #N".
const tab = (title: string) => tabs().getByRole("tab", { name: new RegExp(`^${literal(title)}(?! #\\d)`) });
const threadView = (title: string) =>
  page.getByRole("region", { name: english("conversation.threads.view.label", { title }) });
const branchButtons = (title: string) =>
  threadView(title).getByRole("button", { name: english("chat.actions.branch"), exact: true });
/** The messages with a branch button. Their buttons take the pointer only while the pointer is on them. */
const branchPoints = (title: string) =>
  threadView(title)
    .getByRole("article")
    .filter({ has: page.getByRole("button", { name: english("chat.actions.branch"), exact: true }) });

function listTasks(): Promise<AgentTasksSnapshot> {
  return page.evaluate((id) => window.openbot.agent.listTasks(id), agentId);
}

function readTask(taskId: string): Promise<ConversationSnapshot> {
  return page.evaluate((input) => window.openbot.agent.readTask(input), { agentId, taskId });
}

function listQueue(): Promise<QueueSnapshot> {
  return page.evaluate((id) => window.openbot.agent.listQueue(id), agentId);
}

function task(taskId: string): Promise<AgentTask | undefined> {
  return listTasks().then((snapshot) => snapshot.tasks.find((candidate) => candidate.id === taskId));
}

function waitForTask(label: string, taskId: string, ready: (task: AgentTask | undefined) => boolean) {
  return waitFor(page, label, () => task(taskId), ready);
}

function branch(taskId: string | null, messageId: string, requestId: string): Promise<AgentTask> {
  return page.evaluate((input) => window.openbot.agent.branchTask(input), { agentId, taskId, messageId, requestId });
}

/** The last finished agent message of each turn, in order: the messages that a branch can start from. */
function turnEnds(messages: readonly ConversationMessage[]): ConversationMessage[] {
  const ends = new Map<string, ConversationMessage>();
  for (const message of messages)
    if (message.author !== "user" && message.turnId && message.status === "completed")
      ends.set(message.turnId, message);
  return [...ends.values()];
}

/** The messages through the given one, in order. */
function through(messages: readonly ConversationMessage[], messageId: string): ConversationMessage[] {
  const index = messages.findIndex((message) => message.id === messageId);
  assert.ok(index >= 0, `No message ${messageId}.`);
  return messages.slice(0, index + 1);
}

async function shot(label: string): Promise<void> {
  const path = resolve(OUT, `${label}.png`);
  await page.screenshot({ path });
  report.screenshots.push(path);
}

async function selected(title: string): Promise<boolean> {
  return (await tab(title).getAttribute("aria-selected")) === "true";
}

async function openAgent(name: string): Promise<void> {
  await page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${literal(name)}[,.]`) })
    .first()
    .click();
  await page
    .getByRole("button", { name: english("conversation.threads.new"), exact: true })
    .first()
    .waitFor({ timeout: UI_WAIT_MS });
}

async function openThread(title: string): Promise<void> {
  if ((await tab(title).count()) === 0) {
    await page.getByRole("button", { name: english("conversation.threads.all"), exact: true }).click();
    await page
      .getByRole("menuitem", { name: new RegExp(`${literal(title)}(?! #\\d)`) })
      .first()
      .click();
  }
  await tab(title).click();
  await threadView(title).waitFor({ timeout: UI_WAIT_MS });
}

const agent = await page.evaluate(async (id) => {
  const found = (await window.openbot.agent.listAgents()).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown agent: ${id}`);
  return { name: found.name, provider: found.provider };
}, agentId);
report.provider = agent.provider;
assert.ok(isAgentProvider(agent.provider), `The agent ${agentId} has a provider that this build does not know.`);
assert.ok(
  agentProviderDescriptor(agent.provider).concurrentTurns,
  `${agent.provider} runs one turn at a time. Choose an agent on another provider.`,
);
const sourceTitle = `E2E branch ${crypto.randomUUID().slice(0, 4)}`;

try {
  await page.bringToFront();
  await openAgent(agent.name);

  // 1. A side thread with two finished turns shows one branch button for each turn.
  const source = await page.evaluate(
    (input) => window.openbot.agent.startTask({ ...input, clientMessageId: crypto.randomUUID() }),
    { agentId, text: SHORT_PROMPT },
  );
  started.push(source.id);
  await waitForTask("the first turn ends", source.id, (current) => current?.state === "idle");
  await page.evaluate((input) => window.openbot.agent.renameTask(input), {
    agentId,
    taskId: source.id,
    title: sourceTitle,
  });
  await page.evaluate((input) => window.openbot.agent.sendMessage({ ...input, clientMessageId: crypto.randomUUID() }), {
    agentId,
    taskId: source.id,
    text: SECOND_PROMPT,
  });
  await waitFor(
    page,
    "the second turn ends",
    () => readTask(source.id),
    (snapshot) => snapshot.activeTurnId === null && turnEnds(snapshot.messages).length === 2,
  );
  await waitForTask("the source is idle", source.id, (current) => current?.state === "idle");
  await openThread(sourceTitle);
  await waitFor(
    page,
    "two branch buttons",
    () => branchButtons(sourceTitle).count(),
    (count) => count === 2,
  );
  const sourceMessages = (await readTask(source.id)).messages;
  const [firstEnd, secondEnd] = turnEnds(sourceMessages);
  assert.ok(firstEnd && secondEnd);
  report.source = {
    taskId: source.id,
    title: sourceTitle,
    messages: sourceMessages.length,
    branchButtons: await branchButtons(sourceTitle).count(),
  };

  // 2. The button of the first turn's answer opens a new branch tab with the copy through that turn.
  const before = new Set((await listTasks()).tasks.map((candidate) => candidate.id));
  const firstButton = branchButtons(sourceTitle).first();
  await branchPoints(sourceTitle).first().hover();
  await shot("1-branch-button");
  await firstButton.click();
  const afterBranch = await waitFor(page, "the branch", listTasks, (snapshot) =>
    snapshot.tasks.some((candidate) => !before.has(candidate.id)),
  );
  const branched = afterBranch.tasks.find((candidate) => !before.has(candidate.id));
  assert.ok(branched);
  started.push(branched.id);
  await tab(branched.title).waitFor({ timeout: UI_WAIT_MS });
  const expected = through(sourceMessages, firstEnd.id);
  const copy = (await readTask(branched.id)).messages;
  report.branched = {
    taskId: branched.id,
    title: branched.title,
    tabSelected: await selected(branched.title),
    copied: copy.length,
    sameText: copy.map((message) => message.text).join("\n") === expected.map((message) => message.text).join("\n"),
    newIds: copy.every((message) => !sourceMessages.some((original) => original.id === message.id)),
    link: branched.branch,
  };
  assert.equal(branched.title, `${sourceTitle} #2`);
  assert.ok(report.branched.tabSelected, "The branch tab takes focus.");
  assert.equal(copy.length, expected.length, "The branch copies the messages through the first turn only.");
  assert.ok(report.branched.sameText && report.branched.newIds);
  assert.equal(branched.branch?.sourceTaskId, source.id);
  assert.equal(branched.branch?.sourceMessageId, firstEnd.id);
  assert.equal(branched.branch?.throughMessageId, copy.at(-1)?.id);
  assert.equal((await readTask(source.id)).messages.length, sourceMessages.length, "The source does not change.");

  // 3. The divider names the source; a click opens the source tab.
  const dividerText = english("conversation.threads.branch.from", { title: sourceTitle });
  const divider = threadView(branched.title).getByRole("button", { name: dividerText });
  await divider.waitFor({ timeout: UI_WAIT_MS });
  await shot("2-branch-divider");
  await divider.click();
  await threadView(sourceTitle).waitFor({ timeout: UI_WAIT_MS });
  report.divider = { text: dividerText, jumpedToSource: await selected(sourceTitle) };
  assert.ok(report.divider.jumpedToSource, "The divider opens the source.");

  // 4. A retry with the same request id gives the same branch.
  const requestId = crypto.randomUUID();
  const first = await branch(source.id, secondEnd.id, requestId);
  started.push(first.id);
  const again = await branch(source.id, secondEnd.id, requestId);
  report.retry = { sameTask: first.id === again.id, title: first.title };
  assert.ok(report.retry.sameTask, "A retry with the same request id gives the same branch.");
  assert.equal(first.title, `${sourceTitle} #3`);

  // 5. The thread menu shows both branches under their source.
  await page.getByRole("button", { name: english("conversation.threads.all"), exact: true }).click();
  const menu = page.getByRole("menu").last();
  await menu.getByRole("menuitem", { name: new RegExp(literal(`${sourceTitle} #3`)) }).waitFor({ timeout: UI_WAIT_MS });
  // A branch changed after its source, so only the nesting puts it below the source.
  const titles = [sourceTitle, `${sourceTitle} #3`, `${sourceTitle} #2`];
  const names = (await menu.getByRole("menuitem").allInnerTexts()).map((name) => name.replace(/\s+/g, " "));
  report.threadMenu = {
    order: names.map((name) => titles.findLast((title) => name.includes(title)) ?? "").filter(Boolean),
  };
  await shot("3-thread-menu");
  await page.keyboard.press("Escape");
  assert.deepEqual(report.threadMenu.order, titles, "The thread menu nests the branches.");

  // 6. While a turn of the source runs, the button and the menu item are off, and the host refuses.
  await openThread(sourceTitle);
  await page.evaluate((input) => window.openbot.agent.sendMessage({ ...input, clientMessageId: crypto.randomUUID() }), {
    agentId,
    taskId: source.id,
    text: LONG_PROMPT,
  });
  await waitForTask("the long turn runs", source.id, (current) => current?.state === "running");
  const lastButton = branchButtons(sourceTitle).last();
  const buttonDisabled = await lastButton.isDisabled();
  await branchPoints(sourceTitle).last().click({ button: "right" });
  const menuItem = page.getByRole("menuitem", { name: english("chat.menu.branch"), exact: true });
  await menuItem.waitFor({ timeout: UI_WAIT_MS });
  const menuItemDisabled =
    (await menuItem.getAttribute("aria-disabled")) === "true" ||
    (await menuItem.getAttribute("data-disabled")) !== null;
  await shot("4-running-menu");
  await page.keyboard.press("Escape");
  const refusal = await branch(source.id, secondEnd.id, crypto.randomUUID()).then(
    (unexpected) => {
      started.push(unexpected.id);
      return "";
    },
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  report.whileRunning = { buttonDisabled, menuItemDisabled, refused: refusal !== "", error: refusal };
  await page.evaluate((input) => window.openbot.agent.stopTask(input), { agentId, taskId: source.id });
  await waitForTask("the long turn stops", source.id, (current) => current?.state === "idle");
  assert.ok(buttonDisabled, "The branch button is off while a turn runs.");
  assert.ok(menuItemDisabled, "Branch from here is off while a turn runs.");
  assert.ok(refusal.includes(english("error.backend.branchSourceBusy")), "The host refuses a running source.");

  // 7. A branch of the agent's own chat takes the last user message as its title.
  await page.evaluate((input) => window.openbot.agent.sendMessage({ ...input, clientMessageId: crypto.randomUUID() }), {
    agentId,
    text: SHORT_PROMPT,
  });
  const ownChat = await waitFor(
    page,
    "the own chat's turn ends",
    () => page.evaluate((id) => window.openbot.agent.readConversation(id), agentId),
    (snapshot) => snapshot.activeTurnId === null && snapshot.messages.at(-1)?.author !== "user",
  );
  const ownEnd = turnEnds(ownChat.messages).at(-1);
  assert.ok(ownEnd);
  const ownBranch = await branch(null, ownEnd.id, crypto.randomUUID());
  started.push(ownBranch.id);
  report.ownChat = {
    taskId: ownBranch.id,
    title: ownBranch.title,
    sourceTaskId: ownBranch.branch?.sourceTaskId ?? null,
    copied: (await readTask(ownBranch.id)).messages.length,
  };
  assert.equal(ownBranch.branch?.sourceTaskId, null);
  assert.ok(SHORT_PROMPT.startsWith(ownBranch.title.replace(/…$/, "")), "The title is the last user message.");

  // 8. A branch keeps its messages when its source is deleted, and the divider says so with no link.
  await page.evaluate((input) => window.openbot.agent.deleteTask(input), { agentId, taskId: source.id });
  await waitForTask("the source is deleted", source.id, (current) => current === undefined);
  started.splice(started.indexOf(source.id), 1);
  await openThread(branched.title);
  const deletedText = english("conversation.threads.branch.fromDeleted");
  await threadView(branched.title).getByText(deletedText, { exact: true }).waitFor({ timeout: UI_WAIT_MS });
  report.deletedSource = {
    text: deletedText,
    link: (await threadView(branched.title).getByRole("button", { name: deletedText }).count()) > 0,
    messagesKept: (await readTask(branched.id)).messages.length,
  };
  await shot("5-deleted-source");
  assert.equal(report.deletedSource.link, false);
  assert.equal(report.deletedSource.messagesKept, copy.length);
  assert.equal((await task(branched.id))?.branch?.sourceTaskId, source.id, "The link stays.");
  report.passed = true;
} finally {
  for (const delivery of (await listQueue().catch(() => null))?.deliveries ?? [])
    if (delivery.turnId && (delivery.status === "starting" || delivery.status === "running"))
      await page
        .evaluate((input) => window.openbot.agent.interrupt(input), { agentId, turnId: delivery.turnId })
        .catch(() => undefined);
  for (const taskId of new Set(started)) {
    await page.evaluate((input) => window.openbot.agent.stopTask(input), { agentId, taskId }).catch(() => undefined);
    await waitForTask("the cleanup stop", taskId, (current) => current?.state !== "running").catch(() => undefined);
    await page.evaluate((input) => window.openbot.agent.deleteTask(input), { agentId, taskId }).catch(() => undefined);
  }
  writeReport("agent-threads-branch-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
