// Checks the Tasks page in this worktree's running dev app. It starts one task with a short real
// provider turn, so start the app with `bun run dev` (never `--shared`), and pass an agent whose provider
// is signed in: `bun scripts/tasks-page-e2e.ts --allow-mutations --agent=<agent id>`.
//
// It opens the page from the page rail, starts the task from the page composer, and opens it from the
// Undo line. After the turn it checks that the task is in Needs you, that the panel shows the answer,
// and that a follow-up from the panel runs a second turn. Then Archive moves the task to Archived,
// Restore moves it back, Escape closes the panel, and Open in chat opens the task as a thread tab.
// At the end it deletes the task. Writes .openbot-build/tasks-page-e2e/report.json and screenshots.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentTask } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { argument, connectChannelE2e, waitFor, writeReport } from "./channel-e2e-support";

const NAME = "tasks-page-e2e";
const OUT = resolve(import.meta.dirname, `../.openbot-build/${NAME}`);
mkdirSync(OUT, { recursive: true });
const UI_WAIT_MS = 15_000;
const english = translateFor("en");
const agentArgument = argument("agent");
assert.ok(agentArgument, "Pass --agent=<agent id> of an agent whose provider is signed in.");
const agentId: string = agentArgument;
const tag = `e2e-${crypto.randomUUID().slice(0, 8)}`;
const PROMPT = `Reply with the single word ready (${tag}). Do not use tools.`;
const FOLLOW_UP = "Reply with the single word again. Do not use tools.";

interface Report {
  agentId: string;
  tag: string;
  taskId?: string;
  steps: string[];
  screenshots: string[];
  pageErrors: string[];
  passed: boolean;
  error?: string;
}

const report: Report = { agentId, tag, steps: [], screenshots: [], pageErrors: [], passed: false };
const session = await connectChannelE2e(NAME);
const { page } = session;
page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
let taskId: string | null = null;

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const button = (name: string) => page.getByRole("button", { name, exact: true });
const tasksPage = page.locator(".tasks-page");
const SECTIONS = {
  needsYou: english("conversation.tasks.section.needsYou"),
  archived: english("conversation.threads.archived"),
};
const section = (id: keyof typeof SECTIONS) =>
  tasksPage.getByRole("region", { name: new RegExp(`^${literal(SECTIONS[id])}`) });
const row = (scope: ReturnType<typeof section>) => scope.getByRole("button", { name: new RegExp(literal(tag)) });

async function step(label: string, action: () => Promise<void>): Promise<void> {
  await action();
  report.steps.push(label);
}

async function screenshot(name: string): Promise<void> {
  const path = resolve(OUT, `${name}.png`);
  await page.screenshot({ path });
  report.screenshots.push(path);
}

async function readTask(): Promise<AgentTask | undefined> {
  const snapshot = await page.evaluate((id) => window.openbot.agent.listTasks(id), agentId);
  return snapshot.tasks.find((task) => (taskId ? task.id === taskId : task.title.includes(tag)));
}

async function assistantReplies(): Promise<number> {
  const id = taskId;
  if (!id) return 0;
  const conversation = await page.evaluate((input) => window.openbot.agent.readTask(input), { agentId, taskId: id });
  return conversation.messages.filter((message) => message.author === "assistant" && message.status !== "streaming")
    .length;
}

const agent = await page.evaluate(async (id) => {
  const found = (await window.openbot.agent.listAgents()).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown agent: ${id}`);
  return { name: found.name };
}, agentId);

try {
  await page.bringToFront();
  const whatsNew = page.getByRole("dialog", { name: english("update.whatsNew.title") });
  if (await whatsNew.isVisible()) {
    await whatsNew.getByRole("button", { name: english("update.whatsNew.done") }).click();
    await whatsNew.waitFor({ state: "detached", timeout: UI_WAIT_MS });
  }

  await step("open the page from the rail", async () => {
    await button(english("app.rail.tasks")).first().click();
    await tasksPage.waitFor({ timeout: UI_WAIT_MS });
  });

  await step("start the task from the page composer", async () => {
    const chosen = english("conversation.tasks.page.agent", { name: agent.name });
    const chooser = tasksPage.getByRole("button", {
      name: new RegExp(`^${literal(english("conversation.tasks.page.agent", { name: "" }))}`),
    });
    if ((await chooser.getAttribute("aria-label")) !== chosen) {
      await chooser.click();
      await page.getByRole("menuitemradio", { name: agent.name, exact: true }).click();
      await button(chosen).waitFor({ timeout: UI_WAIT_MS });
    }
    await tasksPage.locator(".tasks-page-composer").getByRole("textbox").first().click();
    await page.keyboard.insertText(PROMPT);
    await button(english("conversation.tasks.page.start")).click();
    // The Undo line names the task; Open starts it at once and opens its panel.
    await tasksPage.getByRole("button", { name: english("conversation.tasks.page.undo"), exact: true }).waitFor({
      timeout: UI_WAIT_MS,
    });
    await screenshot("1-undo-line");
    await tasksPage.getByRole("button", { name: english("common.open"), exact: true }).click();
    const started = await waitFor(
      page,
      "the task reaches the host",
      readTask,
      (task) => task !== undefined,
      UI_WAIT_MS,
    );
    assert.ok(started);
    taskId = started.id;
    report.taskId = started.id;
  });

  const panel = page.getByRole("complementary", { name: /^Task / });
  await step("the panel shows the answer and the task moves to Needs you", async () => {
    await panel.waitFor({ timeout: UI_WAIT_MS });
    await waitFor(page, "the first turn ends", readTask, (task) => task?.state === "idle" && task.outcome !== null);
    await row(section("needsYou")).waitFor({ timeout: UI_WAIT_MS });
    await panel.getByText(/ready/i).last().waitFor({ timeout: UI_WAIT_MS });
    await screenshot("2-needs-you-panel");
  });

  await step("a follow-up from the panel runs a second turn", async () => {
    const before = await assistantReplies();
    await panel.getByRole("textbox").first().click();
    await page.keyboard.insertText(FOLLOW_UP);
    await panel.getByRole("button", { name: english("composer.send.message"), exact: true }).click();
    await waitFor(page, "the second answer", assistantReplies, (count) => count > before);
    await waitFor(page, "the second turn ends", readTask, (task) => task?.state === "idle");
    await panel.getByText(FOLLOW_UP, { exact: true }).waitFor({ timeout: UI_WAIT_MS });
  });

  await step("Archive moves the task to Archived, and Restore moves it back", async () => {
    await panel.getByRole("button", { name: english("conversation.threads.archive"), exact: true }).click();
    await row(section("archived")).waitFor({ timeout: UI_WAIT_MS });
    const restore = panel.getByRole("button", { name: english("conversation.threads.restore"), exact: true });
    await restore.waitFor({ timeout: UI_WAIT_MS });
    await screenshot("3-archived");
    await restore.click();
    await row(section("needsYou")).waitFor({ timeout: UI_WAIT_MS });
    await panel.getByRole("button", { name: english("conversation.threads.archive"), exact: true }).waitFor({
      timeout: UI_WAIT_MS,
    });
  });

  await step("Escape closes the panel, and the row opens it again", async () => {
    await panel.getByRole("heading").first().click();
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached", timeout: UI_WAIT_MS });
    await row(section("needsYou")).click();
    await panel.waitFor({ timeout: UI_WAIT_MS });
  });

  await step("Open in chat opens the task as a thread tab", async () => {
    await panel.getByRole("button", { name: english("conversation.tasks.panel.openInChat"), exact: true }).click();
    await tasksPage.waitFor({ state: "detached", timeout: UI_WAIT_MS });
    const title = (await readTask())?.title ?? "";
    await page
      .getByRole("tablist", { name: english("conversation.threads.open") })
      .getByRole("tab", { name: new RegExp(`^${literal(title)}`), selected: true })
      .waitFor({ timeout: UI_WAIT_MS });
    await screenshot("4-open-in-chat");
  });

  assert.deepEqual(report.pageErrors, [], "The renderer threw.");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  await screenshot("failure").catch(() => undefined);
} finally {
  const id = taskId ?? (await readTask().catch(() => undefined))?.id;
  if (id) {
    await page
      .evaluate((input) => window.openbot.agent.stopTask(input), { agentId, taskId: id })
      .catch(() => undefined);
    await waitFor(page, "the cleanup stop", readTask, (current) => current?.state !== "running").catch(() => undefined);
    await page
      .evaluate((input) => window.openbot.agent.deleteTask(input), { agentId, taskId: id })
      .catch(() => undefined);
  }
  writeReport(NAME, report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
