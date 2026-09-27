// Checks the agent plan block and the waiting block in a running Storybook, which renders the real
// conversation timeline and composer against the preview mock. Read-only. Pass the Storybook URL
// that `bun run storybook` reports: `bun scripts/task-plan-e2e.ts --storybook=http://localhost:6006`.
// It also checks the stack of panels above the input: each panel goes under the next one, the lower
// panel paints over the shared edge, and the top of each panel stays visible.
// Writes .openbot-build/task-plan-e2e/report.json and one screenshot per story.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { translateFor } from "@openbot/i18n";
import { chromium, type Page } from "playwright-core";

const OUT = resolve(import.meta.dirname, "../.openbot-build/task-plan-e2e");
const t = translateFor("en");
const storybook = process.argv.find((arg) => arg.startsWith("--storybook="))?.slice("--storybook=".length);
assert.ok(storybook, "Pass --storybook=<url> with the URL that `bun run storybook` reports.");

interface Report {
  waitingForReplies?: {
    planSteps: number;
    waitingRows: number;
    agentReplyInQueue: boolean;
    waitingAboveQueue: boolean;
  };
  planInProgress?: { expanded: boolean; done: number; total: number };
  awaitingStates?: string[];
  stacks?: Record<string, StackSeam[]>;
  passed: boolean;
}

const report: Report = { passed: false };

async function openStory(page: Page, id: string) {
  await page.goto(`${storybook}/iframe.html?id=${id}&viewMode=story`);
  await page.locator("#storybook-root").waitFor();
}

interface StackSeam {
  pair: string;
  overlap: number;
  lowerPaintsOver: boolean;
  upperTopVisible: boolean;
}

/** The seams between the panels above the input, from the top to the composer. */
async function composerStack(page: Page): Promise<StackSeam[]> {
  // The panels slide in once; the shimmer and spinner animations run forever.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity),
  );
  return page.evaluate(() => {
    const wrap = document.querySelector(".composer-wrap");
    if (!wrap) return [];
    const panels = [
      ...wrap.querySelectorAll(":scope > *, :scope > .agent-queue-slot > .agent-queue-slot-inner > *"),
    ].filter((node) => !node.classList.contains("agent-queue-slot") && node.getBoundingClientRect().height > 0);
    const label = (node: Element) => [...node.classList].find((name) => !name.startsWith("task-list")) ?? node.tagName;
    return panels.slice(1).flatMap((lower, index) => {
      const upper = panels[index];
      if (!upper) return [];
      const top = upper.getBoundingClientRect();
      const bottom = lower.getBoundingClientRect();
      const overlap = Math.round(top.bottom - bottom.top);
      const seam = document.elementFromPoint(bottom.left + 60, (top.bottom + bottom.top) / 2);
      const head = document.elementFromPoint(top.left + 40, top.top + 8);
      return [
        {
          pair: `${label(upper)} > ${label(lower)}`,
          overlap,
          lowerPaintsOver: overlap <= 0 || Boolean(seam && lower.contains(seam)),
          upperTopVisible: Boolean(head && upper.contains(head)),
        },
      ];
    });
  });
}

function header(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${title}`) });
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 860 } });

  // The agent asked Research and Sales Outbound. Research replied; its answer waits in the queue.
  await openStory(page, "conversation-conversation--waiting-for-replies");
  const plan = header(page, t("chat.taskList.title"));
  await plan.waitFor();
  assert.equal(await plan.count(), 1, "One plan turn gives one task list.");
  assert.match((await plan.textContent()) ?? "", /4 of 4 tasks done/u);
  assert.equal(await plan.getAttribute("aria-expanded"), "false", "A plan from an earlier turn starts closed.");
  await plan.click();
  assert.equal(await plan.getAttribute("aria-expanded"), "true");
  const planPanel = page.locator(`[id="${await plan.getAttribute("aria-controls")}"]`);
  assert.equal(await planPanel.getByRole("img", { name: t("chat.taskList.state.done") }).count(), 4);

  const waiting = header(page, t("chat.awaiting.title"));
  await waiting.waitFor();
  assert.match((await waiting.textContent()) ?? "", /1 of 2 replies in/u);
  const waitingBlock = page.locator("section").filter({ has: waiting });
  const research = waitingBlock.getByRole("listitem").filter({ hasText: "Research" });
  assert.match((await research.textContent()) ?? "", new RegExp(t("chat.awaiting.state.replied")));
  assert.match((await research.textContent()) ?? "", /All four sources check out/u);
  const sales = waitingBlock.getByRole("listitem").filter({ hasText: "Sales Outbound" });
  assert.match((await sales.textContent()) ?? "", new RegExp(t("chat.awaiting.state.working")));

  const queue = page.getByRole("region", { name: t("queue.label") });
  await queue.waitFor();
  assert.equal(await queue.getByText("All four sources check out", { exact: false }).count(), 0);
  const waitingAboveQueue = await waitingBlock.evaluate(
    (block, queueNode) =>
      Boolean(queueNode && block.compareDocumentPosition(queueNode) & Node.DOCUMENT_POSITION_FOLLOWING),
    await queue.elementHandle(),
  );
  assert.equal(waitingAboveQueue, true, "The waiting block is above the queue.");
  await page.screenshot({ path: resolve(OUT, "conversation-waiting.png") });
  report.waitingForReplies = { planSteps: 4, waitingRows: 2, agentReplyInQueue: false, waitingAboveQueue };

  // A plan in the running turn is open and names the step that runs.
  await openStory(page, "conversation-conversation--plan-in-progress");
  const live = header(page, t("chat.taskList.title"));
  await live.waitFor();
  assert.equal(await live.getAttribute("aria-expanded"), "true", "The plan of the running turn is open.");
  assert.match((await live.textContent()) ?? "", /1 of 3 tasks done/u);
  const livePanel = page.locator(`[id="${await live.getAttribute("aria-controls")}"]`);
  const active = livePanel
    .getByRole("listitem")
    .filter({ has: page.getByRole("img", { name: t("chat.taskList.state.active") }) });
  assert.match((await active.textContent()) ?? "", /Adding the column for the saved provider/u);
  await page.screenshot({ path: resolve(OUT, "conversation-plan-live.png") });
  report.planInProgress = { expanded: true, done: 1, total: 3 };

  // All four states of a waiting row, and the closed header that names the agent that works.
  await openStory(page, "conversation-awaiting-replies--waiting");
  const rows = page.getByRole("listitem");
  assert.equal(await rows.count(), 3);
  for (const [name, state] of [
    ["Research", "chat.awaiting.state.replied"],
    ["Sales Outbound", "chat.awaiting.state.working"],
    ["Support", "chat.awaiting.state.asked"],
  ] as const) {
    assert.match((await rows.filter({ hasText: name }).textContent()) ?? "", new RegExp(t(state)));
  }
  const opened = header(page, t("chat.awaiting.title"));
  // A closed header shows the agent that works in place of the title, so its name changes.
  const block = page.locator(`[aria-controls="${await opened.getAttribute("aria-controls")}"]`);
  await block.click();
  assert.equal(await block.getAttribute("aria-expanded"), "false");
  await page.getByText(t("chat.awaiting.working", { name: "Sales Outbound" })).waitFor();
  await openStory(page, "conversation-awaiting-replies--one-failed");
  assert.match(
    (await page.getByRole("listitem").first().textContent()) ?? "",
    new RegExp(t("chat.awaiting.state.failed")),
  );
  report.awaitingStates = ["replied", "working", "asked", "failed"];

  // Waiting + queue, waiting alone, waiting + notice, and a channel's waiting + stopped task.
  report.stacks = {};
  for (const id of [
    "conversation-conversation--waiting-for-replies",
    "conversation-conversation--plan-in-progress",
    "conversation-conversation--provider-sign-in-required",
    "conversation-channel-transcript--waiting-subtasks-above-stopped-task",
  ]) {
    await openStory(page, id);
    await page.locator(".composer-wrap .awaiting-replies").waitFor();
    const seams = await composerStack(page);
    assert.ok(seams.length > 0, `${id}: no panel above the input.`);
    for (const seam of seams) {
      assert.ok(seam.overlap > 0, `${id}: ${seam.pair} does not go under the next panel.`);
      assert.ok(seam.lowerPaintsOver, `${id}: ${seam.pair} covers the next panel.`);
      assert.ok(seam.upperTopVisible, `${id}: the top of ${seam.pair} is hidden.`);
    }
    await page.locator(".composer-wrap").screenshot({ path: resolve(OUT, `stack-${id.split("--")[1]}.png`) });
    report.stacks[id] = seams;
  }

  report.passed = true;
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  await browser.close();
}
