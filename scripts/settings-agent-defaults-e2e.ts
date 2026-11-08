// Changes each default in Settings › Agents of a running dev app, as a person does, and checks that
// the window stays responsive (#5708). For each setting page it turns the Default switch off and on,
// and waits until main saved each value. On Local scripts it chooses another "Requests an hour"; on
// Quick acknowledgement it chooses another "Start the work". A Select reports its value again when
// its options change. When the page saved that value as a new settings object, the settings and the
// Select updated each other with no end, and the window froze in a release build. The dev build
// stops such a loop with "Potential Infinite Loop Detected", so the check fails on that error, on
// any page error, and when the window does not paint a frame in time after a change.
// Run it on the host app and on the test client of `bun run dev:test-client`, which is the
// computer that uses a remote server. Restores the saved defaults at the end. Writes
// .openbot-build/settings-agent-defaults/report-<port>.json. Needs `--port=<debugging port>` and
// `--allow-mutations`, because it changes saved settings.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentDefaults, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { type AppTextKey, resolveLocale, translateFor } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import type { Page } from "playwright-core";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

// The page functions below run in the app window, where the preload bridge sets this.
declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/settings-agent-defaults");
/** A frame that takes longer than this after a change means that the renderer is busy. */
const FRAME_DEADLINE_MS = 2_000;

const SETTINGS = [
  { key: "allowAutomation", title: "agentSettings.automation.title" },
  { key: "allowNewChat", title: "agentSettings.agentNewChat.title" },
  { key: "quickAcknowledgement", title: "agentSettings.quickAcknowledgement.title" },
  { key: "busyMessageMode", title: "settings.busyMessage.title" },
] as const satisfies ReadonlyArray<{ key: string; title: AppTextKey }>;

const portArgument = process.argv.find((argument) => argument.startsWith("--port="));
const port = Number(portArgument?.slice("--port=".length));
assert.ok(Number.isInteger(port), "Name the app with --port=<OPENBOT_DEV_REMOTE_DEBUGGING_PORT>.");
const instance = readDevInstanceRecords().find((record) => record.remoteDebuggingPort === port);
assert.ok(instance, `No dev app of the registry uses the debugging port ${port}.`);
assertMutationAllowed({
  command: "settings-agent-defaults-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("settings-agent-defaults-e2e");
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
const page = session.page;
// The labels follow the language of the window, as on the computer of a person who uses another one.
const t = translateFor(resolveLocale("system", await page.evaluate(() => document.documentElement.lang)));
const pageErrors: string[] = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => {
  if (/Potential Infinite Loop|REACTIVITY_HALTED/.test(message.text())) pageErrors.push(message.text());
});

/** Fails when the window does not paint a frame before the deadline. */
async function framePaints(): Promise<number> {
  const started = Date.now();
  const painted = page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
  const late = new Promise<"late">((done) => setTimeout(() => done("late"), FRAME_DEADLINE_MS));
  assert.notEqual(await Promise.race([painted, late]), "late", "The window did not paint a frame after a change.");
  return Date.now() - started;
}

function settingsTitle() {
  return page.getByRole("heading", { level: 1, name: t("app.settingsPage.title"), exact: true });
}

function agentsPanel() {
  return page.getByRole("tabpanel", { name: t("settings.tab.agents.title"), exact: true });
}

async function closeWhatsNew(): Promise<void> {
  const dialog = page.getByRole("dialog", { name: t("update.whatsNew.title") });
  if (await dialog.isVisible()) {
    await dialog.getByRole("button", { name: t("update.whatsNew.done"), exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }
}

async function openAgentsTab(): Promise<void> {
  if (!(await settingsTitle().isVisible()))
    await page
      .getByRole("navigation", { name: t("app.rail.label"), exact: true })
      .getByRole("button", { name: t("app.rail.settings"), exact: true })
      .click();
  await settingsTitle().waitFor();
  await page.getByRole("tab", { name: t("settings.tab.agents.title"), exact: true }).click();
  await agentsPanel().waitFor();
  // The tab keeps the setting page that was open last.
  if (await backToList().isVisible()) await backToList().click();
}

/** The "Agents" part of the `Agents › <setting>` path in the page header. */
function backToList() {
  return page.locator(".settings-page-path").getByRole("button", { name: t("settings.tab.agents.title"), exact: true });
}

function savedDefaults(): Promise<AgentDefaults> {
  return page.evaluate(() => window.openbot.getAgentDefaults());
}

async function savedOn(key: (typeof SETTINGS)[number]["key"]): Promise<boolean> {
  if (key === "busyMessageMode")
    return (await page.evaluate(() => window.openbot.getBusyMessageModePreference())).mode === "steer";
  return (await savedDefaults())[key];
}

async function waitForSaved(key: (typeof SETTINGS)[number]["key"], expected: boolean): Promise<void> {
  await page.waitForFunction(
    async ([name, value]) => {
      if (name === "busyMessageMode")
        return ((await window.openbot.getBusyMessageModePreference()).mode === "steer") === value;
      return (await window.openbot.getAgentDefaults())[name] === value;
    },
    [key, expected] as const,
  );
}

/** Opens the Select, chooses the first option that is not the current one, and returns its label. */
async function chooseOtherOption(trigger: ReturnType<Page["getByRole"]>): Promise<string> {
  await trigger.click();
  const option = page.getByRole("option", { selected: false }).first();
  const label = (await option.textContent()) ?? "";
  await option.click();
  await page.getByRole("listbox").waitFor({ state: "hidden" });
  return label;
}

mkdirSync(OUT, { recursive: true });
const originalDefaults = await savedDefaults();
const originalSteer = await savedOn("busyMessageMode");
const steps: Array<{ setting: string; action: string; frameMs: number }> = [];
try {
  await closeWhatsNew();
  await openAgentsTab();
  for (const setting of SETTINGS) {
    const open = agentsPanel().getByRole("button", {
      name: t("settings.agentDefaults.open", { name: t(setting.title) }),
      exact: true,
    });
    await open.click();
    const toggle = agentsPanel().getByRole("switch", { name: t(setting.title), exact: true });
    await toggle.waitFor({ state: "attached" });
    const start = await savedOn(setting.key);
    for (const next of [!start, start]) {
      // The switch input is hidden behind its styled track, as in every SwitchField.
      await toggle.click({ force: true });
      await waitForSaved(setting.key, next);
      assert.equal(await toggle.isChecked(), next, `${t(setting.title)} does not show the saved value.`);
      steps.push({ setting: setting.key, action: `switch ${next ? "on" : "off"}`, frameMs: await framePaints() });
    }
    if (setting.key === "allowAutomation") {
      const limit = agentsPanel().getByRole("button", { name: t("settings.automationLimit.title") });
      const before = (await savedDefaults()).automationRunsPerHour;
      const label = await chooseOtherOption(limit);
      await page.waitForFunction(
        async (previous) => (await window.openbot.getAgentDefaults()).automationRunsPerHour !== previous,
        before,
      );
      steps.push({ setting: setting.key, action: `limit ${label}`, frameMs: await framePaints() });
      // A switch after a new limit is the reported way to freeze the window.
      await toggle.click({ force: true });
      await waitForSaved(setting.key, !start);
      steps.push({ setting: setting.key, action: "switch after limit", frameMs: await framePaints() });
      await toggle.click({ force: true });
      await waitForSaved(setting.key, start);
    }
    if (setting.key === "quickAcknowledgement") {
      const planStart = agentsPanel().getByRole("button", { name: t("settings.planStart.title") });
      const before = (await savedDefaults()).planStartAfterMs;
      const label = await chooseOtherOption(planStart);
      await page.waitForFunction(
        async (previous) => (await window.openbot.getAgentDefaults()).planStartAfterMs !== previous,
        before,
      );
      steps.push({ setting: setting.key, action: `plan start ${label}`, frameMs: await framePaints() });
    }
    await backToList().click();
    await open.waitFor();
  }
  assert.deepEqual(pageErrors, [], "The renderer reported an error while the defaults changed.");
} finally {
  await page.evaluate((defaults) => window.openbot.setAgentDefaults(defaults), originalDefaults);
  await page.evaluate(
    (steer) => window.openbot.setBusyMessageModePreference({ mode: steer ? "steer" : "queue" }),
    originalSteer,
  );
  const report = { port, instance: instance.service, originalDefaults, originalSteer, steps, pageErrors };
  writeFileSync(resolve(OUT, `report-${port}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await session.close();
}
logger.info(`Changed ${steps.length} values with no loop. Wrote ${resolve(OUT, `report-${port}.json`)}.`);
