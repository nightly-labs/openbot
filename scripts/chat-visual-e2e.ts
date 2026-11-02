// Checks what a visual reply's page can do in the desktop app, with a real provider turn.
// Start the app with `bun run dev` (never `--shared`), then run
// `bun scripts/chat-visual-e2e.ts --allow-mutations`. It uses the first visible agent, or
// `--agent=<id>`. `--provider=<id>` moves that agent to a model of a signed-in provider for the run,
// and moves it back at the end.
//
// Through the desktop bridge it makes a channel and asks the agent to publish a page with a counter,
// an image, a "Pick B" button and a context button. Then, on the desktop, it checks that:
// 1. full screen and back keeps the counter, so the page does not load again;
// 2. a click on the image opens the image viewer;
// 3. "Pick B" puts its text in the composer, with no reply block, and sends nothing;
// 4. the context shows as a quote chip in the composer, and the sent message starts with it;
// 5. Cmd+K (Ctrl+K off macOS) in the page opens the global search.
// It deletes its channel at the end. Writes .openbot-build/chat-visual-e2e/report.json and screenshots.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { isAgentProvider } from "@openbot/contracts/agent-providers";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import type { FrameLocator, Locator, Page } from "playwright-core";
import { argument, ChannelClient, connectChannelE2e, WAIT_MS, waitFor, writeReport } from "./channel-e2e-support";

declare global {
  interface Window {
    /** The helper that the page gets from the app. */
    openbotPage?: { displayMode: "inline" | "fullscreen" };
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/chat-visual-e2e");
const UI_WAIT_MS = 30_000;
const TITLE = "Plan picker";
const PICK_TEXT = "I pick plan B.";
const CONTEXT_TEXT = "The counter shows 3.";
const PAGE = `<!doctype html><html><body>
<button id="count" type="button">Count: 0</button>
<button id="pick" type="button">Pick B</button>
<button id="context" type="button">Share count</button>
<img id="chart" alt="Chart" width="240" height="120">
<script>
let count = 0;
const canvas = document.createElement("canvas");
canvas.width = 240; canvas.height = 120;
const draw = canvas.getContext("2d");
draw.fillStyle = "gray"; draw.fillRect(20, 40, 60, 80); draw.fillRect(110, 10, 60, 110);
document.getElementById("chart").src = canvas.toDataURL("image/png");
document.getElementById("count").onclick = (event) => { count += 1; event.currentTarget.textContent = "Count: " + count; };
document.getElementById("pick").onclick = () => openbotPage.sendMessage(${JSON.stringify(PICK_TEXT)});
document.getElementById("context").onclick = () => openbotPage.setContext("The counter shows " + count + ".");
</script></body></html>`;
const VISUAL_PROMPT = `Call the html_render tool once with the title "${TITLE}" and exactly this HTML, with no change: ${PAGE} Then reply with DONE only.`;
const english = translateFor("en");
const shortcutModifier = process.platform === "darwin" ? "Meta" : "Control";

interface Report {
  agent?: { id: string; provider: string; model: string };
  channelId?: string;
  fullScreen?: { opened: boolean; countBefore: string; countAfter: string; closedWithEscape: boolean };
  imageViewer?: boolean;
  pick?: { composerText: string; replyingToPage: boolean; messagesBefore: number; messagesAfter: number };
  context?: { chip: boolean; sentText: string };
  globalSearch?: boolean;
  pageErrors: string[];
  screenshots: string[];
  passed: boolean;
}

const report: Report = { pageErrors: [], screenshots: [], passed: false };
const session = await connectChannelE2e("chat-visual-e2e");
const desktop = session.page;
desktop.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
const client = new ChannelClient(desktop);
let restore: AgentSummary | null = null;
const name = `E2E visual ${crypto.randomUUID().slice(0, 4)}`;

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const conversation = (page: Page) => page.getByRole("main", { name: english("conversation.view.label") });
const sidebarRow = (page: Page) =>
  page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${literal(name)}[,.]`) })
    .first();
const composer = (page: Page) => page.getByRole("textbox", { name: english("channel.composer.label") });

async function shot(label: string, target: Locator): Promise<void> {
  const path = resolve(OUT, `${label}.png`);
  await target.screenshot({ path });
  report.screenshots.push(path);
}

/**
 * Clicks an element of the page with a mouse event at the place where it shows. In the top layer,
 * Playwright places a frame's content at the frame's border box and misses by the frame's padding.
 */
async function clickInPage(frame: Locator, target: Locator): Promise<void> {
  const [x, y] = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return [rect.x + rect.width / 2, rect.y + rect.height / 2];
  });
  const [left, top] = await frame.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return [
      rect.x + element.clientLeft + Number.parseFloat(style.paddingLeft),
      rect.y + element.clientTop + Number.parseFloat(style.paddingTop),
    ];
  });
  await desktop.mouse.click(left + x, top + y);
}

/** Whether the page's box is in the top layer, as full screen puts it. */
const inFullScreen = (frame: Locator) =>
  frame.evaluate((element) => element.closest("[popover]")?.matches(":popover-open") === true);

/** Sends one request to the agent and waits until its task ends. */
async function ask(channelId: string, agentId: string, text: string, label: string) {
  const before = (await client.read(channelId)).tasks.length;
  await client.send(channelId, text, agentId);
  return waitFor(
    desktop,
    label,
    () => client.read(channelId),
    (channel) => {
      const state = channel.tasks.length > before ? channel.tasks.at(-1)?.state : undefined;
      return state === "completed" || state === "failed" || state === "paused" || state === "cancelled";
    },
  );
}

try {
  const agentId = argument("agent");
  const agents = await client.agents();
  let agent = agentId ? agents.find((candidate) => candidate.id === agentId) : agents[0];
  assert.ok(agent, agentId ? `No visible agent has the id ${agentId}.` : "This check needs one visible agent.");
  const providerId = argument("provider");
  if (providerId && providerId !== agent.provider) {
    const models = await desktop.evaluate(() => window.openbot.agent.listModels());
    const target = models.find((model) => model.provider === providerId);
    assert.ok(target && isAgentProvider(target.provider), `No model of ${providerId} is available. Sign in first.`);
    restore = agent;
    await client.update(agent.id, { provider: target.provider, model: target.id });
    agent = { ...agent, provider: target.provider, model: target.id };
  }
  report.agent = { id: agent.id, provider: agent.provider, model: agent.model };

  const channel = await client.create(name, [agent.id], agent.id);
  report.channelId = channel.id;
  const done = await ask(channel.id, agent.id, VISUAL_PROMPT, "the visual reply turn ends");
  assert.ok(
    done.messages.some((message) => message.message.itemType?.startsWith("visual-reply:")),
    `The channel has no visual reply: ${JSON.stringify(done.messages.map((message) => [message.message.itemType, message.message.text]))}`,
  );

  await sidebarRow(desktop).click();
  const frame = conversation(desktop).locator("iframe").first();
  await frame.waitFor({ timeout: UI_WAIT_MS });
  await frame.scrollIntoViewIfNeeded();
  const page: FrameLocator = frame.contentFrame();
  const counter = page.getByRole("button", { name: /^Count: / });
  await counter.waitFor({ timeout: UI_WAIT_MS });

  // 1. Full screen and back keeps the page state.
  await counter.click();
  await counter.click();
  const countBefore = await counter.innerText();
  await conversation(desktop)
    .getByRole("button", { name: english("chat.visual.fullScreen"), exact: true })
    .click();
  await waitFor(desktop, "the page goes full screen", () => inFullScreen(frame), Boolean, UI_WAIT_MS);
  // The page hears of full screen after the app, and then has the size of the full frame.
  await waitFor(
    desktop,
    "the page has the full-screen size",
    () =>
      counter.evaluate(() => {
        return window.openbotPage?.displayMode === "fullscreen" && window.innerWidth > 720;
      }),
    Boolean,
    UI_WAIT_MS,
  );
  // The browser sends a click to the frame from the last drawn frame, so the moved page must be drawn.
  await desktop.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(undefined)))),
  );
  await clickInPage(frame, counter);
  await shot("full-screen", desktop.locator("body"));
  await desktop.keyboard.press("Escape");
  const closedWithEscape = await waitFor(
    desktop,
    "the page leaves full screen",
    async () => !(await inFullScreen(frame)),
    Boolean,
    UI_WAIT_MS,
  );
  const countAfter = await counter.innerText();
  report.fullScreen = { opened: true, countBefore, countAfter, closedWithEscape };
  assert.equal(countBefore, "Count: 2");
  assert.equal(countAfter, "Count: 3", "The page loaded again in full screen.");

  // 2. A click on the image opens the image viewer.
  await page.getByRole("img", { name: "Chart" }).click();
  const closeViewer = desktop.getByRole("button", { name: english("chat.image.lightbox.close"), exact: true });
  await closeViewer.waitFor({ timeout: UI_WAIT_MS });
  report.imageViewer = true;
  await desktop.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
  await shot("image-viewer", desktop.locator("body"));
  await closeViewer.click();
  await closeViewer.waitFor({ state: "detached", timeout: UI_WAIT_MS });

  // 3. "Pick B" writes its text in the composer, with no reply block, and sends nothing.
  const messagesBefore = (await client.read(channel.id)).messages.length;
  await page.getByRole("button", { name: "Pick B" }).click();
  await waitFor(
    desktop,
    "the composer holds the page's text",
    () => composer(desktop).innerText(),
    (text) => text.includes(PICK_TEXT),
    UI_WAIT_MS,
  );
  const replyingToPage = (await conversation(desktop).getByText(english("composer.reply.toAgent")).count()) > 0;
  const messagesAfter = (await client.read(channel.id)).messages.length;
  report.pick = {
    composerText: await composer(desktop).innerText(),
    replyingToPage,
    messagesBefore,
    messagesAfter,
  };
  assert.equal(replyingToPage, false, "The composer shows a reply block for the page.");
  assert.equal(messagesAfter, messagesBefore, "The page sent a message itself.");
  await shot("composer-reply", conversation(desktop));

  // 4. The context shows as a quote chip at the start of the draft, and the send keeps it first.
  await page.getByRole("button", { name: "Share count" }).click();
  const chip = composer(desktop).getByLabel(english("composer.token.quote", { name: CONTEXT_TEXT }), { exact: true });
  await chip.waitFor({ timeout: UI_WAIT_MS });
  await shot("context-chip", conversation(desktop));
  const sentAfter = (await client.read(channel.id)).throughSequence;
  await composer(desktop).click();
  await desktop.keyboard.press("Enter");
  const sent = await waitFor(
    desktop,
    "the message with the page context is sent",
    async () =>
      (await client.read(channel.id)).messages.find(
        (message) => message.sequence > sentAfter && message.author.kind === "member",
      ),
    Boolean,
    WAIT_MS,
  );
  const sentText = sent?.message.text ?? "";
  report.context = { chip: true, sentText };
  assert.match(sentText, /^@\[[^\]]+\]\(quote(\+uri)?:/u, "The sent message does not start with the quote.");
  assert.ok(decodeURIComponent(sentText).includes(CONTEXT_TEXT), "The quote does not hold the page context.");
  assert.ok(sentText.includes(PICK_TEXT), "The sent message does not hold the page's reply.");
  await chip.waitFor({ state: "detached", timeout: UI_WAIT_MS });

  // 5. The search shortcut works while the page has the focus.
  await counter.click();
  await desktop.keyboard.press(`${shortcutModifier}+K`);
  const search = desktop.getByRole("dialog", { name: english("conversation.globalSearch.title") });
  await search.waitFor({ timeout: UI_WAIT_MS });
  report.globalSearch = true;
  await shot("global-search", desktop.locator("body"));
  await desktop.keyboard.press("Escape");

  report.passed = true;
} finally {
  await client.cleanup();
  if (restore)
    await client.update(restore.id, { provider: restore.provider, model: restore.model }).catch(() => undefined);
  writeReport("chat-visual-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
