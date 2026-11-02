// Run with `node --import tsx scripts/browser-menu-cover-e2e.ts --allow-mutations` in a dev app.
// Open a local agent's conversation and the browser view on a loaded page with two or more tabs first.
// A local page is a native view above the window. While the page shows, main also shows the dock in
// its overlay view, so the window's own dock field exists only while the page is hidden.
// The check runs on the tab menus of the first and last tabs and on the page menu.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import type { Locator, Page } from "playwright-core";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "browser-menu-cover-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const session = await connectToDevApp(instance.remoteDebuggingPort, createOpenBotLogger("browser-menu-cover-e2e"), {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
const out = resolve(".openbot-build/browser-menu-cover-e2e");
mkdirSync(out, { recursive: true });
const results: string[] = [];

/** Two frames, so a focus request or a show that the open scheduled has run. */
const settle = (page: Page) =>
  page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(undefined)))));

/** Opens a menu, checks that the page is hidden under it and keeps the focus, then closes it. */
async function checkMenu(page: Page, dockField: Locator, name: string, open: () => Promise<void>) {
  await open();
  const menu = page.getByRole("menu");
  await menu.waitFor();
  await dockField.waitFor();
  await settle(page);
  assert.ok(await menu.isVisible(), `${name}: the menu closed after the page was hidden.`);
  assert.ok(
    await menu.evaluate((element) => element.contains(document.activeElement)),
    `${name}: the focus left the menu.`,
  );
  const last = menu.getByRole("menuitem").last();
  assert.ok(await last.isVisible(), `${name}: the last row is not visible.`);
  await page.screenshot({ path: resolve(out, `${name}.png`) });
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  await dockField.waitFor({ state: "detached" });
  results.push(`${name}: the page is hidden while the menu is open and shows again after it closes.`);
}

try {
  const page = session.page;
  page.setDefaultTimeout(10_000);
  const view = page.getByRole("region", { name: "Browser", exact: true });
  await view.waitFor();
  // A modal menu hides the rest of the window from the accessibility tree.
  const dockField = page.getByRole("textbox", { name: /^Message to /, includeHidden: true });
  await dockField.waitFor({ state: "detached" });
  const tabs = view.getByRole("tablist", { name: "Browser tabs", exact: true }).getByRole("tab");
  assert.ok((await tabs.count()) >= 2, "Open two or more browser tabs first.");
  await checkMenu(page, dockField, "first-tab-menu", () => tabs.first().click({ button: "right" }));
  await checkMenu(page, dockField, "last-tab-menu", () => tabs.last().click({ button: "right" }));
  await checkMenu(page, dockField, "page-menu", () =>
    view.getByRole("button", { name: "Page actions", exact: true }).click(),
  );
} finally {
  writeFileSync(resolve(out, "report.json"), `${JSON.stringify({ results, passed: results.length === 3 }, null, 2)}\n`);
  await session.close();
}
