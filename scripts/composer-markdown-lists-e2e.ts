import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import { chromium, type Locator } from "playwright-core";
import { mentionDraft } from "../apps/mobile/src/features/chat/model/chat-mentions";
import { applyMarkdownListEdit, markdownListReturn } from "../apps/mobile/src/features/chat/model/composer-lists";

const OUT = resolve(import.meta.dirname, "../.openbot-build/composer-markdown-lists-e2e");
const storybook = process.argv.find((arg) => arg.startsWith("--storybook="))?.slice("--storybook=".length);
const browserExecutable = process.argv
  .find((arg) => arg.startsWith("--browser-executable="))
  ?.slice("--browser-executable=".length);
assert.ok(storybook, "Pass --storybook=<url> with the URL that `bun run storybook` reports.");

interface CaseResult {
  before: string;
  after: string;
  caret?: number;
  undo?: string;
  redo?: string;
}

interface Report {
  sequential?: CaseResult;
  deliberateGap?: CaseResult;
  desktopReferences?: CaseResult;
  mobileMention?: CaseResult;
  passed: boolean;
}

const report: Report = { passed: false };

async function placeCaret(editor: Locator, offset: number): Promise<void> {
  await editor.evaluate((element, targetOffset) => {
    const selection = element.ownerDocument.getSelection();
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let remaining = targetOffset;
    let node = walker.nextNode();
    while (node) {
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) {
        const range = element.ownerDocument.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
      remaining -= length;
      node = walker.nextNode();
    }
    throw new Error(`Caret offset ${targetOffset} is outside the composer.`);
  }, offset);
}

async function visibleEditorText(editor: Locator): Promise<string> {
  return editor.evaluate((element) => {
    const visit = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (!(node instanceof HTMLElement)) return "";
      if (node.contentEditable === "false") return "\uFFFC";
      if (node.tagName === "BR") return "\n";
      return Array.from(node.childNodes, visit).join("");
    };
    return Array.from(element.childNodes, visit).join("");
  });
}

async function insertAfterSecondItem(editor: Locator, value: string): Promise<CaseResult> {
  await editor.fill(value);
  const firstBreak = value.indexOf("\n");
  const secondBreak = value.indexOf("\n", firstBreak + 1);
  await placeCaret(editor, secondBreak < 0 ? value.length : secondBreak);
  await editor.press("Shift+Enter");
  const caret = await editor.evaluate((element) => {
    const selection = element.ownerDocument.getSelection();
    if (!selection?.focusNode) return -1;
    const prefix = element.ownerDocument.createRange();
    prefix.selectNodeContents(element);
    prefix.setEnd(selection.focusNode, selection.focusOffset);
    return prefix.toString().length;
  });
  return { before: value, after: await editor.innerText(), caret };
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  browserExecutable ? { executablePath: resolve(browserExecutable), args: ["--no-sandbox"] } : { channel: "chrome" },
);
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  await page.goto(`${storybook}/iframe.html?id=conversation-composereditor--long-multiline-draft&viewMode=story`);
  const editor = page.getByRole("textbox", { name: "Message Chief" });
  await editor.waitFor({ timeout: 60_000 });

  report.sequential = await insertAfterSecondItem(editor, "1. one\n2. two\n3. three\n4. four");
  assert.equal(report.sequential.after, "1. one\n2. two\n3. \n4. three\n5. four");
  assert.equal(report.sequential.caret, "1. one\n2. two\n3. ".length);
  await editor.press("ControlOrMeta+z");
  report.sequential.undo = await editor.innerText();
  assert.equal(report.sequential.undo, report.sequential.before, "One Undo must revert the complete list edit.");
  await editor.press("ControlOrMeta+Shift+z");
  report.sequential.redo = await editor.innerText();
  assert.equal(report.sequential.redo, report.sequential.after, "One Redo must restore the complete list edit.");

  report.deliberateGap = await insertAfterSecondItem(editor, "1. one\n2. two\n7. seven");
  assert.equal(report.deliberateGap.after, "1. one\n2. two\n3. \n7. seven");

  await page.goto(`${storybook}/iframe.html?id=conversation-composereditor--with-file-references&viewMode=story`);
  const referenceEditor = page.getByRole("textbox", { name: "Message Chief" });
  await referenceEditor.waitFor({ timeout: 60_000 });
  await referenceEditor.evaluate((element) => {
    element.prepend(element.ownerDocument.createTextNode("1. one\n2. two\n3. "));
    element.append(element.ownerDocument.createTextNode("\n4. four"));
  });
  const referenceBefore = await referenceEditor.innerText();
  await placeCaret(referenceEditor, "1. one\n2. two".length);
  await referenceEditor.press("Shift+Enter");
  const referenceAfter = await referenceEditor.innerText();
  assert.equal(await visibleEditorText(referenceEditor), "1. one\n2. two\n3. \n4. \uFFFC \uFFFC\n5. four");
  assert.deepEqual(
    await referenceEditor
      .locator("[data-attachment-reference-id]")
      .evaluateAll((tokens) =>
        tokens.map((token) => (token instanceof HTMLElement ? token.dataset.attachmentReferenceId : undefined)),
      ),
    ["draft-start-types", "draft-agents"],
  );
  const attachmentClickHandled = await referenceEditor
    .locator('[data-attachment-reference-id="draft-start-types"]')
    .evaluate((token) => !token.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  assert.equal(attachmentClickHandled, true, "An attachment token must keep its actions after renumbering.");
  report.desktopReferences = { before: referenceBefore, after: referenceAfter };

  const mention = serializeChatTagReference("agent", "Chief", "chief");
  const mobileSource = `1. one\n2. two\n3. ${mention}\n4. four`;
  const mobileVisible = mentionDraft(mobileSource).text;
  const mobileCaret = mobileVisible.indexOf("\n3.");
  const mobileEdit = markdownListReturn(
    mobileVisible,
    `${mobileVisible.slice(0, mobileCaret)}\n${mobileVisible.slice(mobileCaret)}`,
    mobileCaret,
  );
  assert.ok(mobileEdit);
  const mobileAfter = applyMarkdownListEdit(mobileSource, mobileVisible, mobileCaret, mobileEdit);
  report.mobileMention = { before: mobileSource, after: mobileAfter };
  assert.equal(mobileAfter, `1. one\n2. two\n3. \n4. ${mention}\n5. four`);

  report.passed = true;
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}
