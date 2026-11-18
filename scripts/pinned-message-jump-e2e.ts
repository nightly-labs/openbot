// Measures the time from a click on a pin to the pinned message in view, in this worktree's dev app.
//
// 1. Stop the app (`bun run dev:stop`), then seed a side thread of 50,000 messages:
//    `bun scripts/pinned-message-jump-e2e.ts --seed --profile=<userData of this worktree's dev profile>`
// 2. Start the app (`bun run dev`), then measure:
//    `bun scripts/pinned-message-jump-e2e.ts --allow-mutations`
//
// The measure step pins messages of the seeded thread through the preload bridge, opens the pin list
// of the agent's main chat, and clicks each pin. In the renderer, it records the time to the row in
// the DOM, to the row in view, to the flash, and to a still scroll position. The report and one
// screenshot for each case go to `.openbot-build/pinned-message-jump-e2e/`.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { argument, connectChannelE2e, writeReport } from "./channel-e2e-support";
import { seedMessageId as messageId, readSeed, SEED_FILE, type Seed } from "./pinned-message-e2e-seed";

const NAME = "pinned-message-jump-e2e";
const OUT = resolve(import.meta.dirname, `../.openbot-build/${NAME}`);
const MESSAGE_COUNT = 50_000;
const THREAD_TITLE = "Pin timing 50k";
const UI_WAIT_MS = 15_000;
const english = translateFor("en");
const print = (line: string) => process.stdout.write(`${line}\n`);

const FILLER = "The team checked the release plan, the open questions, and the next steps for each owner. ".repeat(6);

interface Case {
  name: string;
  index: number;
  /** What the view holds before the click. */
  before: string;
}

const CASES: Case[] = [
  { name: "oldest, thread not open", index: 0, before: "main chat; the thread tab is not open" },
  { name: "middle", index: 25_000, before: "thread open at the oldest messages" },
  { name: "near, already loaded", index: 25_030, before: "thread open at the middle" },
  { name: "recent, outside the loaded part", index: 49_700, before: "thread open at the middle" },
  { name: "latest message", index: MESSAGE_COUNT - 1, before: "thread open near the end" },
];

mkdirSync(OUT, { recursive: true });
if (process.argv.includes("--seed")) await seed();
else await measure();

async function seed(): Promise<void> {
  const profile = argument("profile");
  assert.ok(profile && existsSync(profile), "Pass --profile=<userData of this worktree's dev profile>.");
  const { isDevelopmentProfileActive } = await import("./seed-dev-state");
  assert.equal(await isDevelopmentProfileActive(profile), false, "Stop the app first: bun run dev:stop");
  const { OpenBotDatabase } = await import("../src/backend/openbot-database");
  const { AgentThreadStore } = await import("../src/backend/agent-threads/agent-thread-store");
  const { runCauseEffect } = await import("../src/backend/effect-boundary");
  const database = new OpenBotDatabase(profile);
  await runCauseEffect(database.initialize());
  try {
    const agent = database.listAgents()[0];
    assert.ok(agent, "The profile has no agent.");
    const thread = new AgentThreadStore(database).create({
      agentId: agent.id,
      origin: "user",
      title: THREAD_TITLE,
      titleSource: "auto",
    });
    const start = Date.now() - (MESSAGE_COUNT + 60) * 60_000;
    const messages: ConversationMessage[] = [];
    for (let index = 0; index < MESSAGE_COUNT; index += 1) {
      // One request, then four replies.
      const author = index % 5 === 0 ? "user" : "assistant";
      messages.push({
        id: messageId(index),
        author,
        source: author,
        text: `Pin timing message ${index}. ${FILLER}`,
        createdAt: new Date(start + index * 60_000).toISOString(),
        status: "completed",
      });
    }
    database.persistConversation(
      { agentId: agent.id, threadId: thread.threadId, activeTurnId: null, revision: 0, messages },
      "dev-seed.created",
      { pinTiming: true },
      `dev-seed:pin-timing:${thread.threadId}`,
    );
    const result: Seed = { agentId: agent.id, agentName: agent.name, taskId: thread.taskId, count: MESSAGE_COUNT };
    writeFileSync(SEED_FILE, `${JSON.stringify(result, null, 2)}\n`);
    print(`Seeded ${MESSAGE_COUNT} messages in "${THREAD_TITLE}" of ${agent.name}.`);
  } finally {
    database.close();
  }
}

interface Timing {
  /** Milliseconds from the click. Null when the step did not occur in the wait time. */
  rowInDom: number | null;
  rowInView: number | null;
  flash: number | null;
  /** The row is in view and the scroll position did not change for 5 frames. */
  settled: number | null;
  /** Messages in the thread view after the jump. */
  rows: number;
}

async function measure(): Promise<void> {
  const seedData = readSeed();
  const session = await connectChannelE2e(NAME);
  const { page } = session;
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  const results: Array<Case & { messageId: string; timing: Timing; toasts: string[]; screenshot: string }> = [];
  /** The toasts on screen. A toast after a jump is a failure, so each one is in the report. */
  const toasts = () =>
    page.evaluate(() => [...document.querySelectorAll("[data-sonner-toast]")].map((toast) => toast.textContent ?? ""));
  const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  try {
    await page.bringToFront();
    const whatsNew = page.getByRole("dialog", { name: english("update.whatsNew.title") });
    if (await whatsNew.isVisible()) {
      await whatsNew.getByRole("button", { name: english("update.whatsNew.done") }).click();
      await whatsNew.waitFor({ state: "detached", timeout: UI_WAIT_MS });
    }
    // The pins: unpin old ones of this thread, then pin each case.
    await page.evaluate(
      async ({ agentId, taskId, ids }) => {
        const snapshot = await window.openbot.agent.listPinnedMessages(agentId);
        for (const pin of snapshot.pins) {
          if (pin.taskId === taskId && !ids.includes(pin.messageId)) {
            await window.openbot.agent.setMessagePinned({ agentId, taskId, messageId: pin.messageId, pinned: false });
          }
        }
        for (const id of ids) {
          await window.openbot.agent.setMessagePinned({ agentId, taskId, messageId: id, pinned: true });
        }
      },
      { agentId: seedData.agentId, taskId: seedData.taskId, ids: CASES.map((item) => messageId(item.index)) },
    );
    const openAgent = () =>
      page
        .getByRole("navigation", { name: english("sidebar.nav.label") })
        .getByRole("button", { name: new RegExp(`^${literal(seedData.agentName)}[,.]`) })
        .first()
        .click({ timeout: UI_WAIT_MS * 2 });
    await openAgent();
    // A cold start: the thread tab is closed, and a reload drops the loaded messages.
    const tab = page.locator(`.agent-threads-tab[data-thread-id="${seedData.taskId}"]`);
    if ((await tab.count()) > 0) {
      await tab.locator(".agent-threads-tab-close").click();
      await tab.waitFor({ state: "detached", timeout: UI_WAIT_MS });
    }
    await page.reload();
    await openAgent();
    await page
      .getByRole("button", { name: english("conversation.threads.new"), exact: true })
      .waitFor({ timeout: UI_WAIT_MS });

    for (const item of CASES) {
      const id = messageId(item.index);
      await page
        .getByRole("button", { name: english("chat.pins.title"), exact: true })
        .first()
        .click();
      const list = page.locator(".pinned-messages-list");
      await list.waitFor({ timeout: UI_WAIT_MS });
      const entry = list.locator(".pinned-messages-item", { hasText: `Pin timing message ${item.index}.` });
      await entry.waitFor({ timeout: UI_WAIT_MS });
      await entry.locator(".pinned-messages-jump").evaluate((element) => element.setAttribute("data-pin-timing", ""));
      const timing = await page.evaluate(
        ({ id, waitMs }) =>
          new Promise<Timing>((done) => {
            const jump = document.querySelector<HTMLElement>("[data-pin-timing]");
            if (!jump) throw new Error("The pin button is gone.");
            const result: Timing = { rowInDom: null, rowInView: null, flash: null, settled: null, rows: 0 };
            let lastTop = Number.NaN;
            let still = 0;
            let stillSince = 0;
            const start = performance.now();
            const frame = () => {
              const now = performance.now() - start;
              const row = document.querySelector<HTMLElement>(`[data-chat-search-message="${id}"]`);
              const scroller = row?.closest<HTMLElement>(".conversation-scroll") ?? null;
              if (row && result.rowInDom === null) result.rowInDom = now;
              if (row && scroller) {
                const box = row.getBoundingClientRect();
                const view = scroller.getBoundingClientRect();
                const inView = box.bottom > view.top + 8 && box.top < view.bottom - 8;
                if (inView && result.rowInView === null) result.rowInView = now;
                const flashing = row.closest("[data-reply-flash]") ?? row.querySelector("[data-reply-flash]");
                if (flashing && result.flash === null) result.flash = now;
                if (inView && scroller.scrollTop === lastTop) still += 1;
                else {
                  still = 0;
                  stillSince = now;
                }
                lastTop = scroller.scrollTop;
                if (still >= 5 && result.settled === null) result.settled = stillSince;
                result.rows = scroller.querySelectorAll("[data-chat-search-message]").length;
              }
              const finished = result.settled !== null && result.flash !== null;
              if (finished || now > waitMs) done(result);
              else requestAnimationFrame(frame);
            };
            jump.click();
            requestAnimationFrame(frame);
          }),
        { id, waitMs: UI_WAIT_MS },
      );
      const screenshot = resolve(OUT, `${item.name.replace(/[^a-z0-9]+/gi, "-")}.png`);
      await page.screenshot({ path: screenshot });
      // The jump ends after the row shows. The next reads of the pin list wait for it.
      await page.evaluate(() => window.openbot.agent.listAgents());
      const shown = await toasts();
      results.push({ ...item, messageId: id, timing, toasts: shown, screenshot });
      print(`${item.name}: ${JSON.stringify(timing)} toasts=${JSON.stringify(shown)}`);
      if (shown.length > 0) {
        await page.evaluate(() => {
          for (const toast of document.querySelectorAll("[data-sonner-toast]")) toast.remove();
        });
      }
    }

    const passed =
      results.every(
        (result) => result.timing.rowInView !== null && result.timing.flash !== null && result.toasts.length === 0,
      ) && pageErrors.length === 0;
    const path = writeReport(NAME, {
      seed: seedData,
      device: "dev app on this computer, local database",
      results,
      pageErrors,
      passed,
    });
    print(`Report: ${path}`);
    assert.ok(passed, "A pin did not show its message. See the report.");
  } finally {
    await session.close();
  }
}
