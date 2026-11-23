import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type AppTextKey, en, TRANSLATED_LOCALES, type TranslatedLocale, translateFor } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import { type Browser, chromium, type Page } from "playwright-core";
import { type FitProblem, measureFit } from "./i18n-fit-probe";

const logger = createOpenBotLogger("i18n-fit-e2e");

interface StorybookPreview {
  onUpdateGlobals(update: { globals: { locale: string } }): Promise<void>;
}

declare global {
  interface Window {
    __STORYBOOK_PREVIEW__?: StorybookPreview;
  }
}

function option(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const outName = option("out") ?? "i18n-fit";
assert.match(outName, /^\w[\w.-]*$/, "--out takes a folder name, not a path.");
const OUT = resolve(import.meta.dirname, "../.openbot-build", outName);
const SHOTS = resolve(OUT, "screenshots");

const storybook = option("storybook")?.replace(/\/$/, "");
assert.ok(storybook, "Pass --storybook=<url> with the URL that `bun run storybook` reports.");
const browserExecutable = option("browser-executable");
const storyFilters = option("stories")?.split(",") ?? [];
const workers = Number(option("workers") ?? "1");
assert.ok(Number.isInteger(workers) && workers >= 1, "--workers takes a whole number, 1 or more.");
const requestedLocales = option("locales")?.split(",");
for (const locale of requestedLocales ?? []) {
  assert.ok(
    TRANSLATED_LOCALES.some((known) => known === locale),
    `--locales: "${locale}" is not one of ${TRANSLATED_LOCALES.join(", ")}.`,
  );
}
const locales: readonly TranslatedLocale[] = requestedLocales
  ? TRANSLATED_LOCALES.filter((locale) => requestedLocales.includes(locale))
  : TRANSLATED_LOCALES;
const order: TranslatedLocale[] = ["en", ...locales.filter((locale) => locale !== "en")];
const includeExplorations = process.argv.includes("--include-explorations");

interface StoryEntry {
  type: string;
  id: string;
  title: string;
}

interface Failure extends FitProblem {
  story: string;
  locale: TranslatedLocale;
  scope: string;
  keys: string[];
  alsoInEnglish: boolean;
  screenshot?: string;
}

function isPlainKey(key: string, source: unknown): key is AppTextKey {
  return key in en && typeof source === "string" && !source.includes("{");
}

const textIndex = new Map<TranslatedLocale, Map<string, string[]>>();
function keysFor(locale: TranslatedLocale, text: string): string[] {
  let index = textIndex.get(locale);
  if (!index) {
    index = new Map();
    const t = translateFor(locale);
    for (const [key, source] of Object.entries(en)) {
      if (!isPlainKey(key, source)) continue;
      const shown = t(key).trim();
      index.set(shown, [...(index.get(shown) ?? []), key]);
    }
    textIndex.set(locale, index);
  }
  return index.get(text) ?? [];
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        void document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => done())));
      }),
  );
}

async function setLocale(page: Page, locale: TranslatedLocale): Promise<void> {
  await page.evaluate((next) => {
    const preview = window.__STORYBOOK_PREVIEW__;
    if (typeof preview?.onUpdateGlobals !== "function")
      throw new Error("This Storybook does not expose __STORYBOOK_PREVIEW__.");
    return preview.onUpdateGlobals({ globals: { locale: next } });
  }, locale);
  await page.waitForFunction((lang) => document.documentElement.lang === lang, locale, { timeout: 10_000 });
  await settle(page);
}

const POPUPS = "[role=menu],[role=listbox]";
const TRIGGERS =
  ":is([aria-haspopup=menu],[aria-haspopup=listbox],[aria-haspopup=true]):not([aria-disabled=true],[disabled])";
const MAX_TRIGGERS = 4;

interface Measured {
  scope: string;
  problems: FitProblem[];
}

async function measureStory(
  page: Page,
  englishPicks: readonly number[] | undefined,
  record: (measured: Measured) => Promise<void>,
): Promise<{ picked: readonly number[]; opened: boolean }> {
  await record({ scope: "story", problems: await page.evaluate(measureFit, "body") });
  const picked = englishPicks ?? (await pickTriggers(page));
  let opened = false;
  for (const index of picked) {
    const shown = await page
      .locator(TRIGGERS)
      .nth(index)
      .click({ timeout: 1_000 })
      .then(() => page.locator(POPUPS).first().waitFor({ state: "visible", timeout: 1_000 }))
      .then(
        () => true,
        () => false,
      );
    if (!shown) continue;
    opened = true;
    await settle(page);
    await record({ scope: `popup:${index}`, problems: await page.evaluate(measureFit, POPUPS) });
    await page.keyboard.press("Escape");
    const closed = await page
      .locator(POPUPS)
      .first()
      .waitFor({ state: "hidden", timeout: 1_000 })
      .then(
        () => true,
        () => false,
      );
    if (!closed) break;
  }
  return { picked, opened };
}

async function pickTriggers(page: Page): Promise<number[]> {
  const labels = await page
    .locator(TRIGGERS)
    .evaluateAll((elements) =>
      elements.map((element) =>
        element.getBoundingClientRect().width > 0
          ? (element.getAttribute("aria-label") ?? element.textContent ?? "").trim()
          : null,
      ),
    );
  const picked: number[] = [];
  const seenLabels = new Set<string>();
  labels.forEach((label, index) => {
    if (label === null || seenLabels.has(label) || picked.length >= MAX_TRIGGERS) return;
    seenLabels.add(label);
    picked.push(index);
  });
  return picked;
}

async function openStory(page: Page, id: string, attempt = 1): Promise<string | null> {
  const loaded = await page
    .goto(`${storybook}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story`, { waitUntil: "domcontentloaded" })
    .then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message.split("\n")[0] : String(error)),
    );
  if (loaded) return attempt < 2 ? openStory(page, id, attempt + 1) : loaded;
  const state = await page
    .waitForFunction(
      () => {
        if (document.body.classList.contains("sb-show-errordisplay"))
          return `error: ${document.querySelector("#error-message")?.textContent?.slice(0, 200) ?? ""}`;
        return document.body.classList.contains("sb-show-main") && window.__STORYBOOK_PREVIEW__ ? "ready" : false;
      },
      undefined,
      { timeout: 30_000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => "timeout");
  if (state === "ready") return null;
  return attempt < 2 ? openStory(page, id, attempt + 1) : String(state);
}

const failures: Failure[] = [];
const skipped: { story: string; reason: string }[] = [];
let shotCount = 0;

async function runStory(page: Page, entry: StoryEntry, run: { stopped: boolean }): Promise<void> {
  const problem = await openStory(page, entry.id);
  if (problem) {
    skipped.push({ story: entry.id, reason: problem });
    return;
  }
  const english = new Set<string>();
  let englishPicks: readonly number[] | undefined;
  for (const locale of order) {
    try {
      await setLocale(page, locale);
      const { picked, opened } = await measureStory(page, englishPicks, async ({ scope, problems }) => {
        for (const found of problems) {
          const id = `${scope}|${found.path}|${found.reason}`;
          if (locale === "en") english.add(id);
          const alsoInEnglish = locale !== "en" && english.has(id);
          const failure: Failure = {
            ...found,
            story: entry.id,
            locale,
            scope,
            keys: keysFor(locale, found.text),
            alsoInEnglish,
          };
          if (locale !== "en" && !alsoInEnglish && found.rect.width > 0) {
            const name = `${String(++shotCount).padStart(5, "0")}-${locale}-${entry.id}.png`.slice(0, 160);
            const pad = 24;
            const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
            const x = Math.max(0, found.rect.x - pad);
            const y = Math.max(0, found.rect.y - pad);
            const width = Math.min(viewport.width - x, found.rect.width + pad * 2);
            const height = Math.min(viewport.height - y, found.rect.height + pad * 2);
            if (width > 0 && height > 0) {
              await page.screenshot({ path: resolve(SHOTS, name), clip: { x, y, width, height } }).then(
                () => {
                  failure.screenshot = `screenshots/${name}`;
                },
                () => undefined,
              );
            }
          }
          if (run.stopped) return;
          failures.push(failure);
        }
      });
      if (run.stopped) return;
      englishPicks ??= picked;
      if (opened && locale !== order.at(-1)) {
        const reopened = await openStory(page, entry.id);
        if (reopened) throw new Error(reopened);
      }
    } catch (error) {
      if (run.stopped) return;
      skipped.push({
        story: `${entry.id} (${locale})`,
        reason: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });
const index: { entries: Record<string, StoryEntry> } = await fetch(`${storybook}/index.json`).then((response) => {
  assert.ok(response.ok, `Storybook index failed: HTTP ${response.status}.`);
  return response.json();
});
const stories = Object.values(index.entries).filter(
  (entry) =>
    entry.type === "story" &&
    (includeExplorations || !entry.title.startsWith("Explorations/")) &&
    (storyFilters.length === 0 || storyFilters.some((part) => entry.id.includes(part))),
);
assert.ok(stories.length > 0, "No story matches.");

const browser: Browser = await chromium.launch(
  browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
);
const newPage = () => browser.newPage({ viewport: { width: 1280, height: 800 } });
const STORY_DEADLINE_MS = 120_000;
const queue = [...stories];
let done = 0;
try {
  await Promise.all(
    Array.from({ length: workers }, async () => {
      let page = await newPage();
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const run = { stopped: false };
        const finished = await Promise.race([
          runStory(page, entry, run).then(() => true),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), STORY_DEADLINE_MS);
          }),
        ]);
        clearTimeout(timer);
        run.stopped = !finished;
        if (!finished) skipped.push({ story: entry.id, reason: `No result in ${STORY_DEADLINE_MS / 1000} s.` });
        if (!finished || page.isClosed()) {
          void page.close().catch(() => undefined);
          page = await newPage();
        }
        done += 1;
        if (done % 25 === 0) logger.info(`${done}/${stories.length} stories, ${failures.length} findings.`);
      }
      await page.close();
    }),
  );
} finally {
  await browser.close();
}

const translated = failures.filter((failure) => failure.locale !== "en" && !failure.alsoInEnglish);
const byLocale = Object.fromEntries(
  order.map((locale) => [
    locale,
    {
      all: failures.filter((failure) => failure.locale === locale).length,
      notInEnglish: translated.filter((failure) => failure.locale === locale).length,
    },
  ]),
);
writeFileSync(
  resolve(OUT, "report.json"),
  `${JSON.stringify({ storybook, locales: order, stories: stories.length, byLocale, skipped, failures }, null, 2)}\n`,
);
logger.info(
  `Checked ${stories.length} stories in ${order.join(", ")}. ${translated.length} findings that English does not have. Wrote ${resolve(OUT, "report.json")}.`,
);
const skippedStories = new Set(skipped.map((entry) => entry.story.replace(/ \(.+\)$/, ""))).size;
assert.ok(
  skippedStories <= stories.length / 10,
  `Skipped ${skippedStories} of ${stories.length} stories. See "skipped" in the report.`,
);
