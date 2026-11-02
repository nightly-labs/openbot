// Exercises an existing local dev app. Opens and closes the Marketplace page; installs nothing.
// Writes .openbot-build/marketplace-page-e2e/report.json and marketplace.png.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

const OUT = resolve(import.meta.dirname, "../.openbot-build/marketplace-page-e2e");
const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "marketplace-page-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("marketplace-page-e2e");
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
try {
  const page = session.page;
  const rail = page.getByRole("navigation", { name: "Pages", exact: true });
  const railButton = (name: string) => rail.getByRole("button", { name, exact: true });
  const marketplace = page.getByRole("region", { name: "Marketplace", exact: true });
  const windowPage = () =>
    page.evaluate(() => document.querySelector("[data-window-page]")?.getAttribute("data-window-page"));
  const waitForPage = (name: string) =>
    page.waitForFunction(
      (expected) => document.querySelector("[data-window-page]")?.getAttribute("data-window-page") === expected,
      name,
    );
  const steps: string[] = [];

  await railButton("Agents").click();
  await waitForPage("agents");

  // The rail opens the Marketplace as a page of the window, with the focus on the title of its side panel.
  await railButton("Marketplace").click();
  await marketplace.waitFor();
  await waitForPage("marketplace");
  assert.equal(await railButton("Marketplace").getAttribute("aria-current"), "page");
  assert.equal(await page.getByRole("dialog").count(), 0, "The Marketplace opened as a dialog.");
  await page.waitForFunction(() => document.activeElement?.classList.contains("marketplace-nav-title") === true);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: resolve(OUT, "marketplace.png") });
  steps.push("rail opens the page");

  // A listing opens a view in the page. The kind in the path of the top row and Escape go back to the catalog.
  const back = marketplace
    .getByRole("navigation", { name: "Location" })
    .getByRole("button", { name: "Apps", exact: true });
  // Apps is the first kind in the side panel, and the page opens on it.
  const kinds = marketplace.getByRole("navigation", { name: "Marketplace content types" }).getByRole("button");
  assert.equal((await kinds.first().innerText()).trim(), "Apps");
  assert.equal(await kinds.first().getAttribute("aria-current"), "page");
  steps.push("page opens on Apps");
  await marketplace.locator(".marketplace-app-row-hit").first().click();
  await back.waitFor();
  // On an app page one row stays selected: Apps, or the app in "Your apps".
  const selected = await marketplace
    .locator(".marketplace-nav [aria-current]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-current")));
  assert.ok(
    selected.length === 1 && (selected[0] === "location" || selected[0] === "page"),
    `The side panel did not keep one selected row on an app page: ${selected.join(", ")}`,
  );
  steps.push("the side panel keeps a selected row on an app page");
  await back.click();
  await back.waitFor({ state: "detached" });
  steps.push("the path goes back to the list");
  await marketplace.locator(".marketplace-app-row-hit").first().click();
  await back.waitFor();
  await page.keyboard.press("Escape");
  await back.waitFor({ state: "detached" });
  assert.equal(await windowPage(), "marketplace", "Escape in a view closed the page.");
  steps.push("escape goes back one view");

  // A view does not show the search, so Escape there goes back and keeps the search. On the catalog,
  // Escape clears the search.
  const search = marketplace.getByRole("searchbox");
  await search.fill("git");
  await marketplace.locator(".marketplace-app-row-hit").first().click();
  await back.waitFor();
  await page.keyboard.press("Escape");
  await back.waitFor({ state: "detached" });
  assert.equal(await search.inputValue(), "git", "Escape in a view cleared the search.");
  await marketplace.getByRole("heading", { level: 2 }).focus();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('input[type="search"]')?.value === "");
  assert.equal(await windowPage(), "marketplace", "Escape with a search closed the page.");
  steps.push("escape keeps the search in a view and clears it on the catalog");

  // Escape on the catalog closes the page, and the rail button that opened it gets the focus back.
  await page.keyboard.press("Escape");
  await waitForPage("agents");
  await marketplace.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Marketplace");
  steps.push("escape closes the page and returns the focus");

  // The rail leaves the page.
  await railButton("Marketplace").click();
  await marketplace.waitFor();
  await railButton("Agents").click();
  await waitForPage("agents");
  await marketplace.waitFor({ state: "detached" });
  steps.push("rail Agents closes the page");

  // Another page replaces it, and the Marketplace replaces that page.
  await railButton("Marketplace").click();
  await marketplace.waitFor();
  await railButton("Settings").click();
  await waitForPage("settings");
  await marketplace.waitFor({ state: "detached" });
  await railButton("Marketplace").click();
  await waitForPage("marketplace");
  await marketplace.waitFor();
  await railButton("Agents").click();
  await waitForPage("agents");
  steps.push("settings and marketplace replace each other");

  const report = { passed: true, steps };
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  await session.close();
}
