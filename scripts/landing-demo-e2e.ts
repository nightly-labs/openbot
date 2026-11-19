import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { type Browser, chromium, type FrameLocator, type Page } from "playwright-core";

const logger = createOpenBotLogger("landing-demo-e2e");

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/landing-demo");
const option = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const browserExecutable = option("browser-executable");
const givenOrigin = option("origin");

const TIME_ZONE = "Europe/Warsaw";
const IFRAME = 'iframe[title="Interactive OpenBot application preview"]';
const AGENTS = ["Atlas", "Scout", "Forge", "Pulse"] as const;
const QUESTION = "Which channels should the launch use?";
const AUTO_ANSWER = "Blog and changelog";
const SCENE_PROMPTS: Record<string, string> = {
  Scout: "Could anything steal our news on Friday?",
  Forge: "Show me the launch banner before it ships.",
  Pulse: "How did people react to the teaser?",
};
const SCENE_ANSWERS: Record<string, string> = {
  Scout: "Only one event is close, and it does not clash.",
  Forge: "Here is the banner from PR #418:",
  Pulse: "The teaser is doing well. Most replies ask about offline mode.",
};
const CHANNEL_LAST_LINE = "Nobody else launches on Friday morning. I will post here if that changes.";
const SCENE_ENDINGS: Record<string, string> = {
  Scout: "I will check again on Thursday evening and tell Atlas if anything moves.",
  Forge: "Approve the PR and I will merge it on Friday at 9:45.",
  Pulse: "I suggest that the X thread answers the offline question in the first post.",
};
const TYPED_MESSAGE = "Watch the replies about pricing too.";
const TYPED_REPLY = "Good call. I will watch the reactions to this and tell you if anything changes before Friday.";
const SCENE_TIMEOUT_MS = 40_000;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const freePort = () =>
  new Promise<number>((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      server.close(() => done(address.port));
    });
  });

function waitForSite(child: ChildProcess, address: string): Promise<void> {
  return new Promise((done, fail) => {
    let output = "";
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(address)) done();
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.once("exit", () => fail(new Error("The site's development server stopped before it listened.")));
  });
}

interface OpenedDemo {
  page: Page;
  app: FrameLocator;
  errors: string[];
}

async function openDemo(
  browser: Browser,
  origin: string,
  viewport: { width: number; height: number },
  reducedMotion: "reduce" | "no-preference",
): Promise<OpenedDemo> {
  const context = await browser.newContext({ viewport, timezoneId: TIME_ZONE, reducedMotion, colorScheme: "dark" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`${origin}/`);
  await page.locator(".landing-app-preview").scrollIntoViewIfNeeded();
  await page.locator('.landing-app-preview[data-preview-state="shown"]').waitFor({ timeout: SCENE_TIMEOUT_MS });
  const app = page.frameLocator(IFRAME);
  assert.equal(await app.locator(".app-loading").count(), 0, "A loading screen covers the shown demo.");
  return { page, app, errors };
}

const contextMeter = (app: FrameLocator) => app.locator('[aria-label^="Context "]').first();
const modelLabel = async (app: FrameLocator) =>
  (await app.getByRole("button", { name: /^Agent model: / }).getAttribute("aria-label")) ??
  (await app.getByRole("button", { name: /^Agent model: / }).textContent()) ??
  "";
const agentRow = (app: FrameLocator, name: string) =>
  app.getByRole("navigation", { name: "Chat list" }).getByRole("button", { name: new RegExp(`^${name}, `) });
const chatList = (app: FrameLocator) => app.getByRole("navigation", { name: "Chat list" });
const CHANNEL_ROW = /^launch, Friday launch\. /u;
const SECTIONS = ["Launch", "Research"] as const;
const launchPlan = (app: FrameLocator) =>
  app.getByRole("article", { name: "Message from Atlas" }).filter({
    has: app.getByRole("heading", { name: "Friday's launch plan" }),
  });

async function checkRoster(app: FrameLocator): Promise<string[]> {
  const rows = chatList(app).getByRole("button");
  await rows.first().waitFor();
  const names = (await rows.allTextContents()).map((text) => text.trim());
  for (const agent of AGENTS) assert.equal(await agentRow(app, agent).count(), 1, `${agent}: ${names}`);
  assert.equal(await chatList(app).getByRole("button", { name: CHANNEL_ROW }).count(), 1, names.join(" | "));
  for (const section of SECTIONS) {
    assert.equal(await chatList(app).getByRole("region", { name: section }).count(), 1, section);
  }
  assert.equal(await chatList(app).getByRole("region", { name: "People" }).count(), 0, names.join(" | "));
  assert.equal(await app.getByText("Oh My Pi").count(), 0);
  assert.equal(await app.getByText("New update available").count(), 0);
  assert.equal(await app.getByText(/^Your time zone is now/u).count(), 0);
  return names;
}

const port = givenOrigin ? 0 : await freePort();
const origin = givenOrigin ?? `http://127.0.0.1:${port}`;
const site = givenOrigin
  ? null
  : spawn(
      process.execPath,
      [
        resolve(ROOT, "scripts/run-development.ts"),
        "api",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--strictPort",
      ],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
let siteOutput = "";
site?.stdout?.on("data", (chunk: Buffer) => {
  siteOutput += chunk.toString();
});
site?.stderr?.on("data", (chunk: Buffer) => {
  siteOutput += chunk.toString();
});

try {
  if (site) await waitForSite(site, origin);
  const browser = await chromium.launch(
    browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
  );
  try {
    const desktop = await openDemo(browser, origin, { width: 1440, height: 900 }, "no-preference");
    const { app } = desktop;
    const roster = await checkRoster(app);
    const contextBefore = (await contextMeter(app).getAttribute("aria-label")) ?? "";

    const choices = app.getByRole("group", { name: QUESTION });
    await choices.waitFor({ timeout: SCENE_TIMEOUT_MS });
    await desktop.page.locator(".landing-app-preview").screenshot({ path: resolve(OUT, "desktop-question.png") });
    for (const channel of ["LinkedIn", "Product Hunt"]) {
      await choices.locator(`input[value="${channel}"]`).check();
    }
    await app.getByRole("button", { name: "Done", exact: true }).click();
    const sent = app.getByRole("region", { name: "Answers sent" });
    for (const channel of ["LinkedIn", "Product Hunt"]) await sent.getByText(channel).waitFor();

    const plan = launchPlan(app);
    await plan.waitFor({ timeout: SCENE_TIMEOUT_MS });
    const reactions = plan.getByRole("group", { name: /^Reactions: / });
    await reactions.waitFor({ timeout: SCENE_TIMEOUT_MS });
    const reactionLabel = (await reactions.getAttribute("aria-label")) ?? "";
    const channels = await plan.getByRole("row").allTextContents();
    assert.ok(
      channels.some((row) => row.startsWith("LinkedIn")),
      channels.join(" | "),
    );
    assert.ok(
      channels.some((row) => row.startsWith("Product Hunt") && row.includes("—")),
      channels.join(" | "),
    );
    assert.ok(!channels.some((row) => row.startsWith("Newsletter")), channels.join(" | "));
    await app.getByRole("button", { name: "Send message" }).waitFor();
    await app.locator(`[aria-label^="Context "]:not([aria-label="${contextBefore}"])`).waitFor();
    const contextAfter = (await contextMeter(app).getAttribute("aria-label")) ?? "";
    const unread: Record<string, boolean> = {};
    for (const agent of AGENTS.slice(1)) {
      unread[agent] = (await agentRow(app, agent).textContent())?.includes("1 new reply") === true;
    }
    assert.deepEqual(unread, { Scout: true, Forge: true, Pulse: true });
    const models: Record<string, string> = { Atlas: await modelLabel(app) };
    assert.ok(models.Atlas?.includes("Claude Opus 5.5"), models.Atlas);
    await desktop.page.locator(".landing-app-preview").screenshot({ path: resolve(OUT, "desktop-autoplay-end.png") });

    for (const agent of AGENTS.slice(1)) {
      await agentRow(app, agent).click();
      await app.getByRole("heading", { name: agent, level: 1 }).waitFor();
      const prompt = SCENE_PROMPTS[agent];
      const answer = SCENE_ANSWERS[agent];
      assert.ok(prompt && answer);
      await app.getByRole("article", { name: "Message from You" }).filter({ hasText: prompt }).waitFor();
      await app.getByText(answer).waitFor({ timeout: SCENE_TIMEOUT_MS });
      models[agent] = await modelLabel(app);
      await desktop.page
        .locator(".landing-app-preview")
        .screenshot({ path: resolve(OUT, `desktop-${agent.toLowerCase()}.png`) });
    }
    assert.equal(new Set(Object.values(models)).size, AGENTS.length, JSON.stringify(models));

    await app.getByRole("button", { name: "Send message" }).waitFor();
    const composer = app.getByRole("textbox", { name: "Message Pulse" });
    await composer.fill(TYPED_MESSAGE);
    await composer.press("Enter");
    await app.getByText(TYPED_REPLY).waitFor({ timeout: SCENE_TIMEOUT_MS });
    await app.getByRole("button", { name: "Send message" }).waitFor();
    assert.equal(await app.getByText(/Mock reply/u).count(), 0);
    await desktop.page.locator(".landing-app-preview").screenshot({ path: resolve(OUT, "desktop-typed-reply.png") });

    const leftUnread: Record<string, string> = {};
    for (const agent of ["Scout", "Forge"]) {
      leftUnread[agent] = (await agentRow(app, agent).textContent())?.match(/\d+ new repl(y|ies)/u)?.[0] ?? "none";
      await agentRow(app, agent).click();
      await app.getByRole("heading", { name: agent, level: 1 }).waitFor();
      const ending = SCENE_ENDINGS[agent];
      assert.ok(ending);
      await app.getByText(ending).waitFor();
      assert.equal(await app.getByText(ending).count(), 1, agent);
      assert.equal(await app.getByRole("button", { name: "Stop agent" }).count(), 0, agent);
    }

    await chatList(app).getByRole("button", { name: CHANNEL_ROW }).click();
    await app.getByLabel("Conversation").getByText(CHANNEL_LAST_LINE).waitFor();
    await desktop.page.locator(".landing-app-preview").screenshot({ path: resolve(OUT, "desktop-channel.png") });
    assert.deepEqual(desktop.errors, []);
    await desktop.page.context().close();

    const early = await openDemo(browser, origin, { width: 1440, height: 900 }, "no-preference");
    await early.app.getByRole("button", { name: /^Friday's launch, split across the team\./u }).waitFor({
      timeout: SCENE_TIMEOUT_MS,
    });
    await agentRow(early.app, "Scout").click();
    await early.app.getByRole("heading", { name: "Scout", level: 1 }).waitFor();
    await agentRow(early.app, "Atlas")
      .filter({ hasText: /new repl/u })
      .waitFor();
    await early.app.getByText(SCENE_ANSWERS.Scout ?? "").waitFor({ timeout: SCENE_TIMEOUT_MS });
    await agentRow(early.app, "Atlas").click();
    await launchPlan(early.app)
      .getByRole("group", { name: /^Reactions: / })
      .waitFor();
    await early.app.getByRole("region", { name: "Answers sent" }).getByText(AUTO_ANSWER).waitFor();
    assert.equal(await early.app.getByRole("button", { name: "Done", exact: true }).count(), 0);
    assert.equal(await early.app.getByRole("button", { name: "Stop agent" }).count(), 0);
    await early.page.locator(".landing-app-preview").screenshot({ path: resolve(OUT, "desktop-left-mid-scene.png") });
    assert.deepEqual(early.errors, []);
    await early.page.context().close();

    const mobile = await openDemo(browser, origin, { width: 390, height: 844 }, "no-preference");
    const mobileList = await mobile.app.getByRole("navigation", { name: "Chat list" }).boundingBox();
    assert.ok(mobileList, "The phone chat list has no box.");
    const mobileAvatars: { agent: string; x: number; y: number }[] = [];
    for (const agent of AGENTS) {
      const box = await agentRow(mobile.app, agent).boundingBox();
      assert.ok(box, `${agent} has no box on the phone.`);
      assert.ok(
        box.y >= mobileList.y && box.y + box.height <= mobileList.y + mobileList.height,
        `${agent} is outside the phone agent row.`,
      );
      mobileAvatars.push({ agent, x: Math.round(box.x), y: Math.round(box.y) });
    }
    const avatarTops = mobileAvatars.map((avatar) => avatar.y);
    assert.ok(Math.max(...avatarTops) - Math.min(...avatarTops) < 8, JSON.stringify(mobileAvatars));
    await mobile.app
      .getByRole("region", { name: "Answers sent" })
      .getByText(AUTO_ANSWER)
      .waitFor({ timeout: SCENE_TIMEOUT_MS });
    await launchPlan(mobile.app)
      .getByRole("group", { name: /^Reactions: / })
      .waitFor({ timeout: SCENE_TIMEOUT_MS });
    await mobile.page.locator(".landing-app-preview").screenshot({ path: resolve(OUT, "mobile-autoplay-end.png") });
    await mobile.page.screenshot({ path: resolve(OUT, "mobile-page.png") });
    assert.deepEqual(mobile.errors, []);
    await mobile.page.context().close();

    const still = await openDemo(browser, origin, { width: 1440, height: 900 }, "reduce");
    const stillRoster = await checkRoster(still.app);
    const stillPlan = launchPlan(still.app);
    await stillPlan.getByRole("group", { name: /^Reactions: / }).waitFor();
    await still.app.getByRole("region", { name: "Answers sent" }).getByText(AUTO_ANSWER).waitFor();
    assert.equal(await still.app.getByRole("button", { name: "Done", exact: true }).count(), 0);
    assert.equal(await still.app.getByRole("button", { name: "Stop agent" }).count(), 0);
    await still.page.locator(".landing-app-preview").screenshot({ path: resolve(OUT, "desktop-reduced-motion.png") });
    assert.deepEqual(still.errors, []);
    await still.page.context().close();

    const report = {
      ok: true,
      timeZone: TIME_ZONE,
      roster,
      reducedMotionRoster: stillRoster,
      models,
      visitorAnswer: "LinkedIn, Product Hunt",
      launchPlanRows: channels,
      reactions: reactionLabel,
      context: { before: contextBefore, after: contextAfter },
      unread,
      unreadAfterLeavingMidStream: leftUnread,
      mobileAvatars,
      screenshots: [
        "desktop-question.png",
        "desktop-autoplay-end.png",
        "desktop-scout.png",
        "desktop-forge.png",
        "desktop-pulse.png",
        "desktop-typed-reply.png",
        "desktop-channel.png",
        "desktop-left-mid-scene.png",
        "mobile-autoplay-end.png",
        "mobile-page.png",
        "desktop-reduced-motion.png",
      ],
    };
    assert.notEqual(contextAfter, contextBefore);
    writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    logger.info(`Passed. Report: ${resolve(OUT, "report.json")}`);
  } finally {
    await browser.close();
  }
} catch (error) {
  if (site) writeFileSync(resolve(OUT, "site-output.log"), siteOutput);
  throw error;
} finally {
  if (site) {
    const exited = new Promise<void>((done) => (site.exitCode === null ? site.once("exit", () => done()) : done()));
    site.kill("SIGTERM");
    await exited;
  }
}
