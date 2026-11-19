import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { translateFor } from "@openbot/i18n";
import { argument, connectChannelE2e, SHORT_PROMPT, waitFor, writeReport } from "./channel-e2e-support";

const NAME = "composer-thread-search-e2e";
const OUT = resolve(import.meta.dirname, `../.openbot-build/${NAME}`);
mkdirSync(OUT, { recursive: true });
const UI_WAIT_MS = 15_000;
const english = translateFor("en");

interface PickerRow {
  section: string;
  name: string;
  description: string;
}

interface Report {
  agentId?: string;
  word?: string;
  threads: { id: string; title: string }[];
  shortQuery?: { sections: string[] };
  fullQuery?: { rows: PickerRow[] };
  picked?: { draft: string };
  pageErrors: string[];
  screenshots: string[];
  passed: boolean;
}

const report: Report = { threads: [], pageErrors: [], screenshots: [], passed: false };
const session = await connectChannelE2e(NAME);
const { page } = session;
page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const messagesSection = english("composer.picker.section.messages");
const threadsSection = english("composer.picker.section.threads");
const picker = () => page.getByRole("listbox", { name: english("composer.picker.mentionLabel") });

async function shot(label: string): Promise<void> {
  const path = resolve(OUT, `${label}.png`);
  await page.screenshot({ path });
  report.screenshots.push(path);
}

function pickerRows(): Promise<PickerRow[]> {
  return picker().evaluate((list) => {
    const rows: PickerRow[] = [];
    let section = "";
    for (const element of list.querySelectorAll(".mention-picker-section, [role=option]")) {
      if (element.getAttribute("role") !== "option") {
        section = element.firstElementChild?.textContent ?? "";
        continue;
      }
      const description = element.querySelector(".mention-picker-description")?.textContent ?? "";
      rows.push({ section, name: element.getAttribute("aria-label") ?? "", description });
    }
    return rows;
  });
}

function pickerSections(): Promise<string[]> {
  return picker().evaluate((list) =>
    [...list.querySelectorAll(".mention-picker-section")].map(
      (section) => section.firstElementChild?.textContent ?? "",
    ),
  );
}

const agent = await page.evaluate(async (id) => {
  const agents = await window.openbot.agent.listAgents();
  const found = id ? agents.find((candidate) => candidate.id === id) : agents[0];
  if (!found) throw new Error(id ? `Unknown agent: ${id}` : "The profile has no agent.");
  return { id: found.id, name: found.name };
}, argument("agent") ?? null);
report.agentId = agent.id;
const word = `zephyr${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
report.word = word;

async function startThread(title: string): Promise<void> {
  const task = await page.evaluate((input) => window.openbot.agent.startTask(input), {
    agentId: agent.id,
    text: `${SHORT_PROMPT} The code word is ${word}.`,
  });
  report.threads.push({ id: task.id, title });
  await waitFor(
    page,
    `the first turn of ${title}`,
    () => page.evaluate((id) => window.openbot.agent.listTasks(id), agent.id),
    (snapshot) => snapshot.tasks.find((candidate) => candidate.id === task.id)?.state !== "running",
  );
  await page.evaluate((input) => window.openbot.agent.renameTask(input), {
    agentId: agent.id,
    taskId: task.id,
    title,
  });
}

try {
  await startThread("E2E search alpha");
  await startThread(`E2E search ${word}`);

  await page.bringToFront();
  await page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${literal(agent.name)}[,.]`) })
    .first()
    .click();
  const composer = page.getByRole("textbox", { name: english("composer.placeholder.message", { name: agent.name }) });
  await composer.waitFor({ timeout: UI_WAIT_MS });
  await composer.click();

  await composer.pressSequentially(`@${word.slice(0, 2)}`);
  await picker().waitFor({ timeout: UI_WAIT_MS });

  await composer.pressSequentially(word.slice(2));
  await picker().getByText(messagesSection, { exact: true }).waitFor({ timeout: UI_WAIT_MS });
  const rows = await pickerRows();
  report.fullQuery = { rows };
  await shot("in-messages");
  const threadName = (title: string) => english("composer.picker.option.thread", { name: title });
  const rowA = rows.filter((row) => row.name === threadName("E2E search alpha"));
  const rowB = rows.filter((row) => row.name === threadName(`E2E search ${word}`));
  assert.equal(rowA.length, 1, "Thread A must show once.");
  assert.equal(rowA[0]?.section, messagesSection);
  assert.ok(rowA[0]?.description.includes(word), "The A row must show the matched text.");
  assert.equal(rowB.length, 1, "Thread B must show once.");
  assert.equal(rowB[0]?.section, threadsSection);
  assert.ok(rows.filter((row) => row.section === messagesSection).length <= 5);

  for (let index = 2; index < word.length; index += 1) await composer.press("Backspace");
  await picker().getByText(messagesSection, { exact: true }).waitFor({ state: "detached", timeout: UI_WAIT_MS });
  report.shortQuery = { sections: await pickerSections() };
  await composer.pressSequentially(word.slice(2));
  await picker().getByText(messagesSection, { exact: true }).waitFor({ timeout: UI_WAIT_MS });

  await picker()
    .getByRole("option", { name: threadName("E2E search alpha") })
    .click();
  await picker().waitFor({ state: "hidden", timeout: UI_WAIT_MS });
  const draft = (await composer.textContent()) ?? "";
  report.picked = { draft };
  await shot("picked");
  assert.ok(draft.includes("E2E search alpha"), "The draft must hold the thread chip.");
  assert.ok(!draft.includes(word), "The typed query must be replaced.");
  report.passed = true;
} finally {
  await page
    .getByRole("textbox", { name: english("composer.placeholder.message", { name: agent.name }) })
    .fill("")
    .catch(() => undefined);
  for (const thread of report.threads) {
    await page
      .evaluate((input) => window.openbot.agent.stopTask(input), { agentId: agent.id, taskId: thread.id })
      .catch(() => undefined);
    await page
      .evaluate((input) => window.openbot.agent.deleteTask(input), { agentId: agent.id, taskId: thread.id })
      .catch(() => undefined);
  }
  writeReport(NAME, report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
