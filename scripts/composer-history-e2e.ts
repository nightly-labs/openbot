// Checks the composer prompt history in a running Storybook, which renders the real shared composer.
// Pass the URL that `bun run storybook` reports:
// `bun scripts/composer-history-e2e.ts --storybook=http://localhost:6006`.
// Writes .openbot-build/composer-history-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentMessage } from "@openbot/ui/data";
import { composerHistory } from "@openbot/ui/features/conversation/composer-history";
import { chromium, type Locator, type Page } from "playwright-core";

const OUT = resolve(import.meta.dirname, "../.openbot-build/composer-history-e2e");
const storybook = process.argv.find((arg) => arg.startsWith("--storybook="))?.slice("--storybook=".length);
const browserExecutable = process.argv
  .find((arg) => arg.startsWith("--browser-executable="))
  ?.slice("--browser-executable=".length);
assert.ok(storybook, "Pass --storybook=<url> with the URL that `bun run storybook` reports.");

const PROMPTS = ["First question", "Second question, which is longer", "Third question"];

interface Report {
  recalled?: { newest: string; previous: string; oldest: string };
  returned?: string;
  keptDraft?: { afterArrowUp: string; textAfterTyping: string };
  arrowDownAtEnd?: { draft: string };
  collected?: string[];
  passed: boolean;
}

const report: Report = { passed: false };

/** The text that the editor shows, reading a chip as one character, as `editorText` does. */
async function editorText(editor: Locator): Promise<string> {
  return editor.evaluate((element) => {
    const visit = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (!(node instanceof HTMLElement)) return "";
      if (node.contentEditable === "false") return "\uFFFC";
      if (node.tagName === "BR") return "\n";
      return Array.from(node.childNodes, visit).join("");
    };
    return Array.from(element.childNodes, visit).join("").replace(/\n$/u, "");
  });
}

async function openEditor(page: Page): Promise<Locator> {
  const editor = page.getByRole("textbox", { name: "Message Chief" });
  await editor.waitFor({ timeout: 60_000 });
  await editor.click();
  return editor;
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  browserExecutable ? { executablePath: resolve(browserExecutable), args: ["--no-sandbox"] } : { channel: "chrome" },
);
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  await page.goto(`${storybook}/iframe.html?id=conversation-composereditor--with-history&viewMode=story`);
  const editor = await openEditor(page);
  assert.equal(await editorText(editor), "", "The history story must start with an empty draft.");

  await editor.press("ArrowUp");
  const newest = await editorText(editor);
  assert.equal(newest, PROMPTS[2], "Arrow Up in an empty draft must recall the newest prompt.");
  await editor.press("ArrowUp");
  const previous = await editorText(editor);
  assert.equal(previous, PROMPTS[1], "A second Arrow Up must recall the prompt before it.");
  await editor.press("ArrowUp");
  const oldest = await editorText(editor);
  assert.equal(oldest, PROMPTS[0], "A third Arrow Up must reach the oldest prompt.");
  await editor.press("ArrowUp");
  assert.equal(await editorText(editor), PROMPTS[0], "Arrow Up at the oldest prompt must stay on it.");
  report.recalled = { newest, previous, oldest };

  await editor.press("ArrowDown");
  await editor.press("ArrowDown");
  await editor.press("ArrowDown");
  const returned = await editorText(editor);
  assert.equal(returned, "", "Arrow Down past the newest prompt must give back the empty draft.");
  report.arrowDownAtEnd = { draft: returned };

  // A draft in progress keeps the caret keys: only an empty draft starts the history.
  await editor.click();
  await editor.pressSequentially("Draft in progress");
  await editor.press("ArrowUp");
  const afterArrowUp = await editorText(editor);
  assert.equal(afterArrowUp, "Draft in progress", "Arrow Up in a typed draft must not recall a prompt.");
  // Arrow Up moved the caret to the start of the line, as it does in any text field.
  await editor.press("ArrowDown");
  await editor.pressSequentially("!");
  const textAfterTyping = await editorText(editor);
  assert.equal(textAfterTyping, "Draft in progress!", "Typing after Arrow Up must not leave history mode.");
  report.keptDraft = { afterArrowUp, textAfterTyping };

  // A recalled prompt is editable: typing keeps the text and leaves history mode.
  await editor.fill("");
  await editor.click();
  await editor.press("ArrowUp");
  assert.equal(await editorText(editor), PROMPTS[2]);
  await editor.pressSequentially(" (edited)");
  assert.equal(await editorText(editor), `${PROMPTS[2]} (edited)`, "A recalled prompt must take an edit.");
  await editor.press("ArrowUp");
  assert.equal(
    await editorText(editor),
    `${PROMPTS[2]} (edited)`,
    "After an edit, Arrow Up must keep the edited draft, not jump through the history.",
  );

  // The collected prompts: only the user's text messages, with consecutive copies counted once.
  const message = (author: AgentMessage["author"], body: string, kind?: AgentMessage["kind"]): AgentMessage => ({
    id: `${author}-${body}`,
    author,
    body,
    time: "",
    ...(kind ? { kind } : {}),
  });
  const collected = composerHistory([
    message("agent", "An answer"),
    message("you", "First question"),
    message("agent", "A second answer"),
    message("you", "First question"),
    message("you", "Second question, which is longer"),
    { ...message("you", ""), attachments: [] },
    message("you", "Progress", "thinking"),
    message("you", "Third question"),
  ]);
  assert.deepEqual(collected, PROMPTS, "The history must keep the user's text prompts only, newest last.");
  report.collected = collected;

  report.passed = true;
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}
