// Checks the channel chat of the web client against the desktop app, with real provider turns.
// Start the app with `bun run dev` (never `--shared`), then run
// `bun scripts/web-channel-chat-e2e.ts --allow-mutations [--api=<url>] [--browser-executable=<path>]`.
// It needs two visible agents whose provider is signed in. `--api` is the account service of the dev
// stack (default http://localhost:3100); the script signs in to its `/app` as the dev host user.
//
// Through the desktop bridge it makes a channel, sends a message and asks for a visual reply. Then it
// opens the channel on the desktop and in the web client. It checks that the web client shows one
// conversation panel and no model picker, the same rows in the same order as the desktop, the visual
// reply page (which the web client loads through `visualPage`), and Delete in the row menu of the host
// owner. A member who cannot delete is not checked: the dev member is not in the account service.
// It deletes its channel at the end.
// Writes .openbot-build/web-channel-chat-e2e/report.json and screenshots.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { translateFor } from "@openbot/i18n";
import { type Browser, chromium, type Locator, type Page } from "playwright-core";
import {
  argument,
  ChannelClient,
  connectChannelE2e,
  SHORT_PROMPT,
  WAIT_MS,
  waitFor,
  writeReport,
} from "./channel-e2e-support";

const OUT = resolve(import.meta.dirname, "../.openbot-build/web-channel-chat-e2e");
const UI_WAIT_MS = 30_000;
const DEV_HOST_EMAIL = "openbot-dev-host@example.com";
const VISUAL_PROMPT =
  "Call the html_render tool once with a small HTML page that shows the word OTTER in a heading. Then reply with DONE only.";
const english = translateFor("en");
const api = (argument("api") ?? "http://localhost:3100").replace(/\/$/, "");
const browserExecutable = argument("browser-executable");

interface Report {
  channelId?: string;
  rows?: { desktop: string[]; web: string[] };
  layout?: { conversationPanels: number; modelPickers: number };
  ownRow?: string;
  visual?: { loadedAsSrcdoc: boolean; heading: boolean };
  ownerDelete?: boolean;
  memberDelete: string;
  pageErrors: { desktop: string[]; web: string[] };
  screenshots: string[];
  passed: boolean;
}

const report: Report = {
  memberDelete: "Not checked: the dev member is not in the account service, so it cannot sign in to the web client.",
  pageErrors: { desktop: [], web: [] },
  screenshots: [],
  passed: false,
};
const session = await connectChannelE2e("web-channel-chat-e2e");
const desktop = session.page;
desktop.on("pageerror", (error) => report.pageErrors.desktop.push(error.stack ?? error.message));
const client = new ChannelClient(desktop);
const name = `E2E web ${crypto.randomUUID().slice(0, 4)}`;
let browser: Browser | null = null;

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const conversation = (page: Page) => page.getByRole("main", { name: english("conversation.view.label") });
const header = (page: Page) => conversation(page).getByRole("heading", { level: 1, name, exact: true });
const sidebarRow = (page: Page) =>
  page
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${literal(name)}[,.]`) })
    .first();
const rows = (page: Page) => conversation(page).getByRole("article");

async function shot(label: string, target: Locator): Promise<void> {
  const path = resolve(OUT, `${label}.png`);
  await target.screenshot({ path });
  report.screenshots.push(path);
}

/** The label of each message row, in order. */
const rowLabels = async (page: Page) =>
  (await rows(page).evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")))).filter(
    (label): label is string => label !== null,
  );

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

/** Signs in to the web client with the code that the development account service shows. */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${api}/app`);
  await page.getByRole("textbox", { name: english("account.login.email"), exact: true }).fill(DEV_HOST_EMAIL);
  await page.getByRole("button", { name: english("account.login.sendCode"), exact: true }).click();
  const prefix = english("account.login.developmentCode", { code: "" });
  const notice = page.getByText(new RegExp(`^${literal(prefix)}`));
  await notice.waitFor({ timeout: UI_WAIT_MS });
  const code = (await notice.innerText()).slice(prefix.length).replaceAll("-", "").trim();
  assert.ok(code.length > 0, "The account service showed no development code.");
  // The code field takes the focus when it shows.
  await page.keyboard.type(code);
}

try {
  const agents = await client.agents();
  assert.ok(agents.length >= 2, "This check needs two visible agents.");
  const [a, b] = agents;
  assert.ok(a && b);

  // 1. A channel with an own message, the agent's reply and a visual reply.
  const channel = await client.create(name, [a.id, b.id], a.id);
  report.channelId = channel.id;
  await ask(channel.id, a.id, SHORT_PROMPT, "the first reply ends");
  const done = await ask(channel.id, a.id, VISUAL_PROMPT, "the visual reply turn ends");
  assert.ok(
    done.messages.some((message) => message.message.itemType?.startsWith("visual-reply:")),
    `The channel has no visual reply: ${JSON.stringify(done.messages.map((message) => [message.message.itemType, message.message.text]))}`,
  );

  // 2. The rows on the desktop.
  await sidebarRow(desktop).click();
  await header(desktop).waitFor({ timeout: UI_WAIT_MS });
  const desktopVisual = conversation(desktop).locator("iframe").first();
  await desktopVisual.waitFor({ timeout: UI_WAIT_MS });
  const desktopRows = await rowLabels(desktop);
  await shot("desktop", desktop.locator("body"));

  // 3. The same channel in the web client.
  browser = await chromium.launch(browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" });
  const web = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  web.on("pageerror", (error) => report.pageErrors.web.push(error.stack ?? error.message));
  await signIn(web);
  await sidebarRow(web).waitFor({ timeout: WAIT_MS });
  await sidebarRow(web).click();
  await header(web).waitFor({ timeout: UI_WAIT_MS });
  await rows(web).filter({ hasText: SHORT_PROMPT }).first().waitFor({ timeout: UI_WAIT_MS });

  report.layout = {
    conversationPanels: await conversation(web).count(),
    modelPickers: await web.getByRole("button", { name: /^Agent model:/ }).count(),
  };
  assert.equal(report.layout.conversationPanels, 1, "The web channel shows more than one conversation panel.");
  assert.equal(report.layout.modelPickers, 0, "The web channel shows a model picker.");

  // 4. The visual reply loads as page text, because the web client has no page URL.
  const frame = conversation(web).locator("iframe").first();
  await frame.waitFor({ timeout: UI_WAIT_MS });
  await frame.scrollIntoViewIfNeeded();
  const heading = frame.contentFrame().getByRole("heading", { name: "OTTER" });
  await heading.waitFor({ timeout: UI_WAIT_MS });
  report.visual = { loadedAsSrcdoc: (await frame.getAttribute("srcdoc")) !== null, heading: true };
  assert.ok(report.visual.loadedAsSrcdoc, "The web visual reply did not load through visualPage.");

  const webRows = await rowLabels(web);
  report.rows = { desktop: desktopRows, web: webRows };
  assert.deepEqual(webRows, desktopRows, "The web client shows other rows than the desktop.");
  report.ownRow = (await rows(web).filter({ hasText: SHORT_PROMPT }).first().getAttribute("aria-label")) ?? "missing";
  await shot("web", web.locator("body"));

  // 5. The host owner can delete the channel from its row menu.
  await sidebarRow(web).click({ button: "right" });
  const remove = web.getByRole("menuitem", { name: english("sidebar.channelMenu.delete"), exact: true });
  await remove.waitFor({ timeout: UI_WAIT_MS });
  report.ownerDelete = true;
  await shot("web-row-menu", web.locator("body"));
  await web.keyboard.press("Escape");

  report.passed = true;
} finally {
  await browser?.close().catch(() => undefined);
  await client.cleanup();
  writeReport("web-channel-chat-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
