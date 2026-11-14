// Writes a theme palette file into a running dev app's `themes` folder, as the Omarchy theme
// script does, and checks the full path: the app finds the file with no restart, Settings lists it
// by its name, choosing it puts its colors on the window, a rewrite of the file (a theme switch)
// reaches the window, a file with a color that is not hex is refused, and choosing Dark again
// removes the palette colors. Removes the file and restores the saved preference at the end.
// Writes .openbot-build/theme-palette/report.json and a screenshot per step. Needs
// `--allow-mutations`, because it changes the theme setting.
import assert from "node:assert/strict";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AppThemePaletteColor } from "@openbot/contracts/app-appearance";
import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { en } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import type { Page } from "playwright-core";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";
import { resolveDevelopmentAppDataRoot } from "./development-state-paths";

// The page functions below run in the app window, where the preload bridge sets this.
declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/theme-palette");
const PALETTE_ID = "e2e-omarchy";
const PALETTE_NAME = "E2E Omarchy";
// The dark canvas of tokens.css: the window shows it again when no palette is selected.
const DARK_CANVAS = "#1a1a1a";

type PaletteColors = Record<AppThemePaletteColor, string>;

// Tokyo Night and Catppuccin Latte, as the Omarchy template makes them from each theme's colors.toml.
const TOKYO_NIGHT: PaletteColors = {
  canvas: "#1a1b26",
  frame: "#13141c",
  sidebar: "#13141c",
  surface: "#24283b",
  text: "#a9b1d6",
  textMuted: "#565f89",
  border: "#414868",
  accent: "#7aa2f7",
  accentForeground: "#1a1b26",
  success: "#9ece6a",
  warning: "#e0af68",
  danger: "#f7768e",
};
const CATPPUCCIN_LATTE: PaletteColors = {
  canvas: "#eff1f5",
  frame: "#e6e9ef",
  sidebar: "#e6e9ef",
  surface: "#ccd0da",
  text: "#4c4f69",
  textMuted: "#8c8fa1",
  border: "#bcc0cc",
  accent: "#1e66f5",
  accentForeground: "#eff1f5",
  success: "#40a02b",
  warning: "#df8e1d",
  danger: "#d20f39",
};

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "theme-palette-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("theme-palette-e2e");
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});

const themes = join(resolveDevelopmentAppDataRoot(), instance.profile, "themes");
const paletteFile = join(themes, `${PALETTE_ID}.json`);

/** Replaces the file with a rename, as `omarchy-theme-set-openbot` does, so no reader sees half a file. */
function publishPalette(appearance: "light" | "dark", colors: Record<string, string>) {
  mkdirSync(themes, { recursive: true });
  const temporary = `${paletteFile}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ name: PALETTE_NAME, appearance, colors }, null, 2)}\n`);
  renameSync(temporary, paletteFile);
}

function settingsTitle(page: Page) {
  return page.getByRole("heading", { level: 1, name: en["app.settingsPage.title"], exact: true });
}

/** The Theme button. Its name is the title and then the selected theme. */
function themeButton(page: Page) {
  return page.getByRole("button", { name: new RegExp(`^${en["settings.appearance.theme.title"]} `) });
}

async function openSettings(page: Page) {
  // The keyboard shortcut is a native menu item, which CDP key events do not reach.
  if (!(await settingsTitle(page).isVisible()))
    await page
      .getByRole("navigation", { name: en["app.rail.label"] })
      .getByRole("button", { name: en["app.rail.settings"], exact: true })
      .click();
  await settingsTitle(page).waitFor();
  // Theme is in the Appearance section.
  const appearance = page.getByRole("tab", { name: en["settings.appearance.title"], exact: true });
  if (await appearance.isVisible()) await appearance.click();
  await themeButton(page).waitFor();
}

async function closeSettings(page: Page) {
  // A focused settings tab keeps Escape for itself, so Escape goes from the title.
  await settingsTitle(page).focus();
  await page.keyboard.press("Escape");
  await settingsTitle(page).waitFor({ state: "hidden" });
}

async function chooseTheme(page: Page, label: string) {
  await openSettings(page);
  await themeButton(page).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

/** Waits until main lists the palette (or no longer lists it), which the folder watch causes. */
async function waitForListed(page: Page, listed: boolean) {
  await page.waitForFunction(
    async ([id, expected]) =>
      (await window.openbot.getAppAppearancePreference()).palettes.some((palette) => palette.id === id) === expected,
    [PALETTE_ID, listed] as const,
  );
}

/** What the window shows: the root attribute, the canvas and accent tokens and the page background. */
function shownColors(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    return {
      attribute: root.dataset.openbotColorScheme ?? null,
      canvas: style.getPropertyValue("--openbot-bg-canvas").trim(),
      accent: style.getPropertyValue("--openbot-accent").trim(),
      inlineCanvas: root.style.getPropertyValue("--openbot-bg-canvas"),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
    };
  });
}

async function waitForCanvas(page: Page, canvas: string) {
  await page.waitForFunction(
    (expected) =>
      getComputedStyle(document.documentElement).getPropertyValue("--openbot-bg-canvas").trim() === expected,
    canvas,
  );
  return shownColors(page);
}

mkdirSync(OUT, { recursive: true });
const page = session.page;
const original = await page.evaluate(() => window.openbot.getAppAppearancePreference());
type ShownColors = Awaited<ReturnType<typeof shownColors>>;
const steps: Partial<Record<"chosen" | "rewritten" | "refused" | "restored" | "cleared", ShownColors>> = {};
try {
  // The checks below name the base under a refused palette, so the saved base must be known.
  await page.evaluate(() => window.openbot.setAppAppearancePreference({ appearance: "dark", palette: null }));

  // 1. A new file reaches main with no restart.
  publishPalette("dark", TOKYO_NIGHT);
  await waitForListed(page, true);

  // 2. Settings lists it by name, and choosing it gives the window its colors over the dark base.
  await chooseTheme(page, PALETTE_NAME);
  await page.waitForFunction(
    async (id) => (await window.openbot.getAppAppearancePreference()).palette === id,
    PALETTE_ID,
  );
  let shown = await waitForCanvas(page, TOKYO_NIGHT.canvas);
  assert.equal(shown.attribute, "dark", "A dark palette did not give the dark base.");
  assert.equal(shown.accent, TOKYO_NIGHT.accent, "The palette accent is not on the window.");
  assert.equal(shown.bodyBackground, "rgb(26, 27, 38)", "The page background is not the palette canvas.");
  await page.screenshot({ path: resolve(OUT, "settings-tokyo-night.png") });
  await closeSettings(page);
  await page.screenshot({ path: resolve(OUT, "workspace-tokyo-night.png") });
  steps.chosen = shown;

  // 3. A theme switch rewrites the file. The window follows, the light base included.
  publishPalette("light", CATPPUCCIN_LATTE);
  shown = await waitForCanvas(page, CATPPUCCIN_LATTE.canvas);
  await page.waitForFunction(() => document.documentElement.dataset.openbotColorScheme === "light");
  shown = await shownColors(page);
  assert.equal(shown.accent, CATPPUCCIN_LATTE.accent, "The rewritten accent is not on the window.");
  await page.screenshot({ path: resolve(OUT, "workspace-catppuccin-latte.png") });
  steps.rewritten = shown;

  // 4. A color that is not hex never reaches CSS: the whole file is refused, and the window shows
  // the saved appearance under it. The saved id stays, so a valid file brings the palette back.
  publishPalette("dark", { ...TOKYO_NIGHT, accent: "red; background: url(https://example.com)" });
  await waitForListed(page, false);
  // The event that clears the colors can reach the window after the answer to the poll above.
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--openbot-bg-canvas") === "", {
    timeout: 10_000,
  });
  shown = await shownColors(page);
  assert.equal(shown.attribute, "dark", "The window does not show the saved Dark under a refused palette.");
  steps.refused = shown;
  publishPalette("dark", TOKYO_NIGHT);
  shown = await waitForCanvas(page, TOKYO_NIGHT.canvas);
  steps.restored = shown;

  // 5. Choosing Dark clears the palette and its colors.
  await chooseTheme(page, en["settings.appearance.theme.dark"]);
  shown = await waitForCanvas(page, DARK_CANVAS);
  assert.equal(shown.inlineCanvas, "", "Dark left the palette colors on the window.");
  assert.equal((await page.evaluate(() => window.openbot.getAppAppearancePreference())).palette, null);
  await closeSettings(page);
  await page.screenshot({ path: resolve(OUT, "workspace-dark.png") });
  steps.cleared = shown;
} finally {
  rmSync(paletteFile, { force: true });
  rmSync(`${paletteFile}.tmp`, { force: true });
  const { appearance, transparentWindow, palette } = original;
  await page.evaluate((preference) => window.openbot.setAppAppearancePreference(preference), {
    appearance,
    transparentWindow,
    palette,
  });
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify({ original, steps }, null, 2)}\n`);
  await session.close();
}
logger.info(`Checked a palette file from write to clear. Wrote ${resolve(OUT, "report.json")}.`);
