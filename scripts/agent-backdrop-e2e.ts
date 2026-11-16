// Checks that an agent sets and changes the window backdrop by itself, with real provider turns.
// Start the app with `bun run dev` (never `--shared`), then run
// `bun scripts/agent-backdrop-e2e.ts --allow-mutations`. It uses the first visible agent, or
// `--agent=<id>`.
//
// In the agent's own chat it asks the agent to call `set_backdrop`, and on the desktop it checks that:
// 1. the page shows behind the window, in the agent's one backdrop slot, with "Undo" in a notice;
// 2. "Undo" puts back the backdrop from before;
// 3. a second call replaces the page in the same slot, and the window shows the new page with its
//    bubble colors on the user's and the agent's bubbles; its "Undo" puts back the backdrop from before
//    the run and the bubble colors from before;
// 4. in a channel, the agent cannot set the backdrop.
// At the end it removes the agent's slot and the channel.
// Writes .openbot-build/agent-backdrop-e2e/report.json and screenshots.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { CHAT_BACKDROP_ITEM_TYPE } from "@openbot/contracts/chat-visual";
import { translateFor } from "@openbot/i18n";
import type { Page } from "playwright-core";
import { argument, ChannelClient, connectChannelE2e, queueBusy, waitFor, writeReport } from "./channel-e2e-support";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-backdrop-e2e");
const UI_WAIT_MS = 30_000;
const CHOICE_KEY = "openbot:chat-backdrop";
const DATABASE = "openbot-backdrops";
const STORE = "backdrops";
const CHANGED_CHANNEL = "openbot:custom-backdrops";

/** A full-frame page that names its scene in a hidden mark, so the check can tell the two apart. */
const scene = (mark: string, color: string) =>
  `<!doctype html><html><body style="margin:0;height:100vh;background:${color}"><div id="scene" data-scene="${mark}" hidden></div></body></html>`;
const FIRST = { title: "Teal field", mark: "one", html: scene("one", "teal") };
const BUBBLES = { yours: "#7c3aed", agents: "#f59e0b" };
const SECOND = { title: "Plum field", mark: "two", html: scene("two", "plum"), bubbles: BUBBLES };
const prompt = (page: { title: string; html: string; bubbles?: typeof BUBBLES }) =>
  `Call the openbot set_backdrop tool once with the title "${page.title}" and exactly this HTML, with no change: ${page.html} ${
    page.bubbles ? `Give it the bubbles ${JSON.stringify(page.bubbles)}.` : "Give it no bubbles."
  } Then reply with DONE only.`;
const english = translateFor("en");

interface SlotState {
  name: string;
  createdAt: number;
}

/** The chat rows that show each backdrop bubble color. */
interface BubbleCount {
  yours: number;
  agents: number;
}

interface Report {
  agent?: { id: string; provider: string; model: string };
  set?: { messageId: string; choice: string | null; slot: SlotState | null; scene: string; notice: boolean };
  undo?: { choice: string | null; frameGone: boolean };
  replace?: {
    messageId: string;
    choice: string | null;
    slot: SlotState | null;
    scene: string;
    slots: number;
    bubbles: BubbleCount;
  };
  restoredBubbles?: BubbleCount;
  channel?: { backdropMessages: number; choice: string | null };
  pageErrors: string[];
  screenshots: string[];
  passed: boolean;
}

const report: Report = { pageErrors: [], screenshots: [], passed: false };
const session = await connectChannelE2e("agent-backdrop-e2e");
const desktop = session.page;
desktop.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
const client = new ChannelClient(desktop);

const choice = (page: Page) => page.evaluate((key) => window.localStorage.getItem(key), CHOICE_KEY);

/** The saved backdrop of one slot, read from the store that the window uses. */
const slot = (page: Page, id: string): Promise<SlotState | null> =>
  page.evaluate(
    ({ database, store, id }) =>
      new Promise<SlotState | null>((done, fail) => {
        const open = indexedDB.open(database, 1);
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const read = open.result.transaction(store, "readonly").objectStore(store).get(id);
          read.onerror = () => fail(read.error);
          read.onsuccess = () => {
            open.result.close();
            const value = read.result;
            done(
              value && typeof value === "object" && "name" in value && "createdAt" in value
                ? { name: String(value.name), createdAt: Number(value.createdAt) }
                : null,
            );
          };
        };
      }),
    { database: DATABASE, store: STORE, id },
  );

const slotCount = (page: Page): Promise<number> =>
  page.evaluate(
    ({ database, store }) =>
      new Promise<number>((done, fail) => {
        const open = indexedDB.open(database, 1);
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const count = open.result.transaction(store, "readonly").objectStore(store).count();
          count.onerror = () => fail(count.error);
          count.onsuccess = () => {
            open.result.close();
            done(count.result);
          };
        };
      }),
    { database: DATABASE, store: STORE },
  );

/** Removes the slot and tells each window that the list changed. */
const removeSlot = (page: Page, id: string) =>
  page.evaluate(
    ({ database, store, channel, id }) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open(database, 1);
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const transaction = open.result.transaction(store, "readwrite");
          transaction.objectStore(store).delete(id);
          transaction.oncomplete = () => {
            open.result.close();
            const changed = new BroadcastChannel(channel);
            changed.postMessage("changed");
            changed.close();
            done();
          };
          transaction.onerror = () => fail(transaction.error);
        };
      }),
    { database: DATABASE, store: STORE, channel: CHANGED_CHANNEL, id },
  );

/** The backdrop frame behind the window, found by the page title. */
const backdropFrame = (page: Page, title: string) => page.locator(`iframe[title="${title}"]`);

/** The scene mark in the backdrop frame of `title`. */
const shownScene = async (page: Page, title: string): Promise<string> => {
  const mark = backdropFrame(page, title).contentFrame().locator("#scene");
  await mark.waitFor({ state: "attached", timeout: UI_WAIT_MS });
  return (await mark.getAttribute("data-scene")) ?? "";
};

const bubbleCount = (page: Page): Promise<BubbleCount> =>
  page.evaluate(({ yours, agents }) => {
    const rows = (color: string) => document.querySelectorAll(`[style*="--message-chat-color: ${color}"]`).length;
    return { yours: rows(yours), agents: rows(agents) };
  }, BUBBLES);

const undoButton = (page: Page) =>
  page.getByRole("button", { name: english("chat.backdrop.undo"), exact: true }).last();

async function shot(label: string): Promise<void> {
  const path = resolve(OUT, `${label}.png`);
  await desktop.screenshot({ path });
  report.screenshots.push(path);
}

/** Asks the agent in its own chat, and waits for the new backdrop message and the end of the turn. */
async function askOwnChat(agentId: string, text: string, label: string): Promise<string> {
  const before = new Set(
    (await desktop.evaluate((id) => window.openbot.agent.readConversation(id), agentId)).messages.map(
      (message) => message.id,
    ),
  );
  await client.sendToAgent(agentId, text);
  const conversation = await waitFor(
    desktop,
    label,
    () => desktop.evaluate((id) => window.openbot.agent.readConversation(id), agentId),
    (snapshot) =>
      snapshot.messages.some((message) => !before.has(message.id) && message.itemType === CHAT_BACKDROP_ITEM_TYPE),
  );
  await waitFor(
    desktop,
    `${label}: the turn ends`,
    () => client.queue(agentId),
    (queue) => !queueBusy(queue),
  );
  const message = conversation.messages.find(
    (candidate) => !before.has(candidate.id) && candidate.itemType === CHAT_BACKDROP_ITEM_TYPE,
  );
  assert.ok(message);
  return message.id;
}

let original: string | null = null;
let agentSlotId: string | null = null;
try {
  original = await choice(desktop);
  const agentId = argument("agent");
  const agents = await client.agents();
  const agent = agentId ? agents.find((candidate) => candidate.id === agentId) : agents[0];
  assert.ok(agent, agentId ? `No visible agent has the id ${agentId}.` : "This check needs one visible agent.");
  report.agent = { id: agent.id, provider: agent.provider, model: agent.model };
  agentSlotId = `agent-${agent.id}`;
  const expectedChoice = `custom:${agentSlotId}`;

  // 1. The agent sets the backdrop. The window shows it, and a notice offers "Undo".
  const firstId = await askOwnChat(agent.id, prompt(FIRST), "the first backdrop message shows");
  await waitFor(
    desktop,
    "the first backdrop is chosen",
    () => choice(desktop),
    (value) => value === expectedChoice,
    UI_WAIT_MS,
  );
  const firstScene = await shownScene(desktop, FIRST.title);
  const notice = await undoButton(desktop)
    .waitFor({ timeout: UI_WAIT_MS })
    .then(() => true)
    .catch(() => false);
  report.set = {
    messageId: firstId,
    choice: await choice(desktop),
    slot: await slot(desktop, agentSlotId),
    scene: firstScene,
    notice,
  };
  await shot("set");
  assert.equal(firstScene, FIRST.mark, "The window does not show the first page.");
  assert.equal(report.set.slot?.name, FIRST.title, "The agent's slot does not keep the first page.");
  assert.ok(notice, "No notice with Undo shows.");

  // 2. "Undo" puts back the backdrop from before.
  await undoButton(desktop).click();
  await waitFor(
    desktop,
    "Undo puts back the backdrop",
    () => choice(desktop),
    (value) => value === original,
    UI_WAIT_MS,
  );
  await backdropFrame(desktop, FIRST.title).waitFor({ state: "detached", timeout: UI_WAIT_MS });
  report.undo = { choice: await choice(desktop), frameGone: true };

  // 3. A second call replaces the page in the same slot.
  const slotsBefore = await slotCount(desktop);
  const secondId = await askOwnChat(agent.id, prompt(SECOND), "the second backdrop message shows");
  await waitFor(
    desktop,
    "the second backdrop is chosen",
    () => choice(desktop),
    (value) => value === expectedChoice,
    UI_WAIT_MS,
  );
  const secondScene = await shownScene(desktop, SECOND.title);
  const themed = await waitFor(
    desktop,
    "the bubbles take the backdrop colors",
    () => bubbleCount(desktop),
    (count) => count.yours > 0 && count.agents > 0,
    UI_WAIT_MS,
  );
  report.replace = {
    messageId: secondId,
    choice: await choice(desktop),
    slot: await slot(desktop, agentSlotId),
    scene: secondScene,
    slots: await slotCount(desktop),
    bubbles: themed,
  };
  await shot("replace");
  assert.notEqual(secondId, firstId);
  assert.equal(secondScene, SECOND.mark, "The window does not show the second page.");
  assert.equal(report.replace.slot?.name, SECOND.title, "The agent's slot does not keep the second page.");
  assert.ok(
    (report.replace.slot?.createdAt ?? 0) > (report.set.slot?.createdAt ?? 0),
    "The second page did not replace the first one.",
  );
  assert.equal(report.replace.slots, slotsBefore, "The second page added a slot.");
  // The Undo of this notice puts back the backdrop from before the run.
  await undoButton(desktop).click({ timeout: UI_WAIT_MS });
  await waitFor(
    desktop,
    "the second Undo puts back the backdrop",
    () => choice(desktop),
    (value) => value === original,
    UI_WAIT_MS,
  );
  report.restoredBubbles = await waitFor(
    desktop,
    "the bubbles lose the backdrop colors",
    () => bubbleCount(desktop),
    (count) => count.yours === 0 && count.agents === 0,
    UI_WAIT_MS,
  );

  // 4. In a channel, the agent cannot set the backdrop.
  const channel = await client.create(`E2E backdrop ${crypto.randomUUID().slice(0, 4)}`, [agent.id], agent.id);
  const before = (await client.read(channel.id)).tasks.length;
  await client.send(channel.id, prompt({ title: "Channel field", html: scene("channel", "olive") }), agent.id);
  const done = await waitFor(
    desktop,
    "the channel turn ends",
    () => client.read(channel.id),
    (page) => {
      const state = page.tasks.length > before ? page.tasks.at(-1)?.state : undefined;
      return state === "completed" || state === "failed" || state === "paused" || state === "cancelled";
    },
  );
  report.channel = {
    backdropMessages: done.messages.filter((message) => message.message.itemType === CHAT_BACKDROP_ITEM_TYPE).length,
    choice: await choice(desktop),
  };
  assert.equal(report.channel.backdropMessages, 0, "A channel turn set the backdrop.");
  assert.equal(report.channel.choice, original, "A channel turn changed the backdrop.");

  assert.deepEqual(report.pageErrors, []);
  report.passed = true;
} finally {
  await client.cleanup();
  // Puts back the backdrop from before with the Undo of the last notice, while it shows.
  if ((await choice(desktop).catch(() => original)) !== original)
    await undoButton(desktop)
      .click({ timeout: 2_000 })
      .catch(() => undefined);
  if (agentSlotId) await removeSlot(desktop, agentSlotId).catch(() => undefined);
  writeReport("agent-backdrop-e2e", report);
  await session.close();
}
