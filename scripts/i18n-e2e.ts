// Switches a running dev app through each translation in Settings, and checks that the window shows
// no catalog keys or placeholders, that no control text is cut off or wraps when it fits in English,
// and that a host error reads in the new language.
// Restores the saved language at the end. Writes .openbot-build/i18n-e2e/report.json and one
// screenshot per language. Needs `--allow-mutations`, because it changes the language setting.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isAppLanguage } from "@openbot/contracts/app-language";
import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { en, TRANSLATED_LOCALES, type TranslatedLocale, translateFor } from "@openbot/i18n";
import { type AppLanguage, appLanguageOption } from "@openbot/i18n/languages";
import { createOpenBotLogger } from "@openbot/logging";
import { userErrorMessage } from "@openbot/user-errors";
import type { Page } from "playwright-core";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";
import { type FitProblem, measureFit } from "./i18n-fit-probe";

// The page functions below run in the app window, where the preload bridge sets this.
declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/i18n-e2e");
const LOCALES = TRANSLATED_LOCALES.filter((locale) => locale !== "en");
const KEYS = new Set(Object.keys(en));
const PLACEHOLDER = /\{[a-zA-Z]\w*\}/g;

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "i18n-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("i18n-e2e");
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});

async function savedLanguage(page: Page): Promise<AppLanguage> {
  const preference = await page.evaluate(() => window.openbot.getAppLanguagePreference());
  assert.ok(isAppLanguage(preference.language));
  return preference.language;
}

/** The heading of the Settings page, which shows while the page is open. */
function settingsTitle(page: Page, shown: TranslatedLocale) {
  return page.getByRole("heading", { level: 1, name: translateFor(shown)("app.settingsPage.title"), exact: true });
}

async function openSettings(page: Page, shown: TranslatedLocale) {
  const t = translateFor(shown);
  const title = settingsTitle(page, shown);
  if (!(await title.isVisible()))
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Comma" : "Control+Comma");
  await title.waitFor();
  // Language is in the Appearance section.
  const appearance = page.getByRole("tab", { name: t("settings.appearance.title"), exact: true });
  if (await appearance.isVisible()) await appearance.click();
  return languageButton(page, t("settings.language.title"));
}

/** The Language button. Its name is the title and then the selected language. */
function languageButton(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `) });
}

async function chooseLanguage(page: Page, shown: TranslatedLocale, next: AppLanguage) {
  const trigger = await openSettings(page, shown);
  await trigger.click();
  const option = appLanguageOption(next);
  const label = option.id === "system" ? translateFor(shown)("settings.language.system") : option.label;
  await page.getByRole("option", { name: label, exact: true }).click();
}

/** Visible text that is a catalog key, or that still has a `{placeholder}`. */
async function leftovers(page: Page) {
  const text = await page.locator("body").innerText();
  const words = text.split(/[\s"'()[\],:;!?]+/).filter((word) => word.length > 0);
  return {
    keys: [...new Set(words.map((word) => word.replace(/\.$/, "")).filter((word) => KEYS.has(word)))],
    placeholders: [...new Set(text.match(PLACEHOLDER) ?? [])],
  };
}

/** Fit problems that English, on the same screen, does not have. */
async function newFitProblems(page: Page, english: readonly FitProblem[]): Promise<FitProblem[]> {
  const known = new Set(english.map((problem) => `${problem.path}|${problem.reason}`));
  const problems = await page.evaluate(measureFit, "body");
  return problems.filter((problem) => !known.has(`${problem.path}|${problem.reason}`));
}

async function hostError(page: Page): Promise<string> {
  const message = await page.evaluate(async () => {
    try {
      await window.openbot.skills.setEnabled({ agentId: "i18n-e2e-missing-agent", skillId: "none", enabled: true });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  assert.ok(message, "The host accepted a request for an agent that does not exist.");
  return message;
}

mkdirSync(OUT, { recursive: true });
const page = session.page;
const original = await savedLanguage(page);
const results = [];
let shown: TranslatedLocale = "en";
try {
  // Start from English, so the first Settings lookup knows the names it looks for.
  if (original !== "en") await page.evaluate(() => window.openbot.setAppLanguagePreference({ language: "en" }));
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await openSettings(page, "en");
  const englishSettings = await page.evaluate(measureFit, "body");
  // A focused settings tab keeps Escape for itself, so Escape goes from the title.
  await settingsTitle(page, "en").focus();
  await page.keyboard.press("Escape");
  await settingsTitle(page, "en").waitFor({ state: "hidden" });
  const englishWorkspace = await page.evaluate(measureFit, "body");
  for (const locale of LOCALES) {
    await chooseLanguage(page, shown, locale);
    await page.waitForFunction((lang) => document.documentElement.lang === lang, locale);
    shown = locale;
    const t = translateFor(locale);
    await languageButton(page, t("settings.language.title")).waitFor();
    const settings = await leftovers(page);
    const settingsFit = await newFitProblems(page, englishSettings);
    await page.screenshot({ path: resolve(OUT, `settings-${locale}.png`) });
    await page.keyboard.press("Escape");
    await settingsTitle(page, locale).waitFor({ state: "hidden" });
    const workspace = await leftovers(page);
    const workspaceFit = await newFitProblems(page, englishWorkspace);
    await page.screenshot({ path: resolve(OUT, `workspace-${locale}.png`) });
    const error = await hostError(page);
    const errorShown = userErrorMessage(new Error(error), t("common.retry"), locale);
    results.push({ locale, settings, settingsFit, workspace, workspaceFit, error, errorShown });
    assert.deepEqual(settings, { keys: [], placeholders: [] }, `Settings in ${locale} shows raw text.`);
    assert.deepEqual(workspace, { keys: [], placeholders: [] }, `The workspace in ${locale} shows raw text.`);
    assert.deepEqual(settingsFit, [], `Settings in ${locale} has control text that does not fit.`);
    assert.deepEqual(workspaceFit, [], `The workspace in ${locale} has control text that does not fit.`);
    assert.equal(errorShown, t("error.skill.chooseLocalAgent"), `The host error is not translated to ${locale}.`);
  }
} finally {
  await page.evaluate((language) => window.openbot.setAppLanguagePreference({ language }), original);
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify({ original, results }, null, 2)}\n`);
  await session.close();
}
logger.info(`Checked ${LOCALES.join(", ")}. Wrote ${resolve(OUT, "report.json")}.`);
