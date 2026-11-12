// Chooses an agent in Settings > General > Open on launch on a running dev app, reloads the window,
// and checks that the window opens the chat of that agent and not the chat that it restores. Then it
// saves an agent that the server does not have, reloads again, and checks that the window keeps the
// chat that it restores. At the end it chooses "Last chat" again and checks that the value is gone.
// A reload starts the renderer as a launch does: the main process keeps the active server. Writes
// .openbot-build/startup-agent-chat/report.json and a screenshot of the setting. Needs
// `--allow-mutations`, because it changes the setting and the open chat.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { en } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import type { Page } from "playwright-core";
import { z } from "zod";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

const OUT = resolve(import.meta.dirname, "../.openbot-build/startup-agent-chat");
const STORAGE_KEY = "openbot:startup-agent-chat:v1";
const SELECTION_KEY = "openbot:selected-agent:v1";
const savedChatSchema = z.object({ serverId: z.string().min(1), agentId: z.string().min(1) });

interface Report {
  instance: string;
  result: "running" | "passed" | "failed";
  restoredChat?: string;
  options?: string[];
  saved?: z.infer<typeof savedChatSchema>;
  openedAfterReload?: string;
  missingAgent?: { opened: string; lastSelection: string | null };
  missingAgentOptions?: string[];
  cleared?: boolean;
  error?: string;
}

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "startup-agent-chat-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("startup-agent-chat-e2e");
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
const page = session.page;
mkdirSync(OUT, { recursive: true });

function settingsTitle() {
  return page.getByRole("heading", { level: 1, name: en["app.settingsPage.title"], exact: true });
}

function startupSelect() {
  return page.getByRole("button", { name: new RegExp(`^${en["settings.startupChat.title"]}`) });
}

/** The name of the agent whose chat the window shows. */
async function openChat(target: Page): Promise<string> {
  const heading = target.getByRole("main").getByRole("heading", { level: 1 }).first();
  await heading.waitFor();
  return (await heading.innerText()).trim();
}

async function waitForOpenChat(name: string): Promise<void> {
  await page.getByRole("main").getByRole("heading", { level: 1, name, exact: true }).waitFor({ timeout: 30_000 });
}

function savedStartupChat() {
  return page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
}

async function openSettings(): Promise<void> {
  if (!(await settingsTitle().isVisible()))
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Comma" : "Control+Comma");
  await settingsTitle().waitFor();
  const general = page.getByRole("tab", { name: en["settings.tab.general.title"], exact: true });
  if (await general.isVisible()) await general.click();
  await startupSelect().waitFor();
}

async function closeSettings(): Promise<void> {
  await settingsTitle().focus();
  await page.keyboard.press("Escape");
  await settingsTitle().waitFor({ state: "hidden" });
}

async function chooseStartupOption(name: string): Promise<string[]> {
  await openSettings();
  await startupSelect().scrollIntoViewIfNeeded();
  await startupSelect().click();
  const options = await page.getByRole("option").allInnerTexts();
  await page.getByRole("option", { name, exact: true }).click();
  return options.map((option) => option.trim());
}

/** Reloads the window and waits until the start animation leaves the workspace. */
async function reloadWindow(): Promise<void> {
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("status").filter({ hasText: en["app.loading"] }).waitFor({ state: "detached", timeout: 60_000 });
}

const report: Report = { instance: instance.instanceId, result: "running" };
try {
  await closeSettings().catch(() => undefined);
  const restoredChat = await openChat(page);
  report.restoredChat = restoredChat;

  await openSettings();
  await startupSelect().click();
  const listed = (await page.getByRole("option").allInnerTexts()).map((option) => option.trim());
  await page.keyboard.press("Escape");
  report.options = listed;
  assert.equal(listed[0], en["settings.startupChat.lastChat"], "The first option is not Last chat.");
  const chosen = listed.slice(1).find((name) => name !== restoredChat);
  assert.ok(chosen, "The server needs a second agent.");

  await chooseStartupOption(chosen);
  await page.waitForFunction((key) => window.localStorage.getItem(key) !== null, STORAGE_KEY);
  const saved = savedChatSchema.parse(JSON.parse((await savedStartupChat()) ?? "null"));
  report.saved = saved;
  await startupSelect().scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(OUT, "settings.png") });
  await closeSettings();
  assert.equal(await openChat(page), restoredChat, "A choice in Settings must not open the chat at once.");

  await reloadWindow();
  await waitForOpenChat(chosen);
  report.openedAfterReload = await openChat(page);
  await page.screenshot({ path: resolve(OUT, "launch-chosen-agent.png") });

  // A chat of the restored agent before the next launch, so a fallback to it is visible.
  await page
    .getByRole("button", { name: new RegExp(`^${restoredChat}, `) })
    .first()
    .click();
  await waitForOpenChat(restoredChat);
  await page.evaluate(
    ({ key, serverId }) =>
      window.localStorage.setItem(key, JSON.stringify({ serverId, agentId: "agent-that-does-not-exist" })),
    { key: STORAGE_KEY, serverId: saved.serverId },
  );
  await reloadWindow();
  await waitForOpenChat(restoredChat);
  const selection = await page.evaluate((key) => window.localStorage.getItem(key), SELECTION_KEY);
  report.missingAgent = { opened: await openChat(page), lastSelection: selection };
  assert.ok(selection?.includes(saved.serverId), "The last selection of the server is gone.");

  await openSettings();
  const missingOptions = await chooseStartupOption(en["settings.startupChat.lastChat"]);
  report.missingAgentOptions = missingOptions;
  assert.ok(
    missingOptions.includes(en["settings.startupChat.unlistedAgent"]),
    "The saved agent that the list does not have shows no option.",
  );
  await page.waitForFunction((key) => window.localStorage.getItem(key) === null, STORAGE_KEY);
  await closeSettings();
  report.cleared = true;
  report.result = "passed";
} catch (error) {
  report.result = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  await page.screenshot({ path: resolve(OUT, "failure.png") }).catch(() => undefined);
  throw error;
} finally {
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await session.close();
}
logger.info(`Passed. Report: ${resolve(OUT, "report.json")}`);
