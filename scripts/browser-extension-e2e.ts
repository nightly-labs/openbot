import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  X_AGENT_LISTING_ID,
  X_PAGE_RULES_DEFAULT,
  X_PAGE_RULES_ROUTE,
  type XPageRules,
  xPageRulesHash,
} from "@openbot/contracts/browser-extension-x";
import type { AgentTasksSnapshot, ConversationSnapshot } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { chromium, type Page } from "playwright-core";
import { argument, connectChannelE2e, waitFor, writeReport } from "./channel-e2e-support";

const NAME = "browser-extension-e2e";
const OUT = resolve(import.meta.dirname, `../.openbot-build/${NAME}`);
const EXTENSION = resolve(import.meta.dirname, "../apps/browser-extension");
mkdirSync(OUT, { recursive: true });
const UI_WAIT_MS = 30_000;
const english = translateFor("en");
const agentArgument = argument("agent");
const authApi = argument("auth-api")?.replace(/\/$/, "");
assert.ok(agentArgument, "Pass --agent=<agent id> of a host agent whose provider is signed in.");
assert.ok(authApi, "Pass --auth-api=<url> from the dev stack log.");
const agentId: string = agentArgument;
const email = argument("email") ?? "openbot-dev-host@example.com";
const browserExecutable = argument("browser-executable");
const run = crypto.randomUUID().slice(0, 6);
const chatText = `Reply with the single word ready. Do not use tools. Extension ${run}.`;
const threadText = `Reply with the single word done. Do not use tools. Extension thread ${run}.`;
const spokenText = "Please summarize the open page for me.";
const xQuestion = `Is the claim in this thread true? ${run}`;
const channelText = `Reply with the single word ok. Do not use tools. Extension channel ${run}.`;
const folderName = `Extension folder ${run}`;
const channelName = `Extension channel ${run}`;
const newAgentName = `Extension agent ${run}`;
const shareButton = `Mark clicked ${run}`;
const shareText = `Use openbot_browser: call list_tabs, then snapshot the Chrome tab titled "Shared tab ${run}" (its id starts with "chrome:"), then click the button labelled "${shareButton}". Reply with the single word done. Extension tabs ${run}.`;
const SHARE_FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>Shared tab ${run}</title></head><body>
<h1>Shared tab ${run}</h1>
<button type="button" id="mark">${shareButton}</button>
<script>
document.getElementById("mark").addEventListener("click", () => { document.body.dataset.clicked = String(Date.now()); });
</script></body></html>`;

const X_FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>X</title></head><body>
<main>
<article data-testid="tweet"><div data-testid="User-Name"><span>Alice</span><span>@alice</span></div>
<a href="/x-fixture/alice/status/1"><time datetime="2026-11-19T10:00:00.000Z">10:00</time></a>
<div data-testid="tweetText">Eggs are a superfood. Thoughts?</div></article>
<article data-testid="tweet" tabindex="-1"><div data-testid="User-Name"><span>Bob</span><span>@bob</span></div>
<a href="/x-fixture/bob/status/2"><time datetime="2026-11-19T10:05:00.000Z">10:05</time></a>
<div data-testid="tweetText">Studies show two eggs a day cut heart risk by 40%.</div>
<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/egg.jpg" alt=""></div></article>
<section><div data-testid="tweetTextarea_0" role="textbox" contenteditable="true" style="min-height:40px;border:1px solid #ccc"></div>
<div><button type="button" data-testid="replyComposerSubmit" style="border-radius:999px;padding:8px 16px">Reply</button></div></section>
<article data-testid="tweet"><div data-testid="User-Name"><span>Bob</span><span>@bob</span></div>
<a href="/x-fixture/bob/status/3"><time datetime="2026-11-19T10:06:00.000Z">10:06</time></a>
<div data-testid="tweetText">Source: my uncle, a cardiologist.</div></article>
<article data-testid="tweet"><div data-testid="User-Name"><span>Carol</span><span>@carol</span></div>
<a href="/x-fixture/carol/status/4"><time datetime="2026-11-19T10:07:00.000Z">10:07</time></a>
<div data-testid="tweetText">Carol thinks this is nonsense.</div></article>
</main>
<script>
document.querySelector('[data-testid="replyComposerSubmit"]').addEventListener("click", () => {
  const box = document.querySelector('[data-testid="tweetTextarea_0"]');
  document.body.dataset.posted = box.innerText;
  document.body.dataset.postedAt = String(Date.now());
  box.textContent = "";
});
</script></body></html>`;
const servedRules: XPageRules = {
  mention: X_PAGE_RULES_DEFAULT.mention,
  selectors: {
    ...X_PAGE_RULES_DEFAULT.selectors,
    replyButton: ['[data-testid="replyComposerSubmit"]', ...X_PAGE_RULES_DEFAULT.selectors.replyButton],
  },
};
const servedHash = await xPageRulesHash(servedRules);
const xServer = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/x-rules")
      return Response.json({
        hash: servedHash,
        rules: url.searchParams.get("hash") === servedHash ? null : servedRules,
      });
    if (url.pathname.startsWith("/share-fixture/"))
      return new Response(SHARE_FIXTURE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    if (url.pathname.startsWith("/x-fixture/"))
      return new Response(X_FIXTURE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    return new Response("Not found", { status: 404 });
  },
});
const xBase = `http://127.0.0.1:${xServer.port}`;

interface CapturedEvent {
  type: string;
  clientId: string | null;
  name: string;
  profileId: string;
  surface: unknown;
  generation: unknown;
  platform: unknown;
  raw: string;
}
const captured: CapturedEvent[] = [];
const captureServer = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, openpanel-client-id",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const raw = await request.text();
    const body = JSON.parse(raw);
    captured.push({
      type: String(body.type),
      clientId: request.headers.get("openpanel-client-id"),
      name: String(body.payload?.name ?? ""),
      profileId: String(body.payload?.profileId ?? ""),
      surface: body.payload?.properties?.surface,
      generation: body.payload?.properties?.event_schema_version,
      platform: body.payload?.properties?.platform,
      raw,
    });
    return new Response(null, { status: 202, headers: cors });
  },
});
const ANALYTICS_CHOICE_KEY = "openbot.analytics.v1";
async function capturedEvent(test: (event: CapturedEvent) => boolean, label: string): Promise<CapturedEvent> {
  const deadline = Date.now() + UI_WAIT_MS;
  for (;;) {
    const found = captured.find(test);
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`No analytics event: ${label}`);
    await Bun.sleep(100);
  }
}

interface Report {
  agentId: string;
  extensionId?: string;
  signIn?: {
    invalidExtensionRefused: boolean;
    cancelShown: boolean;
    homeShowsServer: boolean;
    homeShowsAgent: boolean;
  };
  mainChat?: { messageOnHost: boolean; answerShown: boolean };
  settings?: { nameShown: boolean; titleSaved: boolean; titleRestored: boolean };
  thread?: { taskId: string; messageOnHost: boolean; headerNamesThread: boolean };
  dictation?: { micShown: boolean; transcript: string; draftHasWords: boolean };
  x?: {
    serviceRules: { answersRules: boolean; sameHashAnswersNull: boolean };
    unchangedWithoutAgent: boolean | null;
    armedWithServedRules: boolean;
    xAgentId: string;
    taskId: string;
    messageHasPostThreadAndWords: boolean;
    otherReplyLeftOut: boolean;
    postedAtOnce: boolean;
    queueEmptyAfterSend: boolean;
    panelStayed?: boolean;
  };
  create?: {
    folderOnHost: boolean;
    channelOnHost: boolean;
    channelMessageOnHost: boolean;
    channelAnswerShown: boolean;
    ownMessageUnlabelled: boolean;
    agentOnHost: boolean;
    agentChatOpened: boolean;
    cleanedUp: boolean;
  };
  sharedTabs?: {
    onWithoutSwitch: boolean;
    ungroupedBeforeUse: boolean;
    sharedAgain: boolean;
    inOpenBotGroup: boolean;
    presenceAccepted: boolean;
    askShown: boolean;
    buttonClicked: boolean;
    siteStored: boolean;
    siteRevoked: boolean;
    groupEnded: boolean;
    presenceEnded: boolean;
  };
  xQueue?: { waitingShown: boolean; sentByRetry: boolean; queueEmpty: boolean };
  silentSignIn?: { signedIn: boolean; noWindow: boolean };
  xRestart?: { sentAfterRestart: boolean; deliveredBy: "start" | "panel"; twoDayOldKept: boolean; queueEmpty: boolean };
  signOut?: { signInShown: boolean };
  analytics?: {
    events: string[];
    allExtensionSurface: boolean;
    optOutLinked: boolean;
    afterOptOutAnonymous: boolean;
    leaks: string[];
  };
  pageErrors: string[];
  screenshots: string[];
  passed: boolean;
}

const report: Report = { agentId, pageErrors: [], screenshots: [], passed: false };
const host = await connectChannelE2e(NAME);

const build = spawnSync("bun", ["run", "build", "--", "--mode", "development"], {
  cwd: EXTENSION,
  env: {
    ...process.env,
    VITE_OPENBOT_API_URL: authApi,
    VITE_OPENBOT_X_RULES_URL: `${xBase}/x-rules`,
    OPENBOT_ANALYTICS_CAPTURE_URL: `http://127.0.0.1:${captureServer.port}`,
  },
  stdio: "inherit",
});
assert.equal(build.status, 0, "The extension build failed.");
const dist = resolve(EXTENSION, "dist");
const speech = resolve(OUT, "speech.wav");
const said = spawnSync("say", ["-o", speech, "--data-format=LEI16@16000", spokenText], { stdio: "inherit" });
assert.equal(said.status, 0, "macOS `say` could not write the speech file.");
const profile = mkdtempSync(resolve(tmpdir(), "openbot-extension-e2e-"));
const launchOptions = {
  ...(browserExecutable ? { executablePath: browserExecutable } : { channel: "chromium" }),
  viewport: { width: 360, height: 720 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
};
let context = await chromium.launchPersistentContext(profile, launchOptions);
await context.addInitScript((base64) => {
  navigator.mediaDevices.getUserMedia = async () => {
    const audio = new AudioContext();
    await audio.resume();
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const source = audio.createBufferSource();
    source.buffer = await audio.decodeAudioData(bytes.buffer);
    source.loop = true;
    const output = audio.createMediaStreamDestination();
    source.connect(output);
    source.start();
    return output.stream;
  };
}, readFileSync(speech).toString("base64"));
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.race([
      Promise.all([
        ...[...document.querySelectorAll(".agent-avatar svg image")].map((image) => {
          const picture = new Image();
          picture.src = image.getAttribute("href") ?? "";
          return picture.decode().catch(() => undefined);
        }),
        ...document
          .getAnimations()
          .filter((animation) => animation.playState === "running")
          .filter((animation) => animation.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY)
          .map((animation) => animation.finished.catch(() => undefined)),
      ]),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]),
  );
}

async function shot(page: Page, label: string): Promise<void> {
  await settle(page);
  const path = resolve(OUT, `${label}.png`);
  await page.screenshot({ path });
  report.screenshots.push(path);
}

let panel: Page | null = null;
async function toHome(target: Page): Promise<void> {
  const server = target.getByRole("button", { name: english("extension.home.serverMenu") });
  const atHome = await server.click({ trial: true, timeout: 2_000 }).then(
    () => true,
    () => false,
  );
  if (!atHome) await target.getByRole("button", { name: english("common.back"), exact: true }).click();
}
const made: { folderId: string | null; channelId: string | null; agentId: string | null } = {
  folderId: null,
  channelId: null,
  agentId: null,
};
async function removeMade(): Promise<boolean> {
  const value = { ...made };
  made.folderId = null;
  made.channelId = null;
  made.agentId = null;
  if (value.channelId) await host.page.evaluate((id) => window.openbot.agent.deleteChannel(id), value.channelId);
  if (value.agentId) {
    const agentId = value.agentId;
    await host.page.evaluate(async (id) => {
      const turnId = (await window.openbot.agent.readConversation(id)).activeTurnId;
      if (turnId) await window.openbot.agent.interrupt({ agentId: id, turnId });
    }, agentId);
    await waitFor(
      host.page,
      "the new agent is idle",
      (): Promise<ConversationSnapshot> =>
        host.page.evaluate((id) => window.openbot.agent.readConversation(id), agentId),
      (snapshot) => snapshot.activeTurnId === null,
    );
    await host.page.evaluate((id) => window.openbot.agent.deleteAgent(id), value.agentId);
  }
  if (value.folderId)
    await host.page.evaluate(
      (sectionId) => window.openbot.agent.mutateSidebarLayout({ type: "delete", sectionId }),
      value.folderId,
    );
  return true;
}
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: UI_WAIT_MS }));
  const extensionId = new URL(worker.url()).host;
  report.extensionId = extensionId;
  await capturedEvent((event) => event.name === "extension_installed", "extension_installed");
  await worker.evaluate(`chrome.storage.local.set({ "${ANALYTICS_CHOICE_KEY}": { enabled: true, at: Date.now() } })`);
  const agentName = await host.page.evaluate(async (id) => {
    const found = (await window.openbot.agent.listAgents()).find((candidate) => candidate.id === id);
    if (!found) throw new Error(`Unknown agent: ${id}`);
    return found.name;
  }, agentId);

  const web = await context.newPage();
  web.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
  await web.goto(`${authApi}/app`);
  await web.getByRole("textbox", { name: english("account.login.email") }).fill(email);
  await web.getByRole("button", { name: english("account.login.sendCode") }).click();
  const codeLine = web.getByText(/^Development code: /);
  await codeLine.waitFor({ timeout: UI_WAIT_MS });
  const code = (await codeLine.textContent())?.replace(/^Development code: /, "").replace(/[^A-Za-z0-9]/g, "");
  assert.ok(code && code.length === 8, "The web app shows no development code.");
  await web.keyboard.type(code);
  await web.waitForFunction(() => !document.querySelector(".account-login-screen"), null, { timeout: 60_000 });
  const refused = await web.evaluate(async () => {
    const response = await fetch("/api/browser/extension/code", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-OpenBot-Browser": "1" },
      body: JSON.stringify({ extensionId: "not-an-extension", clientChallenge: "A".repeat(43) }),
    });
    const body = await response.json();
    return { status: response.status, code: body?.error?.code };
  });
  assert.deepEqual(refused, { status: 403, code: "browser_extension_not_allowed" }, "A bad extension id got a code.");
  await web.close();

  const page = await context.newPage();
  panel = page;
  page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const signInButton = page.getByRole("button", { name: english("extension.signIn.withWeb") });
  const signInAddresses: string[] = [];
  context.on("page", (opened) => signInAddresses.push(`page: ${opened.url()}`));
  async function answerSignIn(choice: string): Promise<void> {
    const opened = context.waitForEvent("page", {
      predicate: (candidate) => candidate.url().includes("extension=") && !candidate.url().includes("silent=1"),
      timeout: UI_WAIT_MS,
    });
    await signInButton.click();
    const window = await opened;
    window.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
    window.on("framenavigated", (frame) => {
      if (frame === window.mainFrame()) signInAddresses.push(`${choice}: ${frame.url()}`);
    });
    signInAddresses.push(`${choice} opened: ${window.url()}`);
    await window.getByRole("heading", { name: english("webClient.extension.title") }).waitFor({ timeout: 60_000 });
    await window.waitForFunction(() => !document.querySelector(".app-loading"), null, { timeout: 60_000 });
    await shot(window, choice === "allow" ? "0-allow" : "0-cancel").catch((error: unknown) => {
      throw new Error(`The sign-in window changed: ${signInAddresses.join(" | ")}`, { cause: error });
    });
    await window
      .getByRole("button", {
        name: choice === "allow" ? english("webClient.extension.allow") : english("common.cancel"),
      })
      .click();
  }
  await signInButton.waitFor({ timeout: UI_WAIT_MS });
  await shot(page, "0-sign-in");
  await answerSignIn("cancel");
  await page.getByText(english("extension.signIn.cancelled")).waitFor({ timeout: UI_WAIT_MS });
  await answerSignIn("allow");
  const serverTitle = page.getByRole("button", { name: english("extension.home.serverMenu") });
  await serverTitle.waitFor({ timeout: 60_000 });
  const hostName = ((await serverTitle.textContent()) ?? "").trim();
  const agentButton = page.getByRole("button", { name: new RegExp(`^${literal(agentName)}\\b`) }).first();
  await agentButton.waitFor({ timeout: UI_WAIT_MS });
  report.signIn = { invalidExtensionRefused: true, cancelShown: true, homeShowsServer: true, homeShowsAgent: true };
  await shot(page, "1-home");

  await agentButton.click();
  const composer = page.getByRole("textbox", { name: english("extension.chat.ask", { name: agentName }) });
  await composer.waitFor({ timeout: UI_WAIT_MS });
  await composer.fill(chatText);
  await composer.press("Enter");
  const hostChat = await waitFor(
    host.page,
    "the host has the extension message and its answer",
    (): Promise<ConversationSnapshot> => host.page.evaluate((id) => window.openbot.agent.readConversation(id), agentId),
    (snapshot) => {
      const index = snapshot.messages.findIndex((message) => message.text.includes(chatText));
      return (
        index >= 0 &&
        snapshot.activeTurnId === null &&
        snapshot.messages.slice(index + 1).some((message) => message.author === "assistant" && message.text.trim())
      );
    },
  );
  const answer = hostChat.messages
    .slice(hostChat.messages.findIndex((message) => message.text.includes(chatText)) + 1)
    .findLast((message) => message.author === "assistant" && message.text.trim());
  assert.ok(answer, "The host has no answer.");
  await page.getByText(answer.text.trim().slice(0, 40), { exact: false }).first().waitFor({ timeout: UI_WAIT_MS });
  report.mainChat = { messageOnHost: true, answerShown: true };
  await shot(page, "2-main-chat");

  const agentTitle = () =>
    host.page.evaluate(
      async (id) => (await window.openbot.agent.listAgents()).find((entry) => entry.id === id)?.title ?? "",
      agentId,
    );
  const oldTitle = await agentTitle();
  const newTitle = `Extension title ${run}`;
  await page.getByRole("button", { name: english("conversation.header.settings") }).click();
  const nameField = page.getByRole("textbox", { name: english("agentSettings.nameLabel") });
  await nameField.waitFor({ timeout: 60_000 });
  const settingsShowName = (await nameField.inputValue()) === agentName;
  await shot(page, "2b-agent-settings");
  const titleField = page.getByRole("textbox", { name: english("agentSettings.agentTitleLabel") });
  await titleField.fill(newTitle);
  await titleField.blur();
  await waitFor(host.page, "the host has the new title", agentTitle, (title) => title === newTitle);
  await titleField.fill(oldTitle);
  await titleField.blur();
  await waitFor(host.page, "the host has the old title again", agentTitle, (title) => title === oldTitle);
  await page
    .getByRole("button", { name: english("agentSettings.closeDetails") })
    .first()
    .click();
  await composer.waitFor({ timeout: UI_WAIT_MS });
  report.settings = { nameShown: settingsShowName, titleSaved: true, titleRestored: true };
  assert.ok(settingsShowName, "The settings panel does not show the agent's name.");

  const before = new Set(
    (await host.page.evaluate((id) => window.openbot.agent.listTasks(id), agentId)).tasks.map((entry) => entry.id),
  );
  await page.getByRole("button", { name: english("extension.chat.threadsMenu", { name: agentName }) }).click();
  await page.getByRole("menuitem", { name: english("extension.chat.newThread") }).click();
  await composer.fill(threadText);
  await composer.press("Enter");
  const tasks = await waitFor(
    host.page,
    "the host lists the extension thread",
    (): Promise<AgentTasksSnapshot> => host.page.evaluate((id) => window.openbot.agent.listTasks(id), agentId),
    (snapshot) => snapshot.tasks.some((task) => !before.has(task.id)),
    90_000,
  );
  const task = tasks.tasks.find((entry) => !before.has(entry.id));
  assert.ok(task, "The host has no thread for the extension message.");
  const taskInput = { agentId, taskId: task.id };
  await waitFor(
    host.page,
    "the thread has the message",
    (): Promise<ConversationSnapshot> => host.page.evaluate((value) => window.openbot.agent.readTask(value), taskInput),
    (snapshot) => snapshot.messages.some((message) => message.text.includes(threadText)),
  );
  const header = page.getByRole("button", { name: english("extension.chat.threadsMenu", { name: agentName }) });
  await header.getByText(task.title.slice(0, 20), { exact: false }).waitFor({ timeout: UI_WAIT_MS });
  report.thread = { taskId: task.id, messageOnHost: true, headerNamesThread: true };
  await shot(page, "3-thread");

  const mic = page.getByRole("button", { name: english("extension.chat.dictation.start") });
  await mic.waitFor({ timeout: UI_WAIT_MS });
  await composer.fill("");
  await mic.click();
  await page.getByRole("status").getByText("0:04").waitFor({ timeout: UI_WAIT_MS });
  await shot(page, "4-dictation-listening");
  await page.getByRole("button", { name: english("extension.chat.dictation.stop") }).click();
  await page.waitForFunction(
    (label) =>
      (document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)?.value ?? "").trim() !== "",
    english("extension.chat.ask", { name: agentName }),
    { timeout: 150_000 },
  );
  const transcript = await composer.inputValue();
  const draftHasWords = /summar/i.test(transcript) && /page/i.test(transcript);
  report.dictation = { micShown: true, transcript, draftHasWords };
  await shot(page, "5-dictation-text");
  assert.ok(draftHasWords, `The draft does not have the spoken words: ${transcript}`);
  await composer.fill("");

  await page.getByRole("button", { name: english("common.back"), exact: true }).click();
  const createMenu = page.getByRole("button", { name: english("sidebar.new.menuWithChannel") });
  const createButton = page.getByRole("button", { name: english("common.create"), exact: true });
  await createMenu.click();
  await page.getByRole("menuitem", { name: english("sidebar.new.agent") }).waitFor({ timeout: UI_WAIT_MS });
  await shot(page, "9-create-menu");
  await page.getByRole("menuitem", { name: english("sidebar.new.section") }).click();
  await page.getByRole("textbox", { name: english("sidebar.section.newNameLabel") }).fill(folderName);
  await createButton.click();
  const layout = await waitFor(
    host.page,
    "the host has the folder",
    () => host.page.evaluate(() => window.openbot.agent.getSidebarLayout()),
    (value) => value.sections.some((section) => section.name === folderName),
  );
  made.folderId = layout.sections.find((section) => section.name === folderName)?.id ?? null;
  await page.getByRole("button", { name: folderName }).waitFor({ timeout: UI_WAIT_MS });

  await createMenu.click();
  await page.getByRole("menuitem", { name: english("sidebar.new.channel") }).click();
  await page.getByRole("textbox", { name: english("channel.form.name") }).fill(channelName);
  await page.locator("label").filter({ hasText: agentName }).first().click();
  await shot(page, "10-new-channel");
  await createButton.click();
  const channelComposer = page.getByRole("textbox", { name: english("extension.channel.ask", { name: channelName }) });
  await channelComposer.waitFor({ timeout: UI_WAIT_MS });
  const channels = await waitFor(
    host.page,
    "the host has the channel",
    () => host.page.evaluate(() => window.openbot.agent.listChannels()),
    (value) => value.some((channel) => channel.name === channelName),
  );
  const channel = channels.find((entry) => entry.name === channelName);
  assert.ok(channel, "The host has no channel.");
  made.channelId = channel.id;
  const channelOnHost = channel.members.some((member) => member.agentId === agentId);
  await channelComposer.fill(channelText);
  await channelComposer.press("Enter");
  const channelPage = await waitFor(
    host.page,
    "the channel has the message and an answer",
    () => host.page.evaluate((channelId) => window.openbot.agent.readChannel({ channelId }), channel.id),
    (value) => {
      const index = value.messages.findIndex((entry) => entry.message.text.includes(channelText));
      return (
        index >= 0 &&
        value.messages.slice(index + 1).some((entry) => entry.author.kind === "agent" && entry.message.text.trim())
      );
    },
    180_000,
  );
  const channelAnswer = channelPage.messages
    .slice(channelPage.messages.findIndex((entry) => entry.message.text.includes(channelText)) + 1)
    .findLast((entry) => entry.author.kind === "agent" && entry.message.text.trim());
  assert.ok(channelAnswer, "The channel has no answer.");
  await page.getByText(channelAnswer.message.text.trim(), { exact: true }).first().waitFor({ timeout: UI_WAIT_MS });
  const own = channelPage.messages.find((entry) => entry.message.text.includes(channelText));
  const ownMessageUnlabelled =
    own?.author.kind === "member" &&
    (await page.getByRole("button", { name: own.author.name, exact: true }).count()) === 0;
  await shot(page, "11-channel-chat");

  await page.getByRole("button", { name: english("common.back"), exact: true }).click();
  await createMenu.click();
  await page.getByRole("menuitem", { name: english("sidebar.new.agent") }).click();
  const agentNameField = page.getByRole("textbox", { name: english("agent.setup.name") });
  await agentNameField.fill(newAgentName);
  await shot(page, "12-new-agent");
  await page.getByRole("button", { name: english("agent.setup.create") }).click();
  const newAgent = await waitFor(
    host.page,
    "the host has the new agent",
    async () =>
      (await host.page.evaluate(() => window.openbot.agent.listAgents())).find((entry) => entry.name === newAgentName),
    (value) => value !== undefined,
  );
  made.agentId = newAgent?.id ?? null;
  await page
    .getByRole("textbox", { name: english("extension.chat.ask", { name: newAgentName }) })
    .waitFor({ timeout: UI_WAIT_MS });
  await shot(page, "13-new-agent-chat");
  await page.getByRole("button", { name: english("common.back"), exact: true }).click();
  await shot(page, "14-home-folder-channel");
  report.create = {
    folderOnHost: made.folderId !== null,
    channelOnHost,
    channelMessageOnHost: true,
    channelAnswerShown: true,
    ownMessageUnlabelled,
    agentOnHost: made.agentId !== null,
    agentChatOpened: true,
    cleanedUp: await removeMade(),
  };
  assert.ok(channelOnHost, "The channel does not have the chosen agent.");
  assert.ok(ownMessageUnlabelled, "The panel shows the person's own channel message as another member's.");

  const shareFixture = await context.newPage();
  shareFixture.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
  const shareUrl = `${xBase}/share-fixture/`;
  await shareFixture.goto(shareUrl);
  await page.bringToFront();
  const presenceKey = "openbot.client-browser.presence.v1";
  const sitesKey = "openbot.client-browser.sites.v1";
  const readStored = (key: string) =>
    page.evaluate<string>(
      `chrome.storage.local.get("${key}").then((items) => JSON.stringify(items["${key}"] ?? null))`,
    );
  const fixtureGroup = () =>
    worker.evaluate<string>(
      `chrome.tabs.query({}).then(async (tabs) => { const tab = tabs.find((entry) => entry.url === ${JSON.stringify(shareUrl)}); if (!tab || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return "null"; const group = await chrome.tabGroups.get(tab.groupId); return JSON.stringify({ id: group.id, title: group.title }); })`,
    );
  const onWithoutSwitch = (
    await waitFor(
      host.page,
      "the server accepted the presence",
      () => readStored(presenceKey),
      (value) => value.includes('"sharing":true'),
    )
  ).includes('"sharing":true');
  const ungroupedBeforeUse = (await fixtureGroup()) === "null";
  await shot(page, "6b-home-shared");
  await toHome(page);
  await agentButton.click();
  await composer.waitFor({ timeout: UI_WAIT_MS });
  await composer.fill(shareText);
  await composer.press("Enter");
  const always = page.getByRole("button", { name: english("extension.browser.ask.allowAlways") });
  await always.waitFor({ timeout: 180_000 });
  await shot(page, "6b-approval-card");
  await always.click();
  await shareFixture.waitForFunction(() => document.body.dataset.clicked !== undefined, null, { timeout: 180_000 });
  const group = await waitFor(host.page, "the page is in the OpenBot group", fixtureGroup, (value) => value !== "null");
  const inOpenBotGroup = JSON.parse(group).title === "OpenBot";
  const site = new URL(xBase).origin;
  const siteStored = JSON.parse(await readStored(sitesKey))?.[site] === "always";
  await waitFor(
    host.page,
    "the agent ended the shared tabs turn",
    (): Promise<ConversationSnapshot> => host.page.evaluate((id) => window.openbot.agent.readConversation(id), agentId),
    (snapshot) =>
      snapshot.activeTurnId === null && snapshot.messages.some((message) => message.text.includes(shareText)),
  );
  await page.getByRole("button", { name: english("common.back"), exact: true }).click();
  await serverTitle.click();
  await page.getByRole("menuitem", { name: english("extension.browser.title") }).click();
  await shot(page, "6b-shared-tabs-settings");
  await page
    .getByRole("button", { name: english("extension.browser.revokeSite", { site: new URL(xBase).host }) })
    .click();
  await page.getByText(english("extension.browser.noSites")).waitFor({ timeout: UI_WAIT_MS });
  const siteRevoked = JSON.parse(await readStored(sitesKey))?.[site] === undefined;
  await page.getByRole("button", { name: english("extension.browser.stop") }).click();
  const groupEnded =
    (await waitFor(host.page, "the group ended", fixtureGroup, (value) => value === "null")) === "null";
  await waitFor(
    host.page,
    "the server accepted the end of the presence",
    () => readStored(presenceKey),
    (value) => value.includes('"sharing":false'),
  );
  await serverTitle.click();
  await page.getByRole("menuitem", { name: english("extension.browser.share") }).click();
  const sharedAgain = (
    await waitFor(
      host.page,
      "the server accepted the presence again",
      () => readStored(presenceKey),
      (value) => value.includes('"sharing":true'),
    )
  ).includes('"sharing":true');
  report.sharedTabs = {
    onWithoutSwitch,
    ungroupedBeforeUse,
    sharedAgain,
    inOpenBotGroup,
    presenceAccepted: true,
    askShown: true,
    buttonClicked: true,
    siteStored,
    siteRevoked,
    groupEnded,
    presenceEnded: true,
  };
  assert.ok(ungroupedBeforeUse, "The page joined the OpenBot group before an agent used it.");
  assert.ok(inOpenBotGroup, "The page that the agent used is not in the OpenBot group.");
  assert.ok(sharedAgain, "Share tabs with agents did not turn sharing on again.");
  assert.ok(siteStored, "Always for this site did not store the site.");
  assert.ok(siteRevoked, "Remove did not forget the site.");
  await shareFixture.close();

  const service = await fetch(`${authApi}${X_PAGE_RULES_ROUTE}`).then((response) => response.json());
  const sameService = await fetch(`${authApi}${X_PAGE_RULES_ROUTE}?hash=${service.hash}`).then((response) =>
    response.json(),
  );
  const serviceRules = {
    answersRules: service.hash === (await xPageRulesHash(X_PAGE_RULES_DEFAULT)) && service.rules !== null,
    sameHashAnswersNull: sameService.hash === service.hash && sameService.rules === null,
  };
  assert.ok(serviceRules.answersRules && serviceRules.sameHashAnswersNull, "The rules route did not answer by hash.");
  const xAgent = () =>
    host.page.evaluate(
      async (listingId) =>
        (await window.openbot.agent.listAgents()).find((entry) => entry.marketplaceSource?.listingId === listingId)
          ?.id ?? null,
      X_AGENT_LISTING_ID,
    );
  const xPage = await context.newPage();
  xPage.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
  const replyBox = xPage.locator('[data-testid="tweetTextarea_0"]');
  const reply = xPage.locator('[data-testid="replyComposerSubmit"]');
  async function writeReply() {
    await xPage.goto(`${xBase}/x-fixture/bob/status/2`);
    await replyBox.click();
    await xPage.keyboard.type(`@OpenBot_ ${xQuestion}`);
  }
  let unchangedWithoutAgent: boolean | null = null;
  if (!(await xAgent())) {
    await writeReply();
    await waitFor(
      host.page,
      "the offscreen page is open",
      () => worker.evaluate<boolean>("chrome.offscreen.hasDocument()"),
      (open) => open,
    );
    const ready = await page.evaluate<boolean>(
      'chrome.runtime.sendMessage({ kind: "openbot-x-offscreen", action: "status" }).then((value) => value?.ready === true)',
    );
    await xPage.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    unchangedWithoutAgent = ready !== true && (await reply.getAttribute("data-openbot-x")) === null;
    await shot(xPage, "6-x-without-agent");
    assert.ok(unchangedWithoutAgent, "The reply button changed with no X agent on the host.");
    const seeded = spawnSync("bun", ["run", "marketplace:seed:local"], {
      cwd: resolve(EXTENSION, "../.."),
      stdio: "ignore",
    });
    assert.equal(seeded.status, 0, "The local Marketplace seed failed.");
    await host.page.evaluate(
      (listingId) =>
        window.openbot.marketplaceAgents.install({ listingId, timezone: "UTC", receiptId: crypto.randomUUID() }),
      X_AGENT_LISTING_ID,
    );
  }
  const xAgentId = await xAgent();
  assert.ok(xAgentId, "The X agent is not on the host.");
  const tasksBefore = new Set(
    (await host.page.evaluate((id) => window.openbot.agent.listTasks(id), xAgentId)).tasks.map((entry) => entry.id),
  );
  await writeReply();
  await xPage
    .locator('[data-testid="replyComposerSubmit"][data-openbot-x="armed"]')
    .waitFor({ timeout: 60_000 })
    .catch(async (error: unknown) => {
      const known = await page.evaluate<string>(
        'Promise.all([chrome.runtime.sendMessage({ kind: "openbot-x-offscreen", action: "status" }), chrome.storage.local.get("openbot.x-rules.v1")]).then((value) => JSON.stringify(value))',
      );
      throw new Error(`The reply button did not change. The extension knew: ${known}`, { cause: error });
    });
  await shot(xPage, "7-x-armed");
  const clickedAt = Date.now();
  await reply.click();
  await xPage.waitForFunction(() => document.body.dataset.posted !== undefined, null, { timeout: 5_000 });
  const posted = await xPage.evaluate(() => ({
    text: document.body.dataset.posted ?? "",
    at: Number(document.body.dataset.postedAt),
  }));
  await shot(xPage, "8-x-posted");
  const xTasks = await waitFor(
    host.page,
    "The X agent has a new thread",
    (): Promise<AgentTasksSnapshot> => host.page.evaluate((id) => window.openbot.agent.listTasks(id), xAgentId),
    (snapshot) => snapshot.tasks.some((entry) => !tasksBefore.has(entry.id)),
  );
  const xTask = xTasks.tasks.find((entry) => !tasksBefore.has(entry.id));
  assert.ok(xTask, "The X agent has no thread for the post.");
  const xThread = await waitFor(
    host.page,
    "the X agent thread has the post",
    (): Promise<ConversationSnapshot> =>
      host.page.evaluate((value) => window.openbot.agent.readTask(value), { agentId: xAgentId, taskId: xTask.id }),
    (snapshot) => snapshot.messages.some((entry) => entry.author === "user" && entry.text.includes(xQuestion)),
  );
  const sent = xThread.messages.find((entry) => entry.author === "user" && entry.text.includes(xQuestion));
  assert.ok(sent);
  const messageHasPostThreadAndWords =
    sent.text.includes("two eggs a day") &&
    sent.text.includes("Eggs are a superfood") &&
    sent.text.includes("my uncle, a cardiologist") &&
    sent.text.includes("@bob") &&
    sent.text.includes("https://pbs.twimg.com/media/egg.jpg") &&
    !sent.text.includes("@OpenBot_");
  const otherReplyLeftOut = !sent.text.includes("Carol thinks");
  const postedAtOnce = posted.text.includes(xQuestion) && posted.at - clickedAt < 5_000;
  const outboxKey = "openbot.x-outbox.v1";
  const outbox = () =>
    page.evaluate<number>(
      `chrome.storage.local.get("${outboxKey}").then((items) => (items["${outboxKey}"] ?? []).length)`,
    );
  await waitFor(host.page, "the queue of posts is empty", outbox, (count) => count === 0);
  report.x = {
    serviceRules,
    unchangedWithoutAgent,
    armedWithServedRules: true,
    xAgentId,
    taskId: xTask.id,
    messageHasPostThreadAndWords,
    otherReplyLeftOut,
    postedAtOnce,
    queueEmptyAfterSend: true,
  };
  assert.ok(messageHasPostThreadAndWords, `The X agent message is not complete: ${sent.text}`);
  assert.ok(otherReplyLeftOut, "The X agent message has the reply of another person.");
  assert.ok(postedAtOnce, "The page did not post the reply at once.");
  await xPage.close();

  const panelStayed = await page.getByRole("button", { name: english("extension.home.serverMenu") }).isVisible();
  report.x = { ...report.x, panelStayed };
  assert.ok(panelStayed, "The panel left the home screen when the reply was posted on X.");
  const offline = page.getByText(english("extension.connection.offline", { server: hostName }));
  await offline.waitFor({ state: "hidden", timeout: 45_000 }).catch(async (error: unknown) => {
    await shot(page, "x-panel-offline");
    const contexts = await worker.evaluate<string>(
      "chrome.runtime.getContexts({}).then((list) => JSON.stringify(list.map((entry) => [entry.contextType, entry.documentUrl])))",
    );
    throw new Error(`The panel went offline after the X post, and it did not come back. Open: ${contexts}`, {
      cause: error,
    });
  });

  const queuedText = `Queued post ${run}`;
  const queuedId = crypto.randomUUID();
  const queued = {
    id: queuedId,
    payload: {
      message: queuedText,
      pageUrl: `${xBase}/x-fixture/bob/status/2`,
      replyTo: 0,
      posts: [
        {
          authorName: "Bob",
          handle: "@bob",
          time: "2026-11-19T10:05:00.000Z",
          url: `${xBase}/x-fixture/bob/status/2`,
          text: "Studies show two eggs a day cut heart risk by 40%.",
          article: "",
          media: [],
        },
      ],
    },
    createdAt: Date.now(),
    attempts: 1,
    nextAt: Date.now() + 3_600_000,
    error: "The server is offline.",
  };
  await page.evaluate(`chrome.storage.local.set({ "${outboxKey}": [${JSON.stringify(queued)}] })`);
  const waitingLine = page.getByRole("button", { name: english("extension.x.outbox.title", { count: 1 }) });
  await waitingLine.waitFor({ timeout: UI_WAIT_MS });
  await shot(page, "9-x-waiting");
  const queuedBefore = new Set(
    (await host.page.evaluate((id) => window.openbot.agent.listTasks(id), xAgentId)).tasks.map((entry) => entry.id),
  );
  await page.getByRole("button", { name: english("extension.x.sendNow") }).click();
  await waitingLine.waitFor({ state: "hidden", timeout: 60_000 });
  const queuedTasks = await waitFor(
    host.page,
    "The X agent has a thread for the queued post",
    (): Promise<AgentTasksSnapshot> => host.page.evaluate((id) => window.openbot.agent.listTasks(id), xAgentId),
    (snapshot) => snapshot.tasks.some((entry) => !queuedBefore.has(entry.id)),
  );
  const queuedTask = queuedTasks.tasks.find((entry) => !queuedBefore.has(entry.id));
  assert.ok(queuedTask);
  await waitFor(
    host.page,
    "the queued thread has the post",
    (): Promise<ConversationSnapshot> =>
      host.page.evaluate((value) => window.openbot.agent.readTask(value), { agentId: xAgentId, taskId: queuedTask.id }),
    (snapshot) => snapshot.messages.some((entry) => entry.author === "user" && entry.text.includes(queuedText)),
  );
  report.xQueue = { waitingShown: true, sentByRetry: true, queueEmpty: (await outbox()) === 0 };
  assert.ok(report.xQueue.queueEmpty, "The queue keeps a post that the server has.");
  await toHome(page);

  await toHome(page);
  const accountId = await page.evaluate<string>(
    `chrome.storage.local.get("openbot.session.v1").then((items) => items["openbot.session.v1"].user.id)`,
  );
  await serverTitle.click();
  const analyticsSwitch = page.getByRole("menuitemcheckbox", { name: english("settings.analytics.title") });
  await analyticsSwitch.waitFor({ timeout: UI_WAIT_MS });
  assert.equal(await analyticsSwitch.getAttribute("aria-checked"), "true", "Analytics is not linked at the start.");
  await analyticsSwitch.click();
  const optOut = await capturedEvent(
    (event) => event.name === "analytics_preference_changed",
    "analytics_preference_changed",
  );
  assert.equal(await analyticsSwitch.getAttribute("aria-checked"), "false", "The switch did not turn off.");
  await page.getByRole("menuitem", { name: english("extension.home.signOut") }).click();
  await signInButton.waitFor({ timeout: UI_WAIT_MS });
  const signedOut = await capturedEvent(
    (event) => event.name === "account_sign_out" && captured.indexOf(event) > captured.indexOf(optOut),
    "account_sign_out after the opt-out",
  );
  const windows: string[] = [];
  const seeWindow = (opened: Page) => windows.push(opened.url());
  context.on("page", seeWindow);
  await signInButton.click();
  await serverTitle.waitFor({ timeout: 60_000 });
  context.off("page", seeWindow);
  const askedPerson = windows.some((url) => url.includes("extension=") && !url.includes("silent=1"));
  report.silentSignIn = { signedIn: true, noWindow: !askedPerson };
  await shot(page, "9b-signed-in-again");
  assert.ok(!askedPerson, `The second sign-in opened the sign-in window: ${windows.join(", ")}`);

  const restartText = `Restart post ${run}`;
  const restartPost = {
    ...queued,
    id: crypto.randomUUID(),
    payload: { ...queued.payload, message: restartText },
    createdAt: Date.now() - 2 * 86_400_000,
    attempts: 3,
    reachedAt: null,
    nextAt: Date.now() + 3_600_000,
  };
  await page.evaluate(`chrome.storage.local.set({ "${outboxKey}": [${JSON.stringify(restartPost)}] })`);
  const restartBefore = new Set(
    (await host.page.evaluate((id) => window.openbot.agent.listTasks(id), xAgentId)).tasks.map((entry) => entry.id),
  );
  await context.close();
  context = await chromium.launchPersistentContext(profile, launchOptions);
  const listXTasks = (): Promise<AgentTasksSnapshot> =>
    host.page.evaluate((id) => window.openbot.agent.listTasks(id), xAgentId);
  const restartArrived = (snapshot: AgentTasksSnapshot) => snapshot.tasks.some((entry) => !restartBefore.has(entry.id));
  let deliveredBy: "start" | "panel" = "start";
  let restartTasks = await waitFor(
    host.page,
    "The X agent has the post after the start",
    listXTasks,
    restartArrived,
    20_000,
  ).catch(() => null);
  const reopened = await context.newPage();
  panel = reopened;
  reopened.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
  await reopened.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  if (!restartTasks) {
    deliveredBy = "panel";
    restartTasks = await waitFor(
      host.page,
      "The X agent has the post after the panel opened",
      listXTasks,
      restartArrived,
      120_000,
    ).catch(async (error: unknown) => {
      const restarted = context.serviceWorkers()[0];
      const known = restarted
        ? await restarted.evaluate<string>(
            `Promise.all([chrome.runtime.getContexts({}), chrome.storage.local.get("${outboxKey}")]).then(([list, items]) => JSON.stringify({ contexts: list.map((entry) => [entry.contextType, entry.documentUrl]), outbox: items["${outboxKey}"] }))`,
          )
        : "no worker";
      throw new Error(`The post did not go out after the restart. The extension had: ${known}`, { cause: error });
    });
  }
  const restartTask = restartTasks.tasks.find((entry) => !restartBefore.has(entry.id));
  assert.ok(restartTask);
  await waitFor(
    host.page,
    "the thread after the restart has the post",
    (): Promise<ConversationSnapshot> =>
      host.page.evaluate((value) => window.openbot.agent.readTask(value), {
        agentId: xAgentId,
        taskId: restartTask.id,
      }),
    (snapshot) => snapshot.messages.some((entry) => entry.author === "user" && entry.text.includes(restartText)),
  );
  const queueAfterRestart = await reopened.evaluate<number>(
    `chrome.storage.local.get("${outboxKey}").then((items) => (items["${outboxKey}"] ?? []).length)`,
  );
  report.xRestart = { sentAfterRestart: true, deliveredBy, twoDayOldKept: true, queueEmpty: queueAfterRestart === 0 };
  assert.equal(queueAfterRestart, 0, "The queue keeps the post after the restart sent it.");

  await shot(reopened, "10-x-after-restart");
  await toHome(reopened);
  const reopenedServer = reopened.getByRole("button", { name: english("extension.home.serverMenu") });
  await reopenedServer.waitFor({ timeout: 60_000 });
  await reopenedServer.click();
  await reopened.getByRole("menuitem", { name: english("extension.home.signOut") }).click();
  await reopened.getByRole("button", { name: english("extension.signIn.withWeb") }).waitFor({ timeout: UI_WAIT_MS });
  report.signOut = { signInShown: true };

  const tracks = captured.filter((event) => event.type === "track");
  const names = [...new Set(tracks.map((event) => event.name))].sort();
  const leaks = captured.flatMap((event) =>
    [run, new URL(xBase).host, ...(event.type === "track" ? [email] : [])]
      .filter((secret) => event.raw.includes(secret))
      .map((secret) => `${event.type} ${event.name}: ${secret}`),
  );
  report.analytics = {
    events: names,
    allExtensionSurface: tracks.every(
      (event) =>
        event.clientId !== null &&
        event.surface === "extension" &&
        event.generation === 1 &&
        event.platform === "chrome",
    ),
    optOutLinked: optOut.profileId === accountId,
    afterOptOutAnonymous: signedOut.profileId.startsWith("install-"),
    leaks,
  };
  for (const expected of [
    "extension_installed",
    "extension_opened",
    "account_sign_in_completed",
    "message_send",
    "voice_transcription",
    "folder_action",
    "channel_action",
    "agent_action",
    "x_reply_action",
    "browser_sharing_action",
    "browser_sharing_ask",
    "analytics_preference_changed",
    "account_sign_out",
  ])
    assert.ok(names.includes(expected), `No ${expected} event: ${names.join(", ")}`);
  assert.ok(report.analytics.allExtensionSurface, "An event has no extension surface.");
  assert.ok(report.analytics.optOutLinked, "The opt-out event is not linked to the account.");
  assert.ok(report.analytics.afterOptOutAnonymous, "An event after the opt-out has the account.");
  assert.deepEqual(leaks, [], "An analytics event has user content.");
  assert.deepEqual(report.pageErrors, [], "The panel threw errors.");
  report.passed = true;
} catch (error) {
  if (panel) await shot(panel, "failure").catch(() => undefined);
  await removeMade().catch(() => undefined);
  throw error;
} finally {
  const path = writeReport(NAME, report);
  process.stdout.write(`${path}\n`);
  await context.close().catch(() => undefined);
  rmSync(profile, { recursive: true, force: true });
  await xServer.stop(true);
  await captureServer.stop(true);
  await host.close().catch(() => undefined);
}
