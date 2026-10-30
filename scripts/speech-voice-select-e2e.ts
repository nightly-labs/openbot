// Chooses each other voice in Settings → Voice → Spoken replies of a running dev app, and checks
// that the closed select names that voice, that the saved setting is that voice, and that the select
// still names it after Settings opens again. The select kept the voice it showed first (#2602).
// Restores the saved voice at the end. Needs an English window and `--allow-mutations`, because it
// changes the voice setting.
//
// Run: bun scripts/speech-voice-select-e2e.ts --allow-mutations
// It writes .openbot-build/speech-voice-select-e2e/report.json and a screenshot, and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type OpenBotDesktopApi, SPEECH_VOICES, type SpeechVoice } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
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

const OUT = resolve(import.meta.dirname, "../.openbot-build/speech-voice-select-e2e");
const t = translateFor("en");

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "speech-voice-select-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("speech-voice-select-e2e");
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});

function voiceName(voice: SpeechVoice): string {
  return t(voice.startsWith("F") ? "settings.voice.speech.voice.female" : "settings.voice.speech.voice.male", {
    number: voice.slice(1),
  });
}

async function savedVoice(page: Page): Promise<SpeechVoice> {
  return (await page.evaluate(() => window.openbot.voice.getSpeechSettings())).voice;
}

function settingsTitle(page: Page) {
  return page.getByRole("heading", { level: 1, name: t("app.settingsPage.title"), exact: true });
}

function voiceRow(page: Page) {
  return page.locator('[data-settings-row="settings.voice.speech.voice.title"]');
}

/** Opens Settings on the Voice tab and returns the closed Voice select. */
async function openVoiceSelect(page: Page) {
  const title = settingsTitle(page);
  if (!(await title.isVisible()))
    await page
      .getByRole("navigation", { name: t("app.rail.label") })
      .getByRole("button", { name: t("app.rail.settings"), exact: true })
      .click();
  await title.waitFor();
  await page.getByRole("tab", { name: t("settings.tab.voice.title"), exact: true }).click();
  const trigger = voiceRow(page).getByRole("button", { name: t("settings.voice.speech.voice.title") });
  await trigger.and(page.locator(":enabled")).waitFor();
  return trigger;
}

async function closeSettings(page: Page) {
  // A focused settings tab keeps Escape for itself, so Escape goes from the title.
  await settingsTitle(page).focus();
  await page.keyboard.press("Escape");
  await settingsTitle(page).waitFor({ state: "hidden" });
}

async function shownVoice(page: Page): Promise<string> {
  return (await (await openVoiceSelect(page)).innerText()).trim();
}

async function chooseVoice(page: Page, voice: SpeechVoice) {
  await (await openVoiceSelect(page)).click();
  await page.getByRole("option", { name: voiceName(voice), exact: true }).click();
  await page.getByRole("listbox").waitFor({ state: "hidden" });
  // The select saves without an event, so read the setting until main has it.
  const deadline = Date.now() + 15_000;
  while ((await savedVoice(page)) !== voice && Date.now() < deadline);
}

mkdirSync(OUT, { recursive: true });
const page = session.page;
page.setDefaultTimeout(15_000);
assert.equal(await page.evaluate(() => document.documentElement.lang), "en", "Set the app language to English.");
const original = await savedVoice(page);
const results: { voice: SpeechVoice; expected: string; shown: string; saved: SpeechVoice; reopened: string }[] = [];
try {
  for (const voice of SPEECH_VOICES.filter((candidate) => candidate !== original)) {
    await chooseVoice(page, voice);
    const shown = await shownVoice(page);
    const saved = await savedVoice(page);
    if (voice === "M3") await voiceRow(page).screenshot({ path: resolve(OUT, "voice-m3.png") });
    await closeSettings(page);
    const reopened = await shownVoice(page);
    results.push({ voice, expected: voiceName(voice), shown, saved, reopened });
  }
} finally {
  await page.evaluate(async (voice) => {
    const settings = await window.openbot.voice.getSpeechSettings();
    await window.openbot.voice.setSpeechSettings({ ...settings, voice });
  }, original);
  await session.close();
}

const failures = results.filter(
  (result) => result.shown !== result.expected || result.saved !== result.voice || result.reopened !== result.expected,
);
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify({ original, results, failures }, null, 2)}\n`);
logger.info(`${results.length - failures.length}/${results.length} voices shown as chosen`);
if (failures.length > 0) {
  logger.error("the Voice select does not show the chosen voice", failures);
  process.exitCode = 1;
}
