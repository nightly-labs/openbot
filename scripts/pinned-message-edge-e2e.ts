// Checks what a pin does when its message or thread goes away, in this worktree's dev app.
//
// Seed and start the app as `scripts/pinned-message-jump-e2e.ts` says, then run:
// `bun scripts/pinned-message-edge-e2e.ts --allow-mutations`
//
// It branches a small thread from the seeded one, and checks:
// 1. A deleted message leaves the pin list.
// 2. A pin of a thread whose delete waits for Undo does not open its tab, and opens again after Undo.
// 3. A deleted thread takes its pins out of the open pin list.
// 4. A thread that shows a part around an old message drops a message that another device deleted.
// The report goes to `.openbot-build/pinned-message-edge-e2e/report.json`.
import assert from "node:assert/strict";
import { translateFor } from "@openbot/i18n";
import { connectChannelE2e, writeReport } from "./channel-e2e-support";
import { readSeed, seedMessageId as seedId } from "./pinned-message-e2e-seed";

const NAME = "pinned-message-edge-e2e";
const UI_WAIT_MS = 15_000;
const english = translateFor("en");
const print = (line: string) => process.stdout.write(`${line}\n`);

interface Check {
  name: string;
  passed: boolean;
  detail: unknown;
}

assert.ok(process.argv.includes("--allow-mutations"), "This deletes messages and a thread. Pass --allow-mutations.");
const seed = readSeed();
const session = await connectChannelE2e(NAME);
const { page } = session;
const pageErrors: string[] = [];
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
const checks: Check[] = [];
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const pinsOf = (taskId: string) =>
  page.evaluate(
    async ({ agentId, taskId }) =>
      (await window.openbot.agent.listPinnedMessages(agentId)).pins
        .filter((pin) => pin.taskId === taskId)
        .map((pin) => pin.messageId),
    { agentId: seed.agentId, taskId },
  );
const setPinned = (taskId: string, messageId: string, pinned: boolean) =>
  page.evaluate((input) => window.openbot.agent.setMessagePinned(input), {
    agentId: seed.agentId,
    taskId,
    messageId,
    pinned,
  });
const toasts = () =>
  page.evaluate(() => [...document.querySelectorAll("[data-sonner-toast]")].map((toast) => toast.textContent ?? ""));
const clearToasts = () =>
  page.evaluate(() => {
    for (const toast of document.querySelectorAll("[data-sonner-toast]")) toast.remove();
  });
const tab = (taskId: string) => page.locator(`.agent-threads-tab[data-thread-id="${taskId}"]`);
const pinList = page.locator(".pinned-messages-list");
const pinEntry = (text: string) => pinList.locator(".pinned-messages-item", { hasText: text });
async function openPinList(): Promise<void> {
  if (await pinList.isVisible()) return;
  await page
    .getByRole("button", { name: english("chat.pins.title"), exact: true })
    .first()
    .click();
  await pinList.waitFor({ timeout: UI_WAIT_MS });
}
async function closePinList(): Promise<void> {
  if (!(await pinList.isVisible())) return;
  await page.keyboard.press("Escape");
  await pinList.waitFor({ state: "detached", timeout: UI_WAIT_MS });
}
/** Clicks a pin and waits until the jump ends: its message shows, or the "did not open" toast does. */
async function clickPin(text: string, messageId: string): Promise<"opened" | "missing"> {
  await openPinList();
  await pinEntry(text).locator(".pinned-messages-jump").click();
  const missing = page.locator("[data-sonner-toast]", { hasText: english("chat.pins.missing") });
  const row = page.locator(`[data-chat-search-message="${messageId}"]`);
  return Promise.race([
    missing.waitFor({ timeout: UI_WAIT_MS }).then(() => "missing" as const),
    row.waitFor({ timeout: UI_WAIT_MS }).then(() => "opened" as const),
  ]);
}
function record(name: string, passed: boolean, detail: unknown): void {
  checks.push({ name, passed, detail });
  print(`${passed ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(detail)}`);
}

async function openAgent(): Promise<void> {
  await page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${literal(seed.agentName)}[,.]`) })
    .first()
    .click({ timeout: UI_WAIT_MS * 2 });
  await page
    .getByRole("button", { name: english("conversation.threads.new"), exact: true })
    .waitFor({ timeout: UI_WAIT_MS });
}

let branchId: string | null = null;
try {
  await page.bringToFront();
  const whatsNew = page.getByRole("dialog", { name: english("update.whatsNew.title") });
  if (await whatsNew.isVisible()) {
    await whatsNew.getByRole("button", { name: english("update.whatsNew.done") }).click();
    await whatsNew.waitFor({ state: "detached", timeout: UI_WAIT_MS });
  }
  await openAgent();

  // A small thread with copies of the first 22 seeded messages.
  const branch = await page.evaluate((input) => window.openbot.agent.branchTask(input), {
    agentId: seed.agentId,
    taskId: seed.taskId,
    messageId: seedId(21),
    requestId: crypto.randomUUID(),
  });
  branchId = branch.id;
  const branchMessages = await page.evaluate(
    async (input) => (await window.openbot.agent.readTask(input)).messages.map((message) => message.id),
    { agentId: seed.agentId, taskId: branch.id },
  );
  assert.ok(branchMessages.length >= 22, `The branch has ${branchMessages.length} messages.`);
  const [deletedPin, threadPin] = [branchMessages[7], branchMessages[9]];
  assert.ok(deletedPin && threadPin, "The branch has no message 7 or 9.");
  const deletedText = "Pin timing message 7.";
  const threadText = "Pin timing message 9.";

  // 1. A deleted message leaves the pin list.
  await setPinned(branch.id, deletedPin, true);
  await setPinned(branch.id, threadPin, true);
  await openPinList();
  await pinEntry(deletedText).waitFor({ timeout: UI_WAIT_MS });
  await page.evaluate((input) => window.openbot.agent.deleteConversationMessage(input), {
    agentId: seed.agentId,
    taskId: branch.id,
    messageId: deletedPin,
  });
  const listLeft = await pinEntry(deletedText)
    .waitFor({ state: "detached", timeout: UI_WAIT_MS })
    .then(() => true)
    .catch(() => false);
  const storedPins = await pinsOf(branch.id);
  record(
    "message delete: pin leaves the backend list and the open pin list",
    listLeft && !storedPins.includes(deletedPin),
    {
      listLeft,
      storedPins,
    },
  );

  // 2. A pin of a thread whose delete waits for Undo.
  const opened = await clickPin(threadText, threadPin);
  await tab(branch.id).waitFor({ timeout: UI_WAIT_MS });
  record("small thread: a pin opens its tab at the message", opened === "opened", { opened });
  await clearToasts();
  await tab(branch.id).click({ button: "right" });
  await page.getByRole("menuitem", { name: english("common.delete"), exact: true }).click();
  await tab(branch.id).waitFor({ state: "detached", timeout: UI_WAIT_MS });
  const undo = page.getByRole("button", { name: english("conversation.threads.deleteUndo.action"), exact: true });
  await undo.waitFor({ timeout: UI_WAIT_MS });
  const pending = await clickPin(threadText, threadPin);
  const tabsDuringUndo = await tab(branch.id).count();
  record(
    "delete waits for Undo: the pin shows the toast and opens no tab",
    pending === "missing" && tabsDuringUndo === 0,
    {
      pending,
      tabsDuringUndo,
      toasts: await toasts(),
    },
  );
  await undo.click();
  const archived = await page.evaluate(
    async ({ agentId, taskId }) =>
      (await window.openbot.agent.listTasks(agentId)).tasks.find((task) => task.id === taskId)?.state ?? null,
    { agentId: seed.agentId, taskId: branch.id },
  );
  await clearToasts();
  await closePinList();
  const afterUndo = await clickPin(threadText, threadPin);
  record("after Undo: the pin opens the thread again", afterUndo === "opened", { afterUndo, stateAfterUndo: archived });
  await clearToasts();

  // 3. A deleted thread takes its pins out of the open pin list.
  await openPinList();
  await pinEntry(threadText).waitFor({ timeout: UI_WAIT_MS });
  await page.evaluate((input) => window.openbot.agent.deleteTask(input), { agentId: seed.agentId, taskId: branch.id });
  branchId = null;
  const threadLeft = await pinEntry(threadText)
    .waitFor({ state: "detached", timeout: UI_WAIT_MS })
    .then(() => true)
    .catch(() => false);
  const threadPins = await pinsOf(branch.id);
  const tabLeft = (await tab(branch.id).count()) === 0;
  record(
    "thread delete: its pins leave both lists, and its tab closes",
    threadLeft && threadPins.length === 0 && tabLeft,
    {
      threadLeft,
      threadPins,
      tabLeft,
    },
  );
  await closePinList();

  // 4. A part around an old message drops a message that another device deleted.
  // The seeded thread starts closed and not read, as after a start of the app: the pin opens its tab.
  const anchor = seedId(30_000);
  await setPinned(seed.taskId, anchor, true);
  if ((await tab(seed.taskId).count()) > 0) {
    await tab(seed.taskId).locator(".agent-threads-tab-close").click();
    await tab(seed.taskId).waitFor({ state: "detached", timeout: UI_WAIT_MS });
  }
  await page.reload();
  await openAgent();
  const jumped = await clickPin("Pin timing message 30000.", anchor);
  // A message of the part after the pinned one. Each run deletes one more.
  const victim = await page.evaluate((anchorId) => {
    const ids = [...document.querySelectorAll<HTMLElement>("[data-chat-search-message]")].map(
      (row) => row.dataset.chatSearchMessage ?? "",
    );
    return ids[ids.indexOf(anchorId) + 5] ?? "";
  }, anchor);
  assert.ok(victim.startsWith("pin-timing-"), "The part has no seeded message after the pin.");
  const victimRow = page.locator(`[data-chat-search-message="${victim}"]`);
  const victimShown = await victimRow.count();
  // The thread reads its newest messages after the jump, to compare the next changes with them. This
  // read goes after it.
  await page.evaluate((input) => window.openbot.agent.readTask(input), { agentId: seed.agentId, taskId: seed.taskId });
  await page.evaluate((input) => window.openbot.agent.deleteConversationMessage(input), {
    agentId: seed.agentId,
    taskId: seed.taskId,
    messageId: victim,
  });
  const victimLeft = await victimRow
    .waitFor({ state: "detached", timeout: UI_WAIT_MS })
    .then(() => true)
    .catch(() => false);
  const anchorStays = (await page.locator(`[data-chat-search-message="${anchor}"]`).count()) === 1;
  record(
    "delete on another device: the part around an old message reads again",
    jumped === "opened" && victimShown === 1 && victimLeft && anchorStays,
    { jumped, victimShown, victimLeft, anchorStays },
  );
  await setPinned(seed.taskId, anchor, false);

  const stray = (await toasts()).filter((text) => !text.includes(english("chat.pins.missing")));
  const passed = checks.every((check) => check.passed) && pageErrors.length === 0;
  const path = writeReport(NAME, { seed, checks, strayToasts: stray, pageErrors, passed });
  print(`Report: ${path}`);
  assert.ok(passed, "An edge case failed. See the report.");
} finally {
  if (branchId) {
    await page
      .evaluate((input) => window.openbot.agent.deleteTask(input), { agentId: seed.agentId, taskId: branchId })
      .catch(() => undefined);
  }
  await session.close();
}
