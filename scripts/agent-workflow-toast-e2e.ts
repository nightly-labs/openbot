import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { translateFor } from "@openbot/i18n";
import { argument, connectChannelE2e, WAIT_MS, waitFor, writeReport } from "./channel-e2e-support";

const NAME = "agent-workflow-toast-e2e";
const OUT = resolve(import.meta.dirname, `../.openbot-build/${NAME}`);
const UI_WAIT_MS = 15_000;
const english = translateFor("en");
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

mkdirSync(OUT, { recursive: true });
const session = await connectChannelE2e(NAME);
const { page } = session;
const pageErrors: string[] = [];
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
const title = `Toast check ${crypto.randomUUID().slice(0, 6)}`;
interface Report {
  title: string;
  pageErrors: string[];
  screenshots: string[];
  agent?: string;
  toastText?: string;
  workflowId?: string;
  workflowsOpenWhenToastShown?: boolean;
  openedWorkflowId?: string | null;
  passed?: boolean;
}
const report: Report = { title, pageErrors, screenshots: [] };
let createdId: string | undefined;

const shot = async (label: string) => {
  const path = resolve(OUT, `${label}.png`);
  await page.screenshot({ path });
  report.screenshots.push(path);
};

try {
  await page.bringToFront();
  const whatsNew = page.getByRole("dialog", { name: english("update.whatsNew.title") });
  if (await whatsNew.isVisible()) {
    await whatsNew.getByRole("button", { name: english("update.whatsNew.done") }).click();
    await whatsNew.waitFor({ state: "detached", timeout: UI_WAIT_MS });
  }

  const server = await page.evaluate(async () => (await window.openbot.servers.list()).find((entry) => entry.active));
  assert.ok(server, "No active server.");
  assert.notEqual(server.kind, "remote", "Select a local server: a joined server sends no agent id.");
  const agents = await page.evaluate(() => window.openbot.agent.listAgents());
  const wanted = argument("agent");
  const agent = wanted ? agents.find((entry) => entry.name === wanted) : agents[0];
  assert.ok(agent, wanted ? `No agent named ${wanted}.` : "The server has no agent.");
  report.agent = agent.name;
  const before = new Set((await page.evaluate(() => window.openbot.workflows.list())).map((entry) => entry.id));

  await page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${literal(agent.name)}[,.]`) })
    .first()
    .click({ timeout: UI_WAIT_MS });
  const composer = page.getByRole("textbox", {
    name: english("composer.placeholder.message", { name: agent.name }),
  });
  await composer.click({ timeout: UI_WAIT_MS });
  await page.keyboard.insertText(
    `Call the openbot edit_workflow tool one time, with no workflowId, with the title "${title}" and no ops. Call no other tool. Then reply with the word done.`,
  );
  await page.keyboard.press("Enter");

  const toast = page.locator("[data-sonner-toast]").filter({ hasText: title });
  await toast.waitFor({ timeout: WAIT_MS });
  const toastText = (await toast.textContent()) ?? "";
  report.toastText = toastText;
  assert.ok(
    toastText.includes(english("workflow.agentMade.title", { agent: agent.name })),
    "The toast names no agent.",
  );
  const made = (await page.evaluate(() => window.openbot.workflows.list())).find(
    (entry) => !before.has(entry.id) && entry.title === title,
  );
  assert.ok(made, "The agent did not make the workflow.");
  createdId = made.id;
  report.workflowId = made.id;
  report.workflowsOpenWhenToastShown = await page
    .getByRole("button", { name: english("workflow.canvas.switcher.all") })
    .isVisible();
  assert.equal(report.workflowsOpenWhenToastShown, false, "The Workflows page was open when the toast showed.");
  await shot("toast");

  await toast.getByRole("button", { name: english("workflow.agentMade.open"), exact: true }).click();
  const opened = await waitFor(
    page,
    "the Workflows page opens the agent's workflow",
    () => page.evaluate((serverId) => window.localStorage.getItem(`openbot:last-workflow:${serverId}`), server.id),
    (value) => value === made.id,
    UI_WAIT_MS * 2,
  );
  report.openedWorkflowId = opened;
  await page.getByRole("button", { name: english("workflow.canvas.switcher.all") }).waitFor({ timeout: UI_WAIT_MS });
  await shot("opened");
  report.passed = true;
} finally {
  if (createdId !== undefined) {
    const id = createdId;
    await page.evaluate((workflowId) => window.openbot.workflows.delete(workflowId), id).catch(() => undefined);
  }
  const path = writeReport(NAME, report);
  process.stdout.write(`Report: ${path}\n`);
  await session.close();
}
