import assert from "node:assert/strict";
import { translateFor } from "@openbot/i18n";
import type { Page } from "playwright-core";
import { connectChannelE2e, writeReport } from "./channel-e2e-support";

const NAME = "workflow-paste-chat-e2e";
const UI_WAIT_MS = 30_000;
const english = translateFor("en");
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const AGENT_NAME_MARK = "AGENT-NAME-MARK";
const composerName = new RegExp(
  `^${english("composer.placeholder.message", { name: AGENT_NAME_MARK }).split(AGENT_NAME_MARK).map(literal).join(".+")}$`,
);

interface PasteResult {
  nodesBefore: number;
  nodesAfter: number;
  windowSawPaste: boolean;
}

interface Report {
  chatPastePicture: string;
  canvasPastePicture: string;
  pageErrors: string[];
  chatPasteAttached?: boolean;
  canvasPaste?: PasteResult;
  canvasPictureInChat?: boolean;
  passed?: boolean;
}

const session = await connectChannelE2e(NAME);
const { page } = session;
const pageErrors: string[] = [];
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
const id = crypto.randomUUID().slice(0, 8);
const report: Report = {
  chatPastePicture: `chat-paste-${id}.png`,
  canvasPastePicture: `canvas-paste-${id}.png`,
  pageErrors,
};
const rail = page.getByRole("navigation", { name: english("app.rail.label") });
const removeButton = (name: string) =>
  page.getByRole("button", { name: english("composer.attachment.remove", { name }), exact: true });

async function openChat(): Promise<void> {
  await rail.getByRole("button", { name: english("app.rail.agents"), exact: true }).click({ timeout: UI_WAIT_MS });
  await page.getByRole("textbox", { name: composerName }).first().waitFor({ timeout: UI_WAIT_MS });
}

async function pastePicture(target: Page, name: string): Promise<PasteResult> {
  return target.evaluate(async (fileName) => {
    const canvas = new OffscreenCanvas(256, 256);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2D context.");
    context.fillStyle = "#3a6";
    context.fillRect(0, 0, 256, 256);
    const file = new File([await canvas.convertToBlob({ type: "image/png" })], fileName, { type: "image/png" });
    const nodes = () => document.querySelectorAll("[data-node-id]").length;
    const nodesBefore = nodes();
    let windowSawPaste = false;
    const probe = () => {
      windowSawPaste = true;
    };
    window.addEventListener("paste", probe);
    const data = new DataTransfer();
    data.items.add(file);
    const paste = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    (document.activeElement ?? document.body).dispatchEvent(paste);
    window.removeEventListener("paste", probe);
    return { nodesBefore, nodesAfter: nodes(), windowSawPaste };
  }, name);
}

const before = new Set((await page.evaluate(() => window.openbot.workflows.list())).map((entry) => entry.id));
try {
  await page.bringToFront();
  await openChat();
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  await pastePicture(page, report.chatPastePicture);
  await removeButton(report.chatPastePicture).waitFor({ timeout: UI_WAIT_MS });
  report.chatPasteAttached = true;
  await removeButton(report.chatPastePicture).click();
  await removeButton(report.chatPastePicture).waitFor({ state: "detached", timeout: UI_WAIT_MS });

  await rail.getByRole("button", { name: english("app.rail.workflows"), exact: true }).click();
  const canvasName = new RegExp(`^${literal(english("workflow.canvas.label", { name: "" }))}`);
  const canvas = page.getByRole("main", { name: canvasName });
  await canvas.waitFor({ timeout: UI_WAIT_MS });
  await page.getByRole("button", { name: english("workflow.canvas.switcher.new"), exact: true }).click();
  await page.getByRole("button", { name: english("workflow.canvas.start.blank") }).click({ timeout: UI_WAIT_MS });
  const box = await canvas.boundingBox();
  assert.ok(box, "The workflow canvas has no box.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 4, box.y + box.height / 2 + 4);
  const pasted = await pastePicture(page, report.canvasPastePicture);
  await page.waitForFunction(
    (count) => document.querySelectorAll("[data-node-id]").length > count,
    pasted.nodesBefore,
    { timeout: UI_WAIT_MS },
  );
  report.canvasPaste = pasted;
  assert.equal(pasted.windowSawPaste, false, "The canvas paste reached the window listener that fills the chat box.");

  await openChat();
  report.canvasPictureInChat = (await removeButton(report.canvasPastePicture).count()) > 0;
  assert.equal(report.canvasPictureInChat, false, "The picture pasted on the canvas is in the chat box.");
  report.passed = true;
} finally {
  await page
    .evaluate(
      async (known) => {
        for (const entry of await window.openbot.workflows.list())
          if (!known.includes(entry.id)) await window.openbot.workflows.delete(entry.id);
      },
      [...before],
    )
    .catch(() => undefined);
  const path = writeReport(NAME, report);
  process.stdout.write(`Report: ${path}\n`);
  await session.close();
}
