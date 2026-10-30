// Drives the real dev renderer, preload, IPC and managed attachment files. No provider turn is sent.
// Run: bun run test:composer-attachments --allow-mutations
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import type { Locator } from "playwright-core";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

const instance = readDevInstanceRecords().find(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.ok(instance, "Start this checkout's dev app with bun run dev.");
assertMutationAllowed({
  command: "composer-attachments-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const session = await connectToDevApp(instance.remoteDebuggingPort, createOpenBotLogger("composer-attachments-e2e"), {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
const out = resolve(".openbot-build/composer-attachments-e2e");
mkdirSync(out, { recursive: true });
const results: string[] = [];
let passed = false;
const page = session.page;
page.setDefaultTimeout(15_000);
const png = Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII=", "base64"),
);
const png2 = [...png, 0];
const hash = (bytes: number[]) => createHash("sha256").update(new Uint8Array(bytes)).digest("hex");

async function openAgent(name: string): Promise<Locator> {
  await page
    .getByRole("navigation", { name: "Chat list", exact: true })
    .getByRole("button", { name: new RegExp(`^${name},`, "u") })
    .click();
  const editor = page.getByRole("textbox", { name: `Message ${name}`, exact: true });
  await editor.waitFor();
  return editor;
}

async function waitReady(editor: Locator): Promise<void> {
  await page.waitForFunction(() => {
    const editor = document.querySelector('[role="textbox"][aria-multiline="true"]');
    return editor?.getAttribute("contenteditable") === "true";
  });
  await editor.waitFor();
}

async function caretAtEnd(editor: Locator): Promise<void> {
  await editor.evaluate((element) => {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
  });
}

// An inline image shows only in the text. Delete on its reference moves the file to the row above the
// draft, as for any attachment reference; the row's remove button discards the file.
async function removeImages(editor: Locator, name = "image.png"): Promise<void> {
  const reference = editor.getByRole("button", { name: `Open attached file ${name}`, exact: true });
  while (await reference.count()) {
    const count = await reference.count();
    await reference.first().press("Delete");
    await page.waitForFunction(
      (expected) =>
        document.querySelectorAll(".composer-editor-surface [data-attachment-reference-id]").length === expected,
      count - 1,
    );
  }
  const remove = page.getByRole("button", { name: `Remove ${name}`, exact: true });
  while (await remove.count()) await remove.first().click();
}

async function clearTestDraft(editor: Locator): Promise<void> {
  await removeImages(editor);
  await editor.fill("");
}

async function pasteImages(editor: Locator, files: number[][]): Promise<void> {
  await editor.evaluate((element, input) => {
    const clipboard = new DataTransfer();
    for (const bytes of input)
      clipboard.items.add(new File([new Uint8Array(bytes)], "image.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: clipboard }));
  }, files);
  await waitReady(editor);
}

async function copy(editor: Locator, all = true): Promise<Record<string, string>> {
  return editor.evaluate((element, selectAll) => {
    element.focus();
    if (selectAll) {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    const clipboard = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: clipboard }));
    return Object.fromEntries(clipboard.types.map((type) => [type, clipboard.getData(type)]));
  }, all);
}

async function pasteCopy(editor: Locator, data: Record<string, string>): Promise<void> {
  await editor.evaluate((element, payload) => {
    element.focus();
    const clipboard = new DataTransfer();
    for (const [type, value] of Object.entries(payload)) clipboard.setData(type, value);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: clipboard }));
  }, data);
  await waitReady(editor);
}

// The draft as the editor shows it, with each inline attachment as "[name]".
async function layout(editor: Locator): Promise<string> {
  return editor.evaluate((element) =>
    Array.from(element.childNodes, (node) =>
      node instanceof HTMLElement && node.dataset.attachmentReferenceId
        ? `[${node.dataset.attachmentReferenceName}]`
        : (node.textContent ?? ""),
    ).join(""),
  );
}

async function images(editor: Locator): Promise<{ id: string; bytes: number[]; loaded: boolean }[]> {
  return editor.evaluate(async (element) =>
    Promise.all(
      Array.from(element.querySelectorAll<HTMLElement>("[data-attachment-reference-id]")).map(async (token) => {
        const image = token.querySelector("img");
        if (!image) throw new Error("An inline image needs a preview.");
        const response = await fetch(image.src);
        if (!response.ok) throw new Error(`Image read failed: ${response.status}`);
        return {
          id: token.dataset.attachmentReferenceId ?? "",
          bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
          loaded: image.complete && image.naturalWidth > 0,
        };
      }),
    ),
  );
}

try {
  const source = await openAgent("Chief");
  await clearTestDraft(source);
  await source.fill("Before  after");
  // A synthetic copy event has no default action: a native copy leaves its clipboard empty.
  assert.deepEqual(await copy(source), {});
  results.push("A selection without attachments keeps the native copy.");
  await source.evaluate((element) => {
    element.focus();
    const range = document.createRange();
    const text = element.firstChild;
    if (!text) throw new Error("Missing draft text.");
    range.setStart(text, 7);
    range.collapse(true);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
  });
  await pasteImages(source, [png]);
  await page.waitForFunction(
    () => document.querySelectorAll(".composer-editor-surface [data-attachment-reference-id]").length === 1,
  );
  await source.press("x");
  assert.equal(await layout(source), "Before [image.png]x after");
  const first = await copy(source);
  assert.equal(first["text/plain"], "Before image.pngx after");
  assert.equal((await images(source))[0]?.bytes.length, png.length);
  results.push("Binary image paste inserts a resolvable reference exactly at the caret. Copy gives readable text.");

  await caretAtEnd(source);
  await pasteImages(source, [png2]);
  await page.waitForFunction(
    () => document.querySelectorAll(".composer-editor-surface [data-attachment-reference-id]").length === 2,
  );
  const payload = await copy(source);
  const sourceImages = await images(source);
  assert.equal(new Set(sourceImages.map((entry) => entry.id)).size, 2);
  assert.deepEqual(
    sourceImages.map((entry) => hash(entry.bytes)),
    [hash(png), hash(png2)],
  );
  assert.equal(await layout(source), "Before [image.png]x after[image.png]");
  assert.equal(payload["text/plain"], "Before image.pngx afterimage.png");
  assert.ok(payload["text/html"]?.includes("data-openbot-composer-fragment"));
  results.push("Distinct images with the same filename keep their order, IDs and original bytes.");
  await page.screenshot({ path: resolve(out, "source.png") });

  // The source is genuinely discarded through the app before the other agent pastes.
  await removeImages(source);
  await source.fill("");
  const destination = await openAgent("Builder");
  await clearTestDraft(destination);
  await pasteCopy(destination, payload);
  await page.waitForFunction(
    () => document.querySelectorAll(".composer-editor-surface [data-attachment-reference-id]").length === 2,
  );
  const copiedImages = await images(destination);
  assert.deepEqual(
    copiedImages.map((entry) => hash(entry.bytes)),
    [hash(png), hash(png2)],
  );
  assert.ok(copiedImages.every((entry) => !sourceImages.some((original) => original.id === entry.id)));
  results.push("Copy survives source removal and imports independent files into another agent.");

  assert.equal(await layout(destination), "Before [image.png]x after[image.png]");
  const currentCopy = await copy(destination);
  assert.equal(currentCopy["text/plain"], payload["text/plain"]);
  await caretAtEnd(destination);
  await pasteCopy(destination, currentCopy);
  await page.waitForFunction(
    () => document.querySelectorAll(".composer-editor-surface [data-attachment-reference-id]").length === 4,
  );
  assert.equal(new Set((await images(destination)).map((entry) => entry.id)).size, 4);
  results.push("Repeated paste creates fresh attachment identities.");

  const beforeInvalid = (await copy(destination))["text/plain"] ?? "";
  const refusal = await page.evaluate(
    `window.openbot.agent.importAttachmentData({ paths: ["/etc/passwd"], data: [] }, "local").then(() => null, error => error.message)`,
  );
  assert.ok(typeof refusal === "string" && refusal.includes("Invalid attachment data."));
  // A list in the right shape, with a path in place of the bytes.
  const pathItem = await page.evaluate(
    `window.openbot.agent.importAttachmentData([{ name: "passwd", mimeType: "text/plain", path: "/etc/passwd" }], "local").then(() => null, error => error.message)`,
  );
  assert.ok(typeof pathItem === "string", "An item without bytes must be refused.");
  assert.equal((await copy(destination))["text/plain"], beforeInvalid);
  results.push("The byte-only renderer endpoint rejects a disk-path import payload.");
  await page.screenshot({ path: resolve(out, "destination.png") });

  // A picked file has no bytes in memory. The removal waits until the copy has read the file.
  const picked = [...png, 1];
  const pickedPath = resolve(out, "picked.png");
  writeFileSync(pickedPath, new Uint8Array(picked));
  await openAgent("Chief");
  await clearTestDraft(source);
  await source.fill("See the file");
  await page.locator("input[data-openbot-attachment-picker]").setInputFiles(pickedPath);
  const removePicked = page.getByRole("button", { name: "Remove picked.png", exact: true });
  await removePicked.waitFor();
  const pickedCopy = await copy(source);
  await removePicked.click();
  await removePicked.waitFor({ state: "detached" });
  await source.fill("");
  const pickedTarget = await openAgent("Launch");
  await clearTestDraft(pickedTarget);
  await pasteCopy(pickedTarget, pickedCopy);
  await page.waitForFunction(
    () => document.querySelectorAll(".composer-editor-surface [data-attachment-reference-id]").length === 1,
  );
  assert.deepEqual(
    (await images(pickedTarget)).map((entry) => hash(entry.bytes)),
    [hash(picked)],
  );
  await removeImages(pickedTarget, "picked.png");
  await pickedTarget.fill("");
  results.push("A copied file from disk survives its removal from the source draft.");
  await openAgent("Builder");

  // Exercise the operating system clipboard as well as synthetic clipboard events.
  const destinationLayout = await layout(destination);
  await destination.press("ControlOrMeta+a");
  await destination.press("ControlOrMeta+c");
  const nativeTarget = await openAgent("Research");
  await clearTestDraft(nativeTarget);
  await nativeTarget.press("ControlOrMeta+v");
  await page.waitForFunction(
    () => document.querySelectorAll(".composer-editor-surface [data-attachment-reference-id]").length === 4,
  );
  assert.deepEqual(
    (await images(nativeTarget)).map((entry) => hash(entry.bytes)),
    [hash(png), hash(png2), hash(png), hash(png2)],
  );
  assert.equal(await layout(nativeTarget), destinationLayout);
  results.push("Native Cmd/Ctrl+C and Cmd/Ctrl+V preserve text and original image bytes across agents.");
  await page.screenshot({ path: resolve(out, "native-clipboard.png") });
  passed = true;
} finally {
  writeFileSync(resolve(out, "report.json"), `${JSON.stringify({ results, passed }, null, 2)}\n`);
  await session.close();
}
// Machine-readable: E2E report for the caller.
process.stdout.write(`${JSON.stringify({ results, passed }, null, 2)}\n`);
