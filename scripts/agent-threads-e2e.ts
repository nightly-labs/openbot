import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { agentProviderDescriptor, isAgentProvider } from "@openbot/contracts/agent-providers";
import type { AgentTask, AgentTasksSnapshot, QueueSnapshot } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import type { Locator } from "playwright-core";
import { argument, connectChannelE2e, LONG_PROMPT, SHORT_PROMPT, waitFor, writeReport } from "./channel-e2e-support";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-threads-e2e");
mkdirSync(OUT, { recursive: true });
const UI_WAIT_MS = 15_000;
const english = translateFor("en");
const agentArgument = argument("agent");
assert.ok(agentArgument, "Pass --agent=<agent id> of an agent whose provider is signed in.");
const agentId: string = agentArgument;

interface Report {
  agentId: string;
  provider?: string;
  created?: { taskId: string; tabSelected: boolean; title: string };
  renamed?: { title: string; tab: boolean };
  closedTab?: { inMenu: boolean; state: string; reopened: boolean };
  archived?: { state: string; inArchivedList: boolean };
  restored?: { state: string; tabSelected: boolean };
  archivedElsewhere?: { tabHidden: boolean; threadViewClosed: boolean; tabBack: boolean };
  reopenedAfterTabChange?: { tabBack: boolean };
  deleteWhileRunning?: { menuDisabled: boolean; refused: boolean; error: string };
  reload?: { tabKept: boolean; tabSelected: boolean };
  undo?: { toast: boolean; archivedDuringUndo: boolean; tabBack: boolean; state: string };
  deleted?: { gone: boolean };
  deleteAcrossReload?: { taskId: string; hiddenAfterReload: boolean; gone: boolean };
  unsentDraft?: { typedDuringTurn: boolean; afterTurn: string; afterSwitch: string; afterReload: string };
  pageErrors: string[];
  screenshots: string[];
  passed: boolean;
}

const report: Report = { agentId, pageErrors: [], screenshots: [], passed: false };
const session = await connectChannelE2e("agent-threads-e2e");
const { page } = session;
page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
let threadId: string | null = null;
let deleted = false;

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tabs = () => page.getByRole("tablist", { name: english("conversation.threads.open") });
const tab = (title: string) => tabs().getByRole("tab", { name: new RegExp(`^${literal(title)}`) });
const tabMenu = () => page.getByRole("menu", { name: english("conversation.threads.actions") });
const menuItem = (menu: Locator, name: string) => menu.getByRole("menuitem", { name, exact: true });
const button = (name: string) => page.getByRole("button", { name, exact: true });

function listTasks(): Promise<AgentTasksSnapshot> {
  return page.evaluate((id) => window.openbot.agent.listTasks(id), agentId);
}

function listQueue(): Promise<QueueSnapshot> {
  return page.evaluate((id) => window.openbot.agent.listQueue(id), agentId);
}

function ownChatRuns(snapshot: QueueSnapshot): boolean {
  return snapshot.deliveries.some(
    (delivery) => delivery.status === "queued" || delivery.status === "starting" || delivery.status === "running",
  );
}

async function readTask(): Promise<AgentTask | undefined> {
  return (await listTasks()).tasks.find((task) => task.id === threadId);
}

async function waitForTask(
  label: string,
  ready: (task: AgentTask | undefined) => boolean,
): Promise<AgentTask | undefined> {
  return waitFor(page, label, readTask, ready);
}

async function shot(label: string): Promise<void> {
  const path = resolve(OUT, `${label}.png`);
  await page.screenshot({ path });
  report.screenshots.push(path);
}

async function selected(title: string): Promise<boolean> {
  return (await tab(title).getAttribute("aria-selected")) === "true";
}

async function openTabMenu(title: string): Promise<Locator> {
  await tab(title).click({ button: "right" });
  await tabMenu().waitFor({ timeout: UI_WAIT_MS });
  return tabMenu();
}

async function openAgent(name: string): Promise<void> {
  await page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${literal(name)}[,.]`) })
    .first()
    .click();
  await button(english("conversation.threads.new")).first().waitFor({ timeout: UI_WAIT_MS });
}

const agent = await page.evaluate(async (id) => {
  const found = (await window.openbot.agent.listAgents()).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown agent: ${id}`);
  return { name: found.name, provider: found.provider };
}, agentId);
report.provider = agent.provider;
const provider = agent.provider;
assert.ok(isAgentProvider(provider), `The agent ${agentId} has a provider that this build does not know.`);
assert.ok(
  agentProviderDescriptor(provider).concurrentTurns,
  `${agent.provider} runs one turn at a time. Choose an agent on another provider.`,
);
const title = `E2E thread ${crypto.randomUUID().slice(0, 4)}`;

try {
  await page.bringToFront();
  await openAgent(agent.name);
  const before = new Set((await listTasks()).tasks.map((task) => task.id));

  await button(english("conversation.threads.new")).first().click();
  const draftComposer = page.getByRole("textbox", {
    name: english("conversation.threads.view.newPlaceholder", { name: agent.name }),
  });
  await draftComposer.waitFor({ timeout: UI_WAIT_MS });
  await draftComposer.fill(SHORT_PROMPT);
  await draftComposer.press("Enter");
  const started = await waitFor(page, "the thread starts", listTasks, (snapshot) =>
    snapshot.tasks.some((task) => !before.has(task.id)),
  );
  const task = started.tasks.find((candidate) => !before.has(candidate.id));
  assert.ok(task);
  threadId = task.id;
  await tab(task.title).waitFor({ timeout: UI_WAIT_MS });
  report.created = { taskId: task.id, tabSelected: await selected(task.title), title: task.title };
  assert.ok(report.created.tabSelected, "The new thread's tab is the open tab.");
  await waitForTask("the first turn ends", (current) => current?.state === "idle");
  await shot("1-created");

  await tab(task.title).dblclick();
  const field = page.getByRole("textbox", { name: english("conversation.threads.name") });
  await field.waitFor({ timeout: UI_WAIT_MS });
  await field.fill(title);
  await field.press("Enter");
  await waitForTask("the rename", (current) => current?.title === title);
  await tab(title).waitFor({ timeout: UI_WAIT_MS });
  report.renamed = { title, tab: true };

  await menuItem(await openTabMenu(title), english("conversation.threads.closeTab")).click();
  await tab(title).waitFor({ state: "detached", timeout: UI_WAIT_MS });
  await button(english("conversation.threads.all")).click();
  const listed = page.getByRole("menuitem", { name: new RegExp(literal(title)) }).first();
  await listed.waitFor({ timeout: UI_WAIT_MS });
  const afterClose = await readTask();
  await listed.click();
  await tab(title).waitFor({ timeout: UI_WAIT_MS });
  report.closedTab = { inMenu: true, state: afterClose?.state ?? "missing", reopened: await selected(title) };
  assert.notEqual(report.closedTab.state, "closed");

  await menuItem(await openTabMenu(title), english("conversation.threads.archive")).click();
  await tab(title).waitFor({ state: "detached", timeout: UI_WAIT_MS });
  const archived = await waitForTask("the archive", (current) => current?.state === "closed");
  await button(english("conversation.threads.all")).click();
  await page.getByRole("menuitem", { name: english("conversation.threads.archived") }).click();
  const archivedItem = page
    .getByRole("menu", { name: english("conversation.threads.archived"), exact: true })
    .getByRole("menuitem", { name: new RegExp(literal(title)) });
  await archivedItem.waitFor({ timeout: UI_WAIT_MS });
  report.archived = { state: archived?.state ?? "missing", inArchivedList: true };
  await shot("4-archived-list");

  await archivedItem.click();
  const restored = await waitForTask("the restore", (current) => current?.state === "idle");
  await tab(title).waitFor({ timeout: UI_WAIT_MS });
  report.restored = { state: restored?.state ?? "missing", tabSelected: await selected(title) };
  assert.ok(report.restored.tabSelected);

  await page.evaluate(({ agent, task }) => window.openbot.agent.closeTask({ agentId: agent, taskId: task }), {
    agent: agentId,
    task: task.id,
  });
  await tab(title).waitFor({ state: "detached", timeout: UI_WAIT_MS });
  const threadView = page.getByRole("region", { name: english("conversation.threads.view.label", { title }) });
  await threadView.waitFor({ state: "detached", timeout: UI_WAIT_MS });
  await page.evaluate(({ agent, task }) => window.openbot.agent.reopenTask({ agentId: agent, taskId: task }), {
    agent: agentId,
    task: task.id,
  });
  await tab(title).waitFor({ timeout: UI_WAIT_MS });
  report.archivedElsewhere = { tabHidden: true, threadViewClosed: true, tabBack: true };

  await page.evaluate(({ agent, task }) => window.openbot.agent.closeTask({ agentId: agent, taskId: task }), {
    agent: agentId,
    task: task.id,
  });
  await tab(title).waitFor({ state: "detached", timeout: UI_WAIT_MS });
  await button(english("conversation.threads.new")).first().click();
  const draftTab = tab(english("conversation.threads.new"));
  await draftTab.waitFor({ timeout: UI_WAIT_MS });
  await menuItem(
    await openTabMenu(english("conversation.threads.new")),
    english("conversation.threads.closeTab"),
  ).click();
  await draftTab.waitFor({ state: "detached", timeout: UI_WAIT_MS });
  await page.evaluate(({ agent, task }) => window.openbot.agent.reopenTask({ agentId: agent, taskId: task }), {
    agent: agentId,
    task: task.id,
  });
  await tab(title).waitFor({ timeout: UI_WAIT_MS });
  report.reopenedAfterTabChange = { tabBack: true };

  await tab(title).click();
  const composer = page.getByRole("textbox", {
    name: english("conversation.threads.view.placeholder", { name: agent.name }),
  });
  await composer.fill(LONG_PROMPT);
  await composer.press("Enter");
  await waitForTask("the long turn runs", (current) => current?.state === "running");
  const runningMenu = await openTabMenu(title);
  const deleteItem = menuItem(runningMenu, english("common.delete"));
  const menuDisabled = (await deleteItem.count()) === 0 || (await deleteItem.getAttribute("aria-disabled")) === "true";
  await page.keyboard.press("Escape");
  const refusal = await page.evaluate(
    ({ agent, task }) =>
      window.openbot.agent.deleteTask({ agentId: agent, taskId: task }).then(
        () => "",
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      ),
    { agent: agentId, task: task.id },
  );
  report.deleteWhileRunning = { menuDisabled, refused: refusal !== "", error: refusal };
  assert.ok(menuDisabled, "Delete is off while a turn runs.");
  assert.ok(report.deleteWhileRunning.refused, "The host refuses a delete while a turn runs.");
  await shot("7-running");
  await page.evaluate(({ agent, task }) => window.openbot.agent.stopTask({ agentId: agent, taskId: task }), {
    agent: agentId,
    task: task.id,
  });
  await waitForTask("the turn stops", (current) => current?.state === "idle");

  await page.reload();
  await tab(title).waitFor({ timeout: UI_WAIT_MS * 2 });
  report.reload = { tabKept: true, tabSelected: await selected(title) };

  await menuItem(await openTabMenu(title), english("common.delete")).click();
  await tab(title).waitFor({ state: "detached", timeout: UI_WAIT_MS });
  const toastText = page.getByText(english("conversation.threads.deleteUndo.title", { title }), { exact: true });
  await toastText.waitFor({ timeout: UI_WAIT_MS });
  const archivedDuringUndo = (await readTask())?.state === "closed";
  await shot("9-undo-toast");
  await button(english("conversation.threads.deleteUndo.action")).click();
  await tab(title).waitFor({ timeout: UI_WAIT_MS });
  await toastText.waitFor({ state: "detached", timeout: UI_WAIT_MS });
  const afterUndo = await waitForTask("the Undo restore", (current) => current?.state === "idle");
  report.undo = { toast: true, archivedDuringUndo, tabBack: true, state: afterUndo?.state ?? "missing" };
  assert.ok(archivedDuringUndo, "The delete archives the thread during its Undo time.");

  await menuItem(await openTabMenu(title), english("common.delete")).click();
  await toastText.waitFor({ timeout: UI_WAIT_MS });
  await waitForTask("the delete", (current) => current === undefined);
  deleted = true;
  report.deleted = { gone: true };
  await shot("10-deleted");

  const unsent = `Unsent ${crypto.randomUUID().slice(0, 4)}`;
  await page.evaluate((input) => window.openbot.agent.sendMessage({ ...input, clientMessageId: crypto.randomUUID() }), {
    agentId,
    text: LONG_PROMPT,
  });
  await button(english("conversation.threads.new")).first().click();
  const unsentComposer = page.getByRole("textbox", {
    name: english("conversation.threads.view.newPlaceholder", { name: agent.name }),
  });
  await unsentComposer.waitFor({ timeout: UI_WAIT_MS });
  await unsentComposer.fill(unsent);
  const typedDuringTurn = ownChatRuns(await listQueue());
  assert.ok(typedDuringTurn, "The agent's own chat runs a turn while the text is typed.");
  await waitFor(page, "the own chat's turn ends", listQueue, (snapshot) => !ownChatRuns(snapshot));
  const afterTurn = (await unsentComposer.innerText()).trim();
  await shot("11-unsent-after-turn");
  await button(english("conversation.header.mainChat")).click();
  await unsentComposer.waitFor({ state: "detached", timeout: UI_WAIT_MS });
  await tab(english("conversation.threads.new")).click();
  const afterSwitch = (await unsentComposer.innerText()).trim();
  await page.reload();
  await button(english("conversation.threads.new"))
    .first()
    .click({ timeout: UI_WAIT_MS * 2 });
  const afterReload = (await unsentComposer.innerText()).trim();
  report.unsentDraft = { typedDuringTurn, afterTurn, afterSwitch, afterReload };
  await unsentComposer.fill("");
  assert.equal(afterTurn, unsent, "The text stays when the own chat's turn ends.");
  assert.equal(afterSwitch, unsent, "The text stays after the agent's own chat opens.");
  assert.equal(afterReload, unsent, "The text stays after a reload.");

  const second = await page.evaluate(
    (input) => window.openbot.agent.startTask({ ...input, clientMessageId: crypto.randomUUID() }),
    { agentId, text: SHORT_PROMPT },
  );
  threadId = second.id;
  deleted = false;
  await waitForTask("the second thread's turn ends", (current) => current?.state === "idle");
  await button(english("conversation.threads.all")).click();
  await page
    .getByRole("menuitem", { name: new RegExp(literal(second.title)) })
    .first()
    .click();
  await tab(second.title).waitFor({ timeout: UI_WAIT_MS });
  await menuItem(await openTabMenu(second.title), english("common.delete")).click();
  await page
    .getByText(english("conversation.threads.deleteUndo.title", { title: second.title }), { exact: true })
    .waitFor({ timeout: UI_WAIT_MS });
  await waitForTask("the archive of the delete", (current) => current?.state === "closed");
  await page.reload();
  await button(english("conversation.threads.all"))
    .first()
    .waitFor({ timeout: UI_WAIT_MS * 2 });
  const hiddenAfterReload = (await tab(second.title).count()) === 0;
  await waitForTask("the delete after the reload", (current) => current === undefined);
  deleted = true;
  report.deleteAcrossReload = { taskId: second.id, hiddenAfterReload, gone: true };
  report.passed = true;
} finally {
  for (const delivery of (await listQueue().catch(() => null))?.deliveries ?? [])
    if (delivery.turnId && (delivery.status === "starting" || delivery.status === "running"))
      await page
        .evaluate((input) => window.openbot.agent.interrupt(input), { agentId, turnId: delivery.turnId })
        .catch(() => undefined);
  if (threadId && !deleted) {
    const id = threadId;
    await page
      .evaluate(({ agent, task }) => window.openbot.agent.stopTask({ agentId: agent, taskId: task }), {
        agent: agentId,
        task: id,
      })
      .catch(() => undefined);
    await waitForTask("the cleanup stop", (current) => current?.state !== "running").catch(() => undefined);
    await page
      .evaluate(({ agent, task }) => window.openbot.agent.deleteTask({ agentId: agent, taskId: task }), {
        agent: agentId,
        task: id,
      })
      .catch(() => undefined);
  }
  writeReport("agent-threads-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
