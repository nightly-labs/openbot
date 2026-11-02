// Switches a running dev app through each theme in Settings, and checks that the window takes the
// palette of the choice: the root attribute, the canvas token and the page background. Light and Dark
// must not change `prefers-color-scheme`, because visited websites follow it. For System, it emulates
// a light and a dark system, because main cannot change the computer's setting.
// On macOS it then turns on Transparent window: the page background is clear, and while it is on,
// `prefers-color-scheme` follows Light and Dark, because the blur takes its shade from it. It captures
// the window with the blur, then turns the switch off and checks that the window is solid again.
// Restores the saved preference at the end. Writes .openbot-build/appearance/report.json and Settings and
// workspace screenshots per theme. Needs `--allow-mutations`, because it changes the theme setting.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type AppAppearance, type AppAppearancePreference, isAppAppearance } from "@openbot/contracts/app-appearance";
import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { en } from "@openbot/i18n";
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

const OUT = resolve(import.meta.dirname, "../.openbot-build/appearance");
// The canvas of each palette, as tokens.css and tokens-light.css give it.
const CANVAS = { dark: "#1a1a1a", light: "#f5f5f6" } as const;
const LABEL = {
  system: en["settings.appearance.theme.system"],
  light: en["settings.appearance.theme.light"],
  dark: en["settings.appearance.theme.dark"],
} as const satisfies Record<AppAppearance, string>;

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "appearance-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("appearance-e2e");
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});

async function savedPreference(page: Page): Promise<AppAppearancePreference> {
  const preference = await page.evaluate(() => window.openbot.getAppAppearancePreference());
  assert.ok(isAppAppearance(preference.appearance));
  return preference;
}

function settingsTitle(page: Page) {
  return page.getByRole("heading", { level: 1, name: en["app.settingsPage.title"], exact: true });
}

/** The Theme button. Its name is the title and then the selected theme. */
function themeButton(page: Page) {
  return page.getByRole("button", { name: new RegExp(`^${en["settings.appearance.theme.title"]} `) });
}

async function openSettings(page: Page) {
  if (!(await settingsTitle(page).isVisible()))
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Comma" : "Control+Comma");
  await settingsTitle(page).waitFor();
  const general = page.getByRole("tab", { name: en["settings.tab.general.title"], exact: true });
  if (await general.isVisible()) await general.click();
  await themeButton(page).waitFor();
}

async function closeSettings(page: Page) {
  // A focused settings tab keeps Escape for itself, so Escape goes from the title.
  await settingsTitle(page).focus();
  await page.keyboard.press("Escape");
  await settingsTitle(page).waitFor({ state: "hidden" });
}

async function chooseAppearance(page: Page, next: AppAppearance) {
  await openSettings(page);
  await themeButton(page).click();
  await page.getByRole("option", { name: LABEL[next], exact: true }).click();
  await page.waitForFunction(
    async (expected) => (await window.openbot.getAppAppearancePreference()).appearance === expected,
    next,
  );
}

/** Turns Transparent window on or off with its Settings switch. */
async function chooseTransparentWindow(page: Page, next: boolean) {
  await openSettings(page);
  const toggle = page.getByRole("switch", { name: en["settings.appearance.transparentWindow.title"] });
  if ((await toggle.isChecked()) !== next)
    await page.getByText(en["settings.appearance.transparentWindow.title"], { exact: true }).click();
  await page.waitForFunction(
    async (expected) => (await window.openbot.getAppAppearancePreference()).transparentWindow === expected,
    next,
  );
  await page.waitForFunction(
    (expected) => document.documentElement.hasAttribute("data-openbot-window-glass") === expected,
    next,
  );
}

/** Captures the window as the screen shows it, with the blur behind the page. */
async function captureWindow(page: Page, name: string): Promise<string> {
  const bounds = await page.evaluate(() => [window.screenX, window.screenY, window.outerWidth, window.outerHeight]);
  const path = resolve(OUT, `${name}.png`);
  execFileSync("screencapture", ["-x", "-o", `-R${bounds.join(",")}`, path]);
  return path;
}

/** What the window shows: the root attribute, the canvas token and the painted page background. */
function shownPalette(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    return {
      attribute: root.dataset.openbotColorScheme ?? null,
      canvas: style.getPropertyValue("--openbot-bg-canvas").trim(),
      colorScheme: style.colorScheme,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      systemLight: matchMedia("(prefers-color-scheme: light)").matches,
    };
  });
}

async function waitForScheme(page: Page, scheme: "light" | "dark") {
  await page.waitForFunction((expected) => document.documentElement.dataset.openbotColorScheme === expected, scheme);
  const shown = await shownPalette(page);
  assert.equal(shown.canvas, CANVAS[scheme], `The canvas token is not the ${scheme} canvas.`);
  assert.equal(shown.colorScheme, scheme, `The root color-scheme is not ${scheme}.`);
  return shown;
}

mkdirSync(OUT, { recursive: true });
const page = session.page;
// Chromium sends `prefers-color-scheme` changes in a rendering step, and a hidden or covered window
// has none. It takes the new colors when it shows again, so this check needs the window in front.
assert.equal(
  await page.evaluate(() => document.visibilityState),
  "visible",
  "Bring the dev app window to the front first.",
);
const original = await savedPreference(page);
const results = [];
const glass = [];
try {
  // Transparent window changes `prefers-color-scheme`, so the theme checks start with it off.
  if (original.transparentWindow)
    await page.evaluate(() => window.openbot.setAppAppearancePreference({ transparentWindow: false }));
  for (const appearance of ["light", "dark"] as const) {
    await chooseAppearance(page, appearance);
    const shown = await waitForScheme(page, appearance);
    await page.screenshot({ path: resolve(OUT, `settings-${appearance}.png`) });
    await closeSettings(page);
    await page.screenshot({ path: resolve(OUT, `workspace-${appearance}.png`) });
    results.push({ appearance, system: null, shown });
  }
  const [light, dark] = results;
  assert.equal(
    light?.shown.systemLight,
    dark?.shown.systemLight,
    "The theme choice changed prefers-color-scheme, so visited websites change with it.",
  );
  // System follows `prefers-color-scheme`, which main sets from the computer. The emulation changes
  // it for this window only, so the window must follow the media query with no restart.
  await chooseAppearance(page, "system");
  for (const system of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: system });
    const shown = await waitForScheme(page, system);
    await page.screenshot({ path: resolve(OUT, `settings-system-${system}.png`) });
    results.push({ appearance: "system", system, shown });
  }
  await page.emulateMedia({ colorScheme: null });

  const { platform } = await page.evaluate(() => window.openbot.getAppInfo());
  if (platform === "darwin") {
    const computerLight = light?.shown.systemLight;
    for (const appearance of ["light", "dark"] as const) {
      await chooseAppearance(page, appearance);
      await chooseTransparentWindow(page, true);
      await closeSettings(page);
      const shown = await waitForScheme(page, appearance);
      assert.equal(shown.bodyBackground, "rgba(0, 0, 0, 0)", "The page under a transparent window is not clear.");
      assert.equal(
        shown.systemLight,
        appearance === "light",
        `While the window is transparent, prefers-color-scheme does not follow ${appearance}.`,
      );
      glass.push({
        appearance,
        transparentWindow: true,
        shown,
        capture: await captureWindow(page, `glass-${appearance}`),
      });
    }
    await chooseTransparentWindow(page, false);
    await closeSettings(page);
    const shown = await waitForScheme(page, "dark");
    assert.notEqual(
      shown.bodyBackground,
      "rgba(0, 0, 0, 0)",
      "The page is still clear after Transparent window is off.",
    );
    assert.equal(
      shown.systemLight,
      computerLight,
      "With Transparent window off, websites do not follow the computer again.",
    );
    glass.push({
      appearance: "dark",
      transparentWindow: false,
      shown,
      capture: await captureWindow(page, "solid-dark"),
    });
  }
} finally {
  await page.emulateMedia({ colorScheme: null });
  await page.evaluate((preference) => window.openbot.setAppAppearancePreference(preference), original);
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify({ original, results, glass }, null, 2)}\n`);
  await session.close();
}
logger.info(`Checked Light, Dark, System and Transparent window. Wrote ${resolve(OUT, "report.json")}.`);
