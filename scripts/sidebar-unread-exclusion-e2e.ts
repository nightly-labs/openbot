// Checks "Show in Unread" in the agent menu of the sidebar on a running dev app (#7158). It clears the
// item for an unread agent that is in the "Unread" group, and checks that the agent leaves the group,
// shows in the chat list with its unread badge, and stays out after a reload. Then it sets the item
// again and checks that the agent goes back into the group and that the saved value is gone.
// Run `bun run dev` first (the showcase seed has unread agents), then
// `bun scripts/sidebar-unread-exclusion-e2e.ts --allow-mutations`, because it changes a saved sidebar
// choice. Writes .openbot-build/sidebar-unread-exclusion/report.json and three screenshots.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { en } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import { z } from "zod";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

const OUT = resolve(import.meta.dirname, "../.openbot-build/sidebar-unread-exclusion");
const EXCLUDED_KEY = "openbot:sidebar-unread-excluded";
const ORDER_KEY = "openbot:sidebar-chat-order";
const exclusionsSchema = z.record(z.string(), z.array(z.string()));

interface Report {
  instance: string;
  result: "running" | "passed" | "failed";
  agent?: string;
  unreadBefore?: string[];
  unreadAfterExclude?: string[];
  rowAfterExclude?: string;
  saved?: z.infer<typeof exclusionsSchema>;
  unreadAfterReload?: string[];
  unreadAfterInclude?: string[];
  savedAfterInclude?: string | null;
  error?: string;
}

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "sidebar-unread-exclusion-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("sidebar-unread-exclusion-e2e");
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
const page = session.page;
mkdirSync(OUT, { recursive: true });

const chatList = () => page.getByRole("navigation", { name: "Chat list" });
const unreadGroup = () => chatList().getByRole("region", { name: new RegExp(`^${en["sidebar.unread.title"]}, `) });
const chatRow = (name: string) => chatList().getByRole("button", { name: new RegExp(`^${name}, `) });

/** The names of the chats in the "Unread" group, top to bottom. No group reads as no chats. */
async function unreadNames(): Promise<string[]> {
  if ((await unreadGroup().count()) === 0) return [];
  // The name of a row is its strong text; the badge comes before it in the row text.
  const names = await unreadGroup().getByRole("button").locator("strong").allInnerTexts();
  return names.map((name) => name.trim());
}

async function waitForUnread(name: string, inGroup: boolean): Promise<void> {
  const row = unreadGroup().getByRole("button", { name: new RegExp(`^${name}, `) });
  await row.waitFor({ state: inGroup ? "visible" : "detached", timeout: 15_000 });
}

/** Opens the agent menu of a chat row and returns the "Show in Unread" item. */
async function showInUnreadItem(name: string) {
  await chatRow(name).first().click({ button: "right" });
  const menu = page.getByRole("menu", { name: en["sidebar.agentMenu.label"] });
  await menu.waitFor();
  return menu.getByRole("menuitemcheckbox", { name: en["sidebar.agentMenu.showInUnread"] });
}

/** Waits until the agent menu has closed, so a screenshot shows only the list. */
async function waitForMenuClosed(): Promise<void> {
  await page.getByRole("menu", { name: en["sidebar.agentMenu.label"] }).waitFor({ state: "detached" });
}

async function savedExclusions(): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), EXCLUDED_KEY);
}

async function reloadWindow(): Promise<void> {
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("status").filter({ hasText: en["app.loading"] }).waitFor({ state: "detached", timeout: 60_000 });
  await chatList().waitFor();
}

const report: Report = { instance: instance.instanceId, result: "running" };
try {
  // Start from the default order and no exclusions, so a choice from an earlier run does not count.
  await page.evaluate(
    ({ excluded, order }) => {
      window.localStorage.removeItem(excluded);
      window.localStorage.removeItem(order);
    },
    { excluded: EXCLUDED_KEY, order: ORDER_KEY },
  );
  await reloadWindow();
  await unreadGroup().waitFor({ timeout: 30_000 });

  const before = await unreadNames();
  report.unreadBefore = before;
  // The open chat stays in the group while it is open, so use another one.
  const openChat = (await page.getByRole("main").getByRole("heading", { level: 1 }).first().innerText()).trim();
  const agent = before.find((name) => name !== openChat && name !== "Launch room");
  assert.ok(agent, "The Unread group needs an agent that is not the open chat. Run `bun run dev:seed` first.");
  report.agent = agent;

  const item = await showInUnreadItem(agent);
  assert.equal(await item.getAttribute("aria-checked"), "true", "A new agent must show in Unread.");
  await page.screenshot({ path: resolve(OUT, "menu.png") });
  await item.click();
  await waitForUnread(agent, false);
  await waitForMenuClosed();
  const row = chatRow(agent).first();
  await row.waitFor();
  report.rowAfterExclude = (await row.innerText()).replaceAll("\n", " ");
  report.unreadAfterExclude = await unreadNames();
  assert.ok(!report.unreadAfterExclude.includes(agent), "The agent is still in the Unread group.");
  assert.match(await row.innerText(), /new repl/, "The agent lost its unread badge outside the group.");

  const saved = exclusionsSchema.parse(JSON.parse((await savedExclusions()) ?? "null"));
  report.saved = saved;
  assert.equal(Object.values(saved).flat().length, 1, "One agent must be saved for one server.");
  await page.screenshot({ path: resolve(OUT, "after-exclude.png") });

  await reloadWindow();
  await chatRow(agent).first().waitFor();
  report.unreadAfterReload = await unreadNames();
  assert.ok(!report.unreadAfterReload.includes(agent), "The choice did not stay after a reload.");

  const again = await showInUnreadItem(agent);
  assert.equal(await again.getAttribute("aria-checked"), "false", "The menu does not show the saved choice.");
  await again.click();
  await waitForUnread(agent, true);
  await waitForMenuClosed();
  report.unreadAfterInclude = await unreadNames();
  report.savedAfterInclude = await savedExclusions();
  assert.equal(report.savedAfterInclude, "{}", "The saved value keeps a server with no agents.");
  await page.screenshot({ path: resolve(OUT, "after-include.png") });
  report.result = "passed";
} catch (error) {
  report.result = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  await page.screenshot({ path: resolve(OUT, "failure.png") }).catch(() => undefined);
  throw error;
} finally {
  await page.keyboard.press("Escape").catch(() => undefined);
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await session.close();
}
logger.info(`Passed. Report: ${resolve(OUT, "report.json")}`);
