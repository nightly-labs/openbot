import assert from "node:assert/strict";
import { resolve } from "node:path";
import { isAgentProvider } from "@openbot/contracts/agent-providers";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import type { FrameLocator, Locator, Page } from "playwright-core";
import { argument, ChannelClient, connectChannelE2e, WAIT_MS, waitFor, writeReport } from "./channel-e2e-support";

declare global {
  interface Window {
    openbotPage?: { displayMode: "inline" | "fullscreen" };
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/chat-visual-e2e");
const UI_WAIT_MS = 30_000;
const TITLE = "Plan picker";
const PICK_TEXT = "I pick plan B.";
const CONTEXT_TEXT = "The counter shows 3.";
const NOTE_TEXT = "Plan B costs 12 euros per month and ships on Friday.";
const SHORTCUT_TEXT = "ships on Friday";
const INLINE_QUOTE_TEXT = "12 euros per month";
const PAGE = `<!doctype html><html><body>
<button id="count" type="button">Count: 0</button>
<button id="pick" type="button">Pick B</button>
<button id="context" type="button">Share count</button>
<img id="chart" alt="Chart" width="240" height="120">
<p id="note">${NOTE_TEXT}</p>
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
  inline?: { framesInChat: number; count: string; quoteId: string; openedInPanel: boolean };
  fullScreen?: { countBefore: string; countAfter: string; closedWithEscape: boolean };
  imageViewer?: boolean;
  pick?: { composerText: string; replyingToPage: boolean; messagesBefore: number; messagesAfter: number };
  context?: { chip: boolean; sentText: string };
  quote?: { action: boolean; button: string; shortcut: string; reopened: boolean };
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

const panel = (page: Page) => page.getByRole("complementary", { name: english("preview.panel.label") });
const quoteChip = (page: Page, text: string) =>
  composer(page).getByLabel(english("composer.token.quote", { name: text }), { exact: true });

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

async function selectInNote(page: FrameLocator, text: string): Promise<void> {
  await page.locator("#note").evaluate((note, passage) => {
    const node = note.firstChild;
    const start = note.textContent?.indexOf(passage) ?? -1;
    if (!(node instanceof Text) || start < 0) throw new Error(`The note has no "${passage}".`);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + passage.length);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  }, text);
}

const chipQuoteId = (chip: Locator) => chip.evaluate((element) => element.getAttribute("data-quote-message-id") ?? "");

const inFullScreen = (frame: Locator) =>
  frame.evaluate((element) => element.closest("[popover]")?.matches(":popover-open") === true);

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

  const inlineFrame = conversation(desktop).getByRole("article").locator("iframe").last();
  await inlineFrame.waitFor({ timeout: UI_WAIT_MS });
  const framesInChat = await conversation(desktop).getByRole("article").locator("iframe").count();
  const inlinePage: FrameLocator = inlineFrame.contentFrame();
  const inlineCounter = inlinePage.getByRole("button", { name: /^Count: / });
  await inlineCounter.waitFor({ timeout: UI_WAIT_MS });
  await inlineFrame.scrollIntoViewIfNeeded();
  await clickInPage(inlineFrame, inlineCounter);
  const inlineCount = await inlineCounter.innerText();
  assert.equal(inlineCount, "Count: 1", "The page in the chat does not run its script.");
  await shot("inline", conversation(desktop));

  await inlineFrame.hover();
  await conversation(desktop)
    .getByRole("button", { name: english("chat.visual.fullScreen"), exact: true })
    .click();
  await waitFor(desktop, "the page goes full screen", () => inFullScreen(inlineFrame), Boolean, UI_WAIT_MS);
  await waitFor(
    desktop,
    "the page has the full-screen size",
    () => inlineCounter.evaluate(() => window.openbotPage?.displayMode === "fullscreen" && window.innerWidth > 720),
    Boolean,
    UI_WAIT_MS,
  );
  await desktop.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(undefined)))),
  );
  await clickInPage(inlineFrame, inlineCounter);
  await shot("full-screen", desktop.locator("body"));
  await desktop.keyboard.press("Escape");
  const closedWithEscape = await waitFor(
    desktop,
    "the page leaves full screen",
    async () => !(await inFullScreen(inlineFrame)),
    Boolean,
    UI_WAIT_MS,
  );
  const countAfter = await inlineCounter.innerText();
  report.fullScreen = { countBefore: inlineCount, countAfter, closedWithEscape };
  assert.equal(countAfter, "Count: 2", "The page loaded again in full screen.");

  await selectInNote(inlinePage, INLINE_QUOTE_TEXT);
  const actions = desktop.getByRole("toolbar", { name: english("chat.selection.label"), exact: true });
  const quoteButton = actions.getByRole("button", { name: english("chat.selection.quote"), exact: true });
  await quoteButton.waitFor({ timeout: UI_WAIT_MS });
  await quoteButton.click();
  const inlineChip = quoteChip(desktop, INLINE_QUOTE_TEXT);
  await inlineChip.waitFor({ timeout: UI_WAIT_MS });
  await quoteButton.waitFor({ state: "detached", timeout: UI_WAIT_MS });
  const inlineQuoteId = await chipQuoteId(inlineChip);
  assert.match(inlineQuoteId, /^attachment-file:/u, "The quote from the chat does not name the page file.");

  await inlineFrame.hover();
  await conversation(desktop)
    .getByRole("button", { name: english("chat.visual.openInSidePanel"), exact: true })
    .last()
    .click();
  const frame = panel(desktop).locator("iframe").first();
  await frame.waitFor({ timeout: UI_WAIT_MS });
  const page: FrameLocator = frame.contentFrame();
  const counter = page.getByRole("button", { name: /^Count: / });
  await counter.waitFor({ timeout: UI_WAIT_MS });
  await desktop.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
  const quoteAgain = await quoteButton.count();
  assert.equal(quoteAgain, 0, "Quote shows again for the quoted text after the side panel opens.");
  report.inline = { framesInChat, count: inlineCount, quoteId: inlineQuoteId, openedInPanel: true };
  await desktop.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
  for (let click = 0; click < 3; click += 1) await clickInPage(frame, counter);
  assert.equal(await counter.innerText(), "Count: 3");
  await shot("panel", desktop.locator("body"));

  await clickInPage(frame, page.getByRole("img", { name: "Chart" }));
  const closeViewer = desktop.getByRole("button", { name: english("chat.image.lightbox.close"), exact: true });
  await closeViewer.waitFor({ timeout: UI_WAIT_MS });
  report.imageViewer = true;
  await desktop.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
  await shot("image-viewer", desktop.locator("body"));
  await closeViewer.click();
  await closeViewer.waitFor({ state: "detached", timeout: UI_WAIT_MS });

  const messagesBefore = (await client.read(channel.id)).messages.length;
  await clickInPage(frame, page.getByRole("button", { name: "Pick B" }));
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

  await clickInPage(frame, page.getByRole("button", { name: "Share count" }));
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
  assert.ok(
    decodeURIComponent(sentText).includes(INLINE_QUOTE_TEXT),
    "The page context replaced the user's quote of the page.",
  );
  await chip.waitFor({ state: "detached", timeout: UI_WAIT_MS });

  await selectInNote(page, NOTE_TEXT);
  await quoteButton.waitFor({ timeout: UI_WAIT_MS });
  await shot("quote-action", desktop.locator("body"));
  await quoteButton.click();
  const noteChip = quoteChip(desktop, NOTE_TEXT);
  await noteChip.waitFor({ timeout: UI_WAIT_MS });
  await quoteButton.waitFor({ state: "detached", timeout: UI_WAIT_MS });
  const button = await chipQuoteId(noteChip);
  assert.match(button, /^attachment-file:/u, "The quote does not name the page file.");

  await clickInPage(frame, page.locator("#note"));
  await selectInNote(page, SHORTCUT_TEXT);
  await quoteButton.waitFor({ timeout: UI_WAIT_MS });
  await desktop.keyboard.press(`${shortcutModifier}+Shift+Period`);
  const shortcutChip = quoteChip(desktop, SHORTCUT_TEXT);
  await shortcutChip.waitFor({ timeout: UI_WAIT_MS });
  const shortcut = await chipQuoteId(shortcutChip);
  assert.equal(shortcut, button, "The two quotes name different files.");
  assert.equal(inlineQuoteId, button, "The chat and the side panel quote different files.");
  await shot("quote-chips", conversation(desktop));

  await conversation(desktop)
    .getByRole("button", { name: english("conversation.sidePanel.close"), exact: true })
    .click();
  await frame.waitFor({ state: "hidden", timeout: UI_WAIT_MS });
  await noteChip.click();
  await frame.waitFor({ timeout: UI_WAIT_MS });
  await counter.waitFor({ timeout: UI_WAIT_MS });
  report.quote = { action: true, button, shortcut, reopened: true };

  await clickInPage(frame, counter);
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
