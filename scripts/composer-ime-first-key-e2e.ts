// Checks the first keystroke of a Japanese IME composition in the composer, in a running Storybook.
// Pass the URL that `bun run storybook` reports:
// `bun scripts/composer-ime-first-key-e2e.ts --storybook=http://localhost:6006`.
// Writes .openbot-build/composer-ime-first-key-e2e/report.json.
//
// The macOS Japanese IME sends the key that starts a composition before `compositionstart`, without
// `isComposing`, and Chromium marks it with keyCode 229. The `insertText` that follows carries the
// raw key ("n"); the composition then types the kana ("に"). A composer that types that `insertText`
// itself leaves the raw key in the draft and the kana becomes a second composition: "@xxx nい".
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type CDPSession, chromium, type Locator, type Page } from "playwright-core";

const OUT = resolve(import.meta.dirname, "../.openbot-build/composer-ime-first-key-e2e");
const storybook = process.argv.find((arg) => arg.startsWith("--storybook="))?.slice("--storybook=".length);
assert.ok(storybook, "Pass --storybook=<url> with the URL that `bun run storybook` reports.");

interface CaseResult {
  name: string;
  firstKeyPrevented: boolean;
  afterFirstKey: string;
  duringComposition: string;
  afterComposition: string;
  /** A picker that was open before the composition must not change while the IME owns the text. */
  pickerStayedOpen: boolean;
  passed: boolean;
}

interface RegressionResult {
  name: string;
  text: string;
  passed: boolean;
}

const report: { cases: CaseResult[]; regressions: RegressionResult[]; passed: boolean } = {
  cases: [],
  regressions: [],
  passed: false,
};

async function openComposer(page: Page): Promise<Locator> {
  await page.goto(`${storybook}/iframe.html?id=conversation-composereditor--mention-picker&viewMode=story`, {
    timeout: 120_000,
  });
  const editor = page.getByRole("textbox", { name: "Message Chief" });
  await editor.waitFor({ timeout: 60_000 });
  await editor.click();
  return editor;
}

/** The keydown and `insertText` that Chromium reports before `compositionstart`. */
async function typeCompositionFirstKey(editor: Locator): Promise<boolean> {
  return editor.evaluate((element) => {
    const win = element.ownerDocument.defaultView;
    if (!win) throw new Error("The composer has no window.");
    const keydown = new win.KeyboardEvent("keydown", { key: "n", code: "KeyN", bubbles: true, cancelable: true });
    Object.defineProperty(keydown, "keyCode", { get: () => 229 });
    element.dispatchEvent(keydown);
    const beforeInput = new win.InputEvent("beforeinput", {
      inputType: "insertText",
      data: "n",
      isComposing: false,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(beforeInput);
    return beforeInput.defaultPrevented;
  });
}

async function runCase(
  page: Page,
  session: CDPSession,
  name: string,
  prefix: string,
  pickerOpen: boolean,
): Promise<CaseResult> {
  const editor = await openComposer(page);
  if (prefix) await page.keyboard.type(prefix);
  if (pickerOpen) await page.locator(".mention-picker").waitFor({ state: "visible", timeout: 10_000 });
  const firstKeyPrevented = await typeCompositionFirstKey(editor);
  const afterFirstKey = await editor.innerText();
  await session.send("Input.imeSetComposition", { text: "に", selectionStart: 1, selectionEnd: 1 });
  await page.waitForTimeout(200);
  const duringComposition = await editor.innerText();
  const pickerStayedOpen = !pickerOpen || (await page.locator(".mention-picker").isVisible());
  await session.send("Input.insertText", { text: "に" });
  await page.waitForTimeout(200);
  const afterComposition = await editor.innerText();
  const expected = `${prefix}に`;
  return {
    name,
    firstKeyPrevented,
    afterFirstKey,
    duringComposition,
    afterComposition,
    pickerStayedOpen,
    passed:
      firstKeyPrevented &&
      afterFirstKey === prefix &&
      duringComposition === expected &&
      afterComposition === expected &&
      pickerStayedOpen,
  };
}

async function runRegressions(page: Page): Promise<RegressionResult[]> {
  const results: RegressionResult[] = [];

  // Plain typing takes the same `insertText` road, with no composition key before it.
  let editor = await openComposer(page);
  await page.keyboard.type("hello");
  const typed = await editor.innerText();
  results.push({ name: "plain typing", text: typed, passed: typed === "hello" });

  // An input method that picks a phrase with Shift+1 sends the "!" key and the phrase as its text (#1489).
  editor = await openComposer(page);
  const phrase = await editor.evaluate((element) => {
    const win = element.ownerDocument.defaultView;
    if (!win) throw new Error("The composer has no window.");
    const keydown = new win.KeyboardEvent("keydown", {
      key: "!",
      code: "Digit1",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(keydown);
    const beforeInput = new win.InputEvent("beforeinput", {
      inputType: "insertText",
      data: "候補",
      isComposing: false,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(beforeInput);
    return element.textContent ?? "";
  });
  results.push({ name: "Shift+1 phrase", text: phrase, passed: phrase === "候補" });

  // A paste is not an `insertText` and must still go through.
  editor = await openComposer(page);
  await page.evaluate(() => navigator.clipboard.writeText("貼り付け"));
  await page.keyboard.press("Control+V");
  await page.waitForTimeout(200);
  const pasted = await editor.innerText();
  results.push({ name: "paste", text: pasted, passed: pasted === "貼り付け" });

  // The mention picker still takes its keys and inserts the mention.
  editor = await openComposer(page);
  await page.keyboard.type("@ch");
  await page.locator(".mention-picker").waitFor({ state: "visible", timeout: 10_000 });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  const mentioned = await editor.innerText();
  const pickerOpen = await page.locator(".mention-picker").isVisible();
  results.push({
    name: "mention picker",
    text: mentioned,
    passed: !pickerOpen && mentioned.trim().length > 0 && !mentioned.includes("@ch"),
  });

  // Backspace still removes the automatic space and then the mention.
  editor = await openComposer(page);
  await page.keyboard.type("@ch");
  await page.locator(".mention-picker").waitFor({ state: "visible", timeout: 10_000 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(200);
  const afterSpace = await editor.innerText();
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(200);
  const afterMention = await editor.innerText();
  results.push({
    name: "backspace mention",
    text: `${afterSpace}|${afterMention}`,
    passed: afterSpace.length > 0 && !afterSpace.endsWith(" ") && afterMention === "",
  });

  return results;
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: storybook });
  const session = await page.context().newCDPSession(page);
  report.cases.push(await runCase(page, session, "empty composer", "", false));
  report.cases.push(await runCase(page, session, "mention picker open", "@ch", true));
  report.cases.push(await runCase(page, session, "after a mention", "@chief ", false));
  report.regressions.push(...(await runRegressions(page)));
} finally {
  await browser.close();
}

report.passed = report.cases.every((result) => result.passed) && report.regressions.every((result) => result.passed);
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
assert.ok(report.passed, "The composer typed the raw key before the composition.");
