import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const OUT = resolve(import.meta.dirname, "../.openbot-build/composer-mention-picker-e2e");
const storybook = process.argv.find((arg) => arg.startsWith("--storybook="))?.slice("--storybook=".length);
const browserExecutable = process.argv
  .find((arg) => arg.startsWith("--browser-executable="))
  ?.slice("--browser-executable=".length);
assert.ok(storybook, "Pass --storybook=<url> with the URL that `bun run storybook` reports.");

interface Report {
  results: string[];
  passed: boolean;
}

const report: Report = { results: [], passed: false };

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  browserExecutable ? { executablePath: resolve(browserExecutable), args: ["--no-sandbox"] } : { channel: "chrome" },
);
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(`${storybook}/iframe.html?id=conversation-composereditor--tab-and-thread-picker&viewMode=story`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  const editor = page.getByRole("textbox", { name: "Message Chief" });
  await editor.waitFor({ timeout: 120_000 });
  await editor.click();
  await editor.pressSequentially("@");
  const list = page.locator(".mention-picker-list");
  await list.waitFor({ timeout: 15_000 });
  await page.waitForFunction(() => document.querySelectorAll(".mention-picker-option").length >= 5);

  const keys = await page
    .locator(".mention-picker-option")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-option-key") ?? ""));
  assert.ok(keys.length >= 5 && keys.every(Boolean), "The picker needs several options.");

  const activeKey = () =>
    page.locator(".mention-picker-option-active").evaluate((element) => element.getAttribute("data-option-key") ?? "");
  const indexOf = (key: string) => keys.indexOf(key);
  const fireMouseEnter = (key: string) =>
    page.locator(`.mention-picker-option[data-option-key="${key}"]`).evaluate((element) => {
      element.dispatchEvent(new MouseEvent("mouseenter"));
    });
  const firePointerMove = () =>
    list.evaluate((element) => {
      element.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
      element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    });

  const initial = await activeKey();
  assert.ok(indexOf(initial) >= 0, "An option starts active.");

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const keyed = keys[(indexOf(initial) + 2) % keys.length];
  const firstKey = keys[0];
  const lastKey = keys[keys.length - 1];
  assert.ok(keyed && firstKey && lastKey);
  assert.equal(await activeKey(), keyed, "Two ArrowDown presses move the highlight two rows.");
  report.results.push("ArrowDown moves the picker highlight.");

  // Chromium fires mouseenter on a row scrolled under a stationary pointer without a
  // pointermove/mousemove. That hover must not steal a key-picked highlight.
  await fireMouseEnter(firstKey);
  assert.equal(
    await activeKey(),
    keyed,
    "A mouseenter without real pointer movement must not change the key-picked highlight.",
  );
  report.results.push("A scroll-driven mouseenter leaves the key-picked highlight alone.");

  await firePointerMove();
  await fireMouseEnter(lastKey);
  assert.equal(await activeKey(), lastKey, "After a real pointer move, hover selection works again.");
  report.results.push("A real pointer move restores hover selection.");

  report.passed = true;
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}
