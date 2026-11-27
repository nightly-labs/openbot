import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AgentTasksSnapshot, ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { chromium, type Locator, type Page } from "playwright-core";
import { argument, connectChannelE2e, waitFor, writeReport } from "./channel-e2e-support";

const NAME = "browser-extension-image-paste-e2e";
const OUT = resolve(import.meta.dirname, `../.openbot-build/${NAME}`);
const EXTENSION = resolve(import.meta.dirname, "../apps/browser-extension");
mkdirSync(OUT, { recursive: true });
const UI_WAIT_MS = 30_000;
const IMAGE_NAME = "image.png";
const english = translateFor("en");
const agentArgument = argument("agent");
const authApi = argument("auth-api")?.replace(/\/$/, "");
assert.ok(agentArgument, "Pass --agent=<agent id> of a host agent.");
assert.ok(authApi, "Pass --auth-api=<url> from the dev stack log.");
const agentId: string = agentArgument;
const email = argument("email") ?? "openbot-dev-host@example.com";
const run = crypto.randomUUID().slice(0, 6);
const chatText = `Reply with the single word ok. Do not use tools. Pasted image ${run}.`;
const threadText = `Reply with the single word ok. Do not use tools. Pasted image thread ${run}.`;
const channelName = `Pasted image ${run}`;

interface Step {
  removeWorked: boolean;
  imageOnHost: boolean;
  imageShownInChat: boolean;
}

interface Report {
  agentId: string;
  mainChat?: Step;
  thread?: Step & { taskId: string };
  channel?: Step & { imageOnly: boolean };
  textPasteKept?: boolean;
  pageErrors: string[];
  screenshots: string[];
  passed: boolean;
}

const report: Report = { agentId, pageErrors: [], screenshots: [], passed: false };
const host = await connectChannelE2e(NAME);
const build = spawnSync("bun", ["run", "build", "--", "--mode", "development"], {
  cwd: EXTENSION,
  env: { ...process.env, VITE_OPENBOT_API_URL: authApi },
  stdio: "inherit",
});
assert.equal(build.status, 0, "The extension build failed.");
const dist = resolve(EXTENSION, "dist");
const profile = mkdtempSync(resolve(tmpdir(), "openbot-extension-paste-e2e-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  viewport: { width: 360, height: 720 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
let channelId: string | null = null;

async function shot(page: Page, label: string): Promise<void> {
  const path = resolve(OUT, `${label}.png`);
  await page.screenshot({ path });
  report.screenshots.push(path);
}

async function pasteImage(field: Locator, color: string): Promise<void> {
  await field.evaluate(async (element, fill) => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 64;
    const drawing = canvas.getContext("2d");
    if (!drawing) throw new Error("No canvas.");
    drawing.fillStyle = fill;
    drawing.fillRect(0, 0, 96, 64);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
    if (!blob) throw new Error("No PNG.");
    const data = new DataTransfer();
    data.items.add(new File([blob], "image.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, color);
}

async function pasteText(field: Locator, text: string): Promise<boolean> {
  return field.evaluate((element, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    return element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

function removeButton(page: Page): Locator {
  return page.getByRole("button", { name: english("composer.attachment.remove", { name: IMAGE_NAME }) });
}

async function pasteRemoveAndPasteAgain(page: Page, field: Locator): Promise<boolean> {
  await pasteImage(field, "#e4572e");
  await removeButton(page).waitFor({ timeout: UI_WAIT_MS });
  await removeButton(page).click();
  await removeButton(page).waitFor({ state: "detached", timeout: UI_WAIT_MS });
  await pasteImage(field, "#2e86e4");
  await removeButton(page).waitFor({ timeout: UI_WAIT_MS });
  return true;
}

function previewCards(page: Page): Locator {
  return page.getByRole("button", { name: english("attachment.preview", { name: IMAGE_NAME }) });
}

async function imageShown(page: Page, cardsBefore: number): Promise<boolean> {
  await page.waitForFunction(
    ({ name, count }) =>
      Array.from(document.querySelectorAll("button")).filter((button) => button.getAttribute("aria-label") === name)
        .length > count,
    { name: english("attachment.preview", { name: IMAGE_NAME }), count: cardsBefore },
    { timeout: 60_000 },
  );
  const picture = previewCards(page).last().locator("img");
  await picture.waitFor({ timeout: 60_000 });
  return picture.evaluate((image: HTMLImageElement) =>
    image.complete && image.naturalWidth > 0
      ? true
      : new Promise<boolean>((done) => {
          image.addEventListener("load", () => done(image.naturalWidth > 0), { once: true });
          image.addEventListener("error", () => done(false), { once: true });
        }),
  );
}

const hasImage = (message: ConversationMessage | undefined) =>
  message?.attachments?.some((attachment) => attachment.kind === "image" && attachment.name === IMAGE_NAME) ?? false;

try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: UI_WAIT_MS }));
  const extensionId = new URL(worker.url()).host;
  const agentName = await host.page.evaluate(
    async (id) => (await window.openbot.agent.listAgents()).find((entry) => entry.id === id)?.name ?? "",
    agentId,
  );
  assert.ok(agentName, "The host has no agent with this id.");

  const web = await context.newPage();
  await web.goto(`${authApi}/app`);
  const emailField = web.getByRole("textbox", { name: english("account.login.email") });
  await emailField.waitFor({ timeout: 60_000 });
  await emailField.fill(email);
  await web.getByRole("button", { name: english("account.login.sendCode") }).click();
  const codeLine = web.getByText(/^Development code: /);
  await codeLine.waitFor({ timeout: 60_000 });
  const code = (await codeLine.textContent())?.replace(/^Development code: /, "").replace(/[^A-Za-z0-9]/g, "");
  assert.ok(code, "The web app shows no development code.");
  await web.keyboard.type(code);
  await web.waitForFunction(() => !document.querySelector(".account-login-screen"), null, { timeout: 60_000 });
  await web.close();

  const page = await context.newPage();
  page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const opened = context.waitForEvent("page", {
    predicate: (candidate) => candidate.url().includes("extension=") && !candidate.url().includes("silent=1"),
    timeout: 60_000,
  });
  await page.getByRole("button", { name: english("extension.signIn.withWeb") }).click();
  await (await opened).getByRole("button", { name: english("webClient.extension.allow") }).click({ timeout: 60_000 });
  const serverMenu = page.getByRole("button", { name: english("extension.home.serverMenu") });
  await serverMenu.waitFor({ timeout: 60_000 });

  const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page
    .getByRole("button", { name: new RegExp(`^${literal(agentName)}\\b`) })
    .first()
    .click();
  const composer = page.getByRole("textbox", { name: english("extension.chat.ask", { name: agentName }) });
  await composer.waitFor({ timeout: UI_WAIT_MS });

  await composer.fill("");
  const textNotHandled = await pasteText(composer, "plain words");
  report.textPasteKept = textNotHandled && (await removeButton(page).count()) === 0;
  assert.ok(report.textPasteKept, "A text paste was taken as an image.");

  const mainCards = await previewCards(page).count();
  const mainRemoved = await pasteRemoveAndPasteAgain(page, composer);
  await shot(page, "1-main-chat-pasted");
  await composer.fill(chatText);
  await composer.press("Enter");
  await removeButton(page).waitFor({ state: "detached", timeout: UI_WAIT_MS });
  const mainChat = await waitFor(
    host.page,
    "the host has the main chat message with the image",
    (): Promise<ConversationSnapshot> => host.page.evaluate((id) => window.openbot.agent.readConversation(id), agentId),
    (snapshot) => hasImage(snapshot.messages.find((message) => message.text.includes(chatText))),
  );
  report.mainChat = {
    removeWorked: mainRemoved,
    imageOnHost: hasImage(mainChat.messages.find((message) => message.text.includes(chatText))),
    imageShownInChat: await imageShown(page, mainCards),
  };
  await shot(page, "2-main-chat-sent");

  const before = new Set(
    (await host.page.evaluate((id) => window.openbot.agent.listTasks(id), agentId)).tasks.map((entry) => entry.id),
  );
  await page.getByRole("button", { name: english("extension.chat.threadsMenu", { name: agentName }) }).click();
  await page.getByRole("menuitem", { name: english("extension.chat.newThread") }).click();
  const threadCards = await previewCards(page).count();
  const threadRemoved = await pasteRemoveAndPasteAgain(page, composer);
  await composer.fill(threadText);
  await composer.press("Enter");
  const tasks = await waitFor(
    host.page,
    "the host lists the new thread",
    (): Promise<AgentTasksSnapshot> => host.page.evaluate((id) => window.openbot.agent.listTasks(id), agentId),
    (snapshot) => snapshot.tasks.some((task) => !before.has(task.id)),
    90_000,
  );
  const task = tasks.tasks.find((entry) => !before.has(entry.id));
  assert.ok(task, "The host has no new thread.");
  const thread = await waitFor(
    host.page,
    "the thread has the message with the image",
    (): Promise<ConversationSnapshot> =>
      host.page.evaluate((value) => window.openbot.agent.readTask(value), { agentId, taskId: task.id }),
    (snapshot) => hasImage(snapshot.messages.find((message) => message.text.includes(threadText))),
  );
  report.thread = {
    taskId: task.id,
    removeWorked: threadRemoved,
    imageOnHost: hasImage(thread.messages.find((message) => message.text.includes(threadText))),
    imageShownInChat: await imageShown(page, threadCards),
  };
  await shot(page, "3-thread-sent");

  await page.getByRole("button", { name: english("common.back"), exact: true }).click();
  await page.getByRole("button", { name: english("sidebar.new.menuWithChannel") }).click();
  await page.getByRole("menuitem", { name: english("sidebar.new.channel") }).click();
  await page.getByRole("textbox", { name: english("channel.form.name") }).fill(channelName);
  await page.locator("label").filter({ hasText: agentName }).first().click();
  await page.getByRole("button", { name: english("common.create"), exact: true }).click();
  const channelComposer = page.getByRole("textbox", { name: english("extension.channel.ask", { name: channelName }) });
  await channelComposer.waitFor({ timeout: UI_WAIT_MS });
  const channels = await waitFor(
    host.page,
    "the host has the channel",
    () => host.page.evaluate(() => window.openbot.agent.listChannels()),
    (value) => value.some((channel) => channel.name === channelName),
  );
  channelId = channels.find((channel) => channel.name === channelName)?.id ?? null;
  assert.ok(channelId, "The host has no channel.");
  const channelCards = await previewCards(page).count();
  const channelRemoved = await pasteRemoveAndPasteAgain(page, channelComposer);
  await channelComposer.press("Enter");
  const channelPage = await waitFor(
    host.page,
    "the channel has the image-only message",
    () => host.page.evaluate((id) => window.openbot.agent.readChannel({ channelId: id }), channelId ?? ""),
    (value) => value.messages.some((entry) => entry.author.kind === "member" && hasImage(entry.message)),
  );
  const own = channelPage.messages.find((entry) => entry.author.kind === "member" && hasImage(entry.message));
  report.channel = {
    removeWorked: channelRemoved,
    imageOnHost: own !== undefined,
    imageOnly: own?.message.text.trim() === "",
    imageShownInChat: await imageShown(page, channelCards),
  };
  await shot(page, "4-channel-sent");

  assert.ok(report.mainChat.imageOnHost && report.mainChat.imageShownInChat, "The main chat image failed.");
  assert.ok(report.thread.imageOnHost && report.thread.imageShownInChat, "The thread image failed.");
  assert.ok(report.channel.imageOnHost && report.channel.imageOnly, "The channel image failed.");
  assert.ok(report.channel.imageShownInChat, "The channel does not show the image.");
  assert.deepEqual(report.pageErrors, [], "The panel threw errors.");
  report.passed = true;
} catch (error) {
  const page = context.pages().find((candidate) => candidate.url().endsWith("/sidepanel.html"));
  if (page) await shot(page, "failure").catch(() => undefined);
  throw error;
} finally {
  if (channelId)
    await host.page.evaluate((id) => window.openbot.agent.deleteChannel(id), channelId).catch(() => undefined);
  const path = writeReport(NAME, report);
  process.stdout.write(`${path}\n`);
  await context.close().catch(() => undefined);
  rmSync(profile, { recursive: true, force: true });
  await host.close().catch(() => undefined);
}
