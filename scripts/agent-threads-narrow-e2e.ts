// Checks the thread controls of the chat header at three window sizes, in this worktree's running dev
// app. It starts one side thread with a short real provider turn, so start the app with `bun run dev`
// (never `--shared`), and pass an agent whose provider is signed in:
// `bun scripts/agent-threads-narrow-e2e.ts --allow-mutations --agent=<agent id>`.
//
// The main window cannot be narrower than 960 px, so the script sets the page size with CDP
// emulation, which also stands for a chat pane that a side panel makes narrow. At each size it checks
// which controls show (tabs; one button with the open thread; only the icon buttons) and that "New
// thread" and the thread list take a click, so no other control covers them. It records the space
// between "New thread" and the next header control, and the lines of the composer hint, with a
// screenshot; it does not assert layout. At the end it removes the emulation and deletes the thread.
// Writes .openbot-build/agent-threads-narrow-e2e/report.json and screenshots.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentTask } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { argument, connectChannelE2e, SHORT_PROMPT, waitFor, writeReport } from "./channel-e2e-support";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-threads-narrow-e2e");
mkdirSync(OUT, { recursive: true });
const UI_WAIT_MS = 15_000;
const english = translateFor("en");
const agentArgument = argument("agent");
assert.ok(agentArgument, "Pass --agent=<agent id> of an agent whose provider is signed in.");
const agentId: string = agentArgument;

type Mode = "tabs" | "compact" | "minimal";
const SIZES: Array<{ mode: Mode; width: number; height: number }> = [
  { mode: "tabs", width: 1200, height: 700 },
  { mode: "compact", width: 900, height: 560 },
  { mode: "minimal", width: 420, height: 700 },
];

interface SizeReport {
  mode: Mode;
  width: number;
  height: number;
  tabs: boolean;
  switcher: boolean;
  newThreadTakesClick: boolean;
  listTakesClick: boolean;
  /** Pixels between "New thread" and the next control of the header, or null with no next control. */
  gapAfterNewThread: number | null;
  placeholderLines: number | null;
  screenshot: string;
}

interface Report {
  agentId: string;
  taskId?: string;
  sizes: SizeReport[];
  pageErrors: string[];
  passed: boolean;
}

const report: Report = { agentId, sizes: [], pageErrors: [], passed: false };
const session = await connectChannelE2e("agent-threads-narrow-e2e");
const { page } = session;
page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
const cdp = await page.context().newCDPSession(page);
let taskId: string | null = null;

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const button = (name: string) => page.getByRole("button", { name, exact: true });

async function readTask(): Promise<AgentTask | undefined> {
  const snapshot = await page.evaluate((id) => window.openbot.agent.listTasks(id), agentId);
  return snapshot.tasks.find((task) => task.id === taskId);
}

/** Layout values for the report: the space after "New thread", and the lines of the composer hint. */
function measure(newThreadLabel: string): Promise<{ gap: number | null; lines: number | null }> {
  return page.evaluate((label) => {
    const plus = [...document.querySelectorAll<HTMLElement>(".conversation-header button")].find(
      (element) => element.getAttribute("aria-label") === label,
    );
    const group = plus?.closest<HTMLElement>(".conversation-heading-group");
    let next = group?.nextElementSibling ?? null;
    while (next && next.getBoundingClientRect().width === 0) next = next.nextElementSibling;
    const gap =
      plus && next ? Math.round(next.getBoundingClientRect().left - plus.getBoundingClientRect().right) : null;
    const hint = document.querySelector<HTMLElement>(".agent-thread-composer .composer-editor-placeholder");
    const lineHeight = hint ? Number.parseFloat(getComputedStyle(hint).lineHeight) : Number.NaN;
    const lines = hint && lineHeight > 0 ? Math.round(hint.getBoundingClientRect().height / lineHeight) : null;
    return { gap, lines };
  }, newThreadLabel);
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
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1200,
    height: 700,
    deviceScaleFactor: 0,
    mobile: false,
  });
  await page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${literal(agent.name)}[,.]`) })
    .first()
    .click();

  // A side thread, so the header has a thread row, with its tab open.
  const task = await page.evaluate(
    (input) => window.openbot.agent.startTask({ ...input, clientMessageId: crypto.randomUUID() }),
    { agentId, text: SHORT_PROMPT },
  );
  taskId = task.id;
  report.taskId = task.id;
  const idle = await waitFor(page, "the side thread's turn ends", readTask, (current) => current?.state === "idle");
  assert.ok(idle);
  await button(english("conversation.threads.all")).click();
  await page
    .getByRole("menuitem", { name: new RegExp(literal(idle.title)) })
    .first()
    .click();
  const tabs = page.getByRole("tablist", { name: english("conversation.threads.open") });
  await tabs.getByRole("tab", { name: new RegExp(`^${literal(idle.title)}`) }).waitFor({ timeout: UI_WAIT_MS });
  const switcher = button(english("conversation.threads.current", { title: idle.title }));

  for (const size of SIZES) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: size.width,
      height: size.height,
      deviceScaleFactor: 0,
      mobile: false,
    });
    if (size.mode === "tabs") await tabs.waitFor({ timeout: UI_WAIT_MS });
    else await tabs.waitFor({ state: "detached", timeout: UI_WAIT_MS });
    if (size.mode === "compact") await switcher.waitFor({ timeout: UI_WAIT_MS });
    else await switcher.waitFor({ state: "detached", timeout: UI_WAIT_MS });
    const list = size.mode === "compact" ? switcher : button(english("conversation.threads.all"));
    const takesClick = (target: typeof list) =>
      target
        .first()
        .click({ trial: true, timeout: UI_WAIT_MS })
        .then(() => true)
        .catch(() => false);
    const newThreadTakesClick = await takesClick(button(english("conversation.threads.new")));
    const listTakesClick = await takesClick(list);
    const { gap, lines } = await measure(english("conversation.threads.new"));
    const screenshot = resolve(OUT, `${size.mode}-${size.width}x${size.height}.png`);
    await page.screenshot({ path: screenshot });
    report.sizes.push({
      ...size,
      tabs: (await tabs.count()) > 0,
      switcher: (await switcher.count()) > 0,
      newThreadTakesClick,
      listTakesClick,
      gapAfterNewThread: gap,
      placeholderLines: lines,
      screenshot,
    });
    assert.ok(newThreadTakesClick, `"New thread" takes no click at ${size.width} px.`);
    assert.ok(listTakesClick, `The thread list takes no click at ${size.width} px.`);
  }
  report.passed = true;
} finally {
  await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
  if (taskId) {
    const id = taskId;
    await page
      .evaluate((input) => window.openbot.agent.stopTask(input), { agentId, taskId: id })
      .catch(() => undefined);
    await waitFor(page, "the cleanup stop", readTask, (current) => current?.state !== "running").catch(() => undefined);
    await page
      .evaluate((input) => window.openbot.agent.deleteTask(input), { agentId, taskId: id })
      .catch(() => undefined);
  }
  writeReport("agent-threads-narrow-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
