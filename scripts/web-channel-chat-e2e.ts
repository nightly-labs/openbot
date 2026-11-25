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

const rowLabels = async (page: Page) =>
  (await rows(page).evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")))).filter(
    (label): label is string => label !== null,
  );

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

async function signIn(page: Page): Promise<void> {
  await page.goto(`${api}/app`);
  await page.getByRole("textbox", { name: english("account.login.email"), exact: true }).fill(DEV_HOST_EMAIL);
  await page.getByRole("button", { name: english("account.login.sendCode"), exact: true }).click();
  const prefix = english("account.login.developmentCode", { code: "" });
  const notice = page.getByText(new RegExp(`^${literal(prefix)}`));
  await notice.waitFor({ timeout: UI_WAIT_MS });
  const code = (await notice.innerText()).slice(prefix.length).replaceAll("-", "").trim();
  assert.ok(code.length > 0, "The account service showed no development code.");
  await page.keyboard.type(code);
}

try {
  const agents = await client.agents();
  assert.ok(agents.length >= 2, "This check needs two visible agents.");
  const [a, b] = agents;
  assert.ok(a && b);

  const channel = await client.create(name, [a.id, b.id], a.id);
  report.channelId = channel.id;
  await ask(channel.id, a.id, SHORT_PROMPT, "the first reply ends");
  const done = await ask(channel.id, a.id, VISUAL_PROMPT, "the visual reply turn ends");
  assert.ok(
    done.messages.some((message) => message.message.itemType?.startsWith("visual-reply:")),
    `The channel has no visual reply: ${JSON.stringify(done.messages.map((message) => [message.message.itemType, message.message.text]))}`,
  );

  await sidebarRow(desktop).click();
  await header(desktop).waitFor({ timeout: UI_WAIT_MS });
  const desktopVisual = conversation(desktop).locator("iframe").first();
  await desktopVisual.waitFor({ timeout: UI_WAIT_MS });
  const desktopRows = await rowLabels(desktop);
  await shot("desktop", desktop.locator("body"));

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
