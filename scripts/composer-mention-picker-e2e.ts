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

interface PickerEventEntry {
  type: string;
  key: string | null;
}

declare global {
  interface Window {
    __pickerEvents?: PickerEventEntry[];
  }
}

interface Report {
  results: string[];
  failures: string[];
  realPointerEvents?: PickerEventEntry[];
  passed: boolean;
}

const report: Report = { results: [], failures: [], passed: false };

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  browserExecutable ? { executablePath: resolve(browserExecutable), args: ["--no-sandbox"] } : { channel: "chrome" },
);
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.setDefaultTimeout(300_000);
  await page.addInitScript(() => {
    window.__pickerEvents = [];
    for (const type of ["pointermove", "mousemove", "mouseenter", "pointerenter"]) {
      document.addEventListener(
        type,
        (event) => {
          const target = event.target;
          const row = target instanceof HTMLElement ? target.closest(".mention-picker-option") : null;
          window.__pickerEvents?.push({ type, key: row?.getAttribute("data-option-key") ?? null });
        },
        true,
      );
    }
  });
  await page.goto(`${storybook}/iframe.html?id=conversation-composereditor--tab-and-thread-picker&viewMode=story`, {
    waitUntil: "commit",
    timeout: 300_000,
  });
  const editor = page.getByRole("textbox", { name: "Message Chief" });
  await editor.waitFor({ timeout: 300_000 });
  await editor.click();
  await editor.pressSequentially("@");
  const list = page.locator(".mention-picker-list");
  await list.waitFor({ timeout: 120_000 });
  await page.waitForFunction(() => document.querySelectorAll(".mention-picker-option").length >= 5);

  const keys = await page
    .locator(".mention-picker-option")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-option-key") ?? ""));
  assert.ok(keys.length >= 5 && keys.every(Boolean), "The picker needs several options.");

  const activeKey = () =>
    page.locator(".mention-picker-option-active").evaluate((element) => element.getAttribute("data-option-key") ?? "");
  const indexOf = (key: string) => keys.indexOf(key);
  const optionLocator = (key: string) => page.locator(`.mention-picker-option[data-option-key="${key}"]`);
  const fireMouseEnter = (key: string) =>
    optionLocator(key).evaluate((element) => {
      element.dispatchEvent(new MouseEvent("mouseenter"));
    });
  const firePointerMove = () =>
    list.evaluate((element) => {
      element.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
      element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    });
  const scrollTop = () => list.evaluate((element) => element.scrollTop);
  const pickerEvents = () => page.evaluate(() => window.__pickerEvents ?? []);
  const clearPickerEvents = () =>
    page.evaluate(() => {
      window.__pickerEvents = [];
    });

  const check = async (name: string, run: () => void | Promise<void>) => {
    try {
      await run();
      report.results.push(name);
    } catch (error) {
      report.failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const initial = await activeKey();
  assert.ok(indexOf(initial) >= 0, "An option starts active.");
  const firstKey = keys[0];
  const lastKey = keys[keys.length - 1];
  assert.ok(firstKey && lastKey);
  let keyed: string | undefined;

  await check("ArrowDown moves the picker highlight", async () => {
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    keyed = keys[(indexOf(initial) + 2) % keys.length];
    assert.ok(keyed);
    assert.equal(await activeKey(), keyed);
  });

  // A synthetic mouseenter (no real pointer movement) must not steal a key-picked
  // highlight: scroll hit-test changes fire mouseenter without pointermove.
  await check("A scroll-driven mouseenter leaves the key-picked highlight alone", async () => {
    assert.ok(keyed);
    await fireMouseEnter(firstKey);
    assert.equal(await activeKey(), keyed);
  });

  await check("A dispatched pointermove restores hover selection", async () => {
    await firePointerMove();
    await fireMouseEnter(lastKey);
    assert.equal(await activeKey(), lastKey);
  });

  // Real pointer path: park the mouse on a row, then drive the highlight with the
  // keyboard while scrollIntoView moves rows under the stationary pointer.
  const parkIndex = Math.min(3, keys.length - 1);
  const parkKey = keys[parkIndex];
  assert.ok(parkKey);
  const parkBox = await optionLocator(parkKey).boundingBox();
  assert.ok(parkBox, "The parked row must be visible.");
  await page.mouse.move(parkBox.x + parkBox.width / 2, parkBox.y + parkBox.height / 2);
  await page.waitForTimeout(150);
  const hoveredKey = await activeKey();
  const hoverIndex = indexOf(hoveredKey);

  const steps = 8;
  let maxScroll = 0;
  await clearPickerEvents();
  await check("Parked-pointer ArrowDown keeps the key highlight while the list scrolls", async () => {
    assert.ok(hoverIndex >= 0, "Parking the pointer selects the row under it.");
    for (let step = 0; step < steps; step++) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(80);
      maxScroll = Math.max(maxScroll, await scrollTop());
    }
    const expectedKey = keys[(hoverIndex + steps) % keys.length];
    assert.ok(expectedKey);
    assert.ok(maxScroll > 0, "The key walk must scroll the list for this check to mean anything.");
    assert.equal(await activeKey(), expectedKey);
  });
  report.results.push(
    `During the parked-pointer walk the list scrolled to ${maxScroll}px over ${steps} ArrowDown presses.`,
  );

  report.realPointerEvents = await pickerEvents();
  const moves = report.realPointerEvents.filter(
    (entry) => entry.type === "pointermove" || entry.type === "mousemove",
  ).length;
  const enters = report.realPointerEvents.filter(
    (entry) => entry.type === "mouseenter" || entry.type === "pointerenter",
  ).length;
  report.results.push(`During the parked-pointer walk Chromium emitted ${moves} move and ${enters} enter events.`);

  await check("Hover selection works again after the pointer really moves", async () => {
    // The stationary pointer may already hover the row the scroll parked under it;
    // moving onto a different row is what must restore hover selection.
    await optionLocator(lastKey).scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const targetBox = await optionLocator(lastKey).boundingBox();
    assert.ok(targetBox, "The hover target must be visible.");
    const cx = targetBox.x + targetBox.width / 2;
    const cy = targetBox.y + targetBox.height / 2;
    const hitKey = await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.closest(".mention-picker-option")?.getAttribute("data-option-key") ?? null,
      { x: cx, y: cy },
    );
    assert.equal(hitKey, lastKey, `elementFromPoint must hit ${lastKey}`);
    await page.mouse.move(10, 10);
    await page.waitForTimeout(80);
    await page.mouse.move(cx, cy);
    await page.waitForTimeout(150);
    const tail = (await pickerEvents()).slice(-12);
    assert.equal(
      await activeKey(),
      lastKey,
      `hover(${lastKey}) at ${cx},${cy} hit=${hitKey} tail=${JSON.stringify(tail)}`,
    );
  });

  report.passed = report.failures.length === 0;
} finally {
  report.passed = report.failures.length === 0;
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.failures.length > 0) throw new Error(report.failures.join("\n"));
