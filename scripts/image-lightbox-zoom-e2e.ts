// Checks the zoom of the image viewer in the desktop app, with no provider turn.
// Start the app with `bun run dev` (never `--shared`), then run
// `bun scripts/image-lightbox-zoom-e2e.ts --allow-mutations`.
//
// Through the desktop bridge it makes a channel with no lead and posts a large PNG to it with no
// recipient. On the desktop it opens the image and checks that:
// 1. the viewer opens with the image fitted, below its natural size;
// 2. Ctrl and the wheel zoom in, and the image grows;
// 3. a drag moves the zoomed image and does not close the viewer;
// 4. "0" fits the image again, "+" zooms in, and the zoom level button fits;
// 5. a double-click zooms in, a click on the zoomed image keeps the viewer, and a second
//    double-click fits;
// 6. Escape closes the viewer.
// It deletes its channel at the end. Writes .openbot-build/image-lightbox-zoom-e2e/report.json and screenshots.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { translateFor } from "@openbot/i18n";
import type { Locator } from "playwright-core";
import { ChannelClient, connectChannelE2e, waitFor, writeReport } from "./channel-e2e-support";

const OUT = resolve(import.meta.dirname, "../.openbot-build/image-lightbox-zoom-e2e");
const UI_WAIT_MS = 30_000;
const IMAGE_NAME = "zoom-check.png";
const IMAGE_WIDTH = 3200;
const IMAGE_HEIGHT = 2000;
const english = translateFor("en");

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Report {
  channelId?: string;
  fitted?: { percent: number; box: Box };
  wheel?: { percent: number; box: Box };
  drag?: { before: Box; after: Box; viewerOpen: boolean };
  keys?: { fitPercent: number; zoomInPercent: number; buttonFitPercent: number };
  doubleClick?: { zoomedPercent: number; clickKeptViewer: boolean; fittedPercent: number };
  closedWithEscape?: boolean;
  pageErrors: string[];
  screenshots: string[];
  passed: boolean;
}

const report: Report = { pageErrors: [], screenshots: [], passed: false };
const session = await connectChannelE2e("image-lightbox-zoom-e2e");
const desktop = session.page;
desktop.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
const client = new ChannelClient(desktop);
const name = `E2E zoom ${crypto.randomUUID().slice(0, 4)}`;

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const conversation = () => desktop.getByRole("main", { name: english("conversation.view.label") });
const sidebarRow = () =>
  desktop
    .getByRole("navigation", { name: english("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${literal(name)}[,.]`) })
    .first();
const viewer = () => desktop.getByRole("dialog", { name: IMAGE_NAME });
const image = () => viewer().getByRole("img", { name: IMAGE_NAME });
const fitLabel = new RegExp(`^${literal(english("chat.preview.zoomFit", { zoom: "\0" })).replace("\0", "(\\d+)%")}$`);
const fitButton = () => viewer().getByRole("button", { name: fitLabel });

async function shot(label: string, target: Locator): Promise<void> {
  const path = resolve(OUT, `${label}.png`);
  await target.screenshot({ path });
  report.screenshots.push(path);
}

/** The zoom level that the viewer shows, in percent of the natural size. */
async function percent(): Promise<number> {
  const label = (await fitButton().getAttribute("aria-label")) ?? "";
  const match = fitLabel.exec(label);
  assert.ok(match?.[1], `The zoom level button has no level: ${label}`);
  return Number(match[1]);
}

/** The image's box once its zoom and its animations have ended. */
async function settledBox(): Promise<Box> {
  await desktop.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
  const box = await image().boundingBox();
  assert.ok(box, "The viewer shows no image.");
  return box;
}

const centre = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

try {
  const agent = (await client.agents())[0];
  assert.ok(agent, "This check needs one visible agent as a channel member.");
  const channel = await client.create(name, [agent.id], null);
  report.channelId = channel.id;

  // A large image with fine detail, so a fitted view is below its natural size.
  const draftIds = await desktop.evaluate(
    async ({ fileName, width, height }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const draw = canvas.getContext("2d");
      if (!draw) throw new Error("No canvas context.");
      draw.fillStyle = "white";
      draw.fillRect(0, 0, width, height);
      draw.strokeStyle = "black";
      for (let x = 0; x < width; x += 40) draw.strokeRect(x, 0, 1, height);
      for (let y = 0; y < height; y += 40) draw.strokeRect(0, y, width, 1);
      draw.fillStyle = "black";
      draw.font = "14px sans-serif";
      for (let y = 30; y < height; y += 80) for (let x = 10; x < width; x += 160) draw.fillText(`${x},${y}`, x, y);
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
      if (!blob) throw new Error("The canvas made no PNG.");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const drafts = await window.openbot.agent.importAttachmentData(
        [{ name: fileName, mimeType: "image/png", bytes }],
        "local",
      );
      return drafts.map((draft) => draft.id);
    },
    { fileName: IMAGE_NAME, width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
  );
  assert.equal(draftIds.length, 1, "The image did not import.");
  await client.command({
    type: "send",
    operationId: crypto.randomUUID(),
    channelId: channel.id,
    text: "Zoom check.",
    recipientAgentId: null,
    replyToMessageId: null,
    attachmentDraftIds: draftIds,
  });
  // No agent works on the message: this check needs no provider.
  for (const task of (await client.read(channel.id)).tasks)
    if (task.state === "queued" || task.state === "running" || task.state === "waiting")
      await client.taskCommand("stop", channel.id, task.id);

  await sidebarRow().click();
  const card = conversation().getByRole("button", { name: english("attachment.preview", { name: IMAGE_NAME }) });
  await card.waitFor({ timeout: UI_WAIT_MS });
  await card.click();
  await image().waitFor({ timeout: UI_WAIT_MS });
  // The level shows 100% until the image loads and has its fitted size.
  await waitFor(desktop, "the image has its fitted size", percent, (value) => value < 100, UI_WAIT_MS);

  // 1. The image opens fitted.
  const fittedBox = await settledBox();
  const fittedPercent = await percent();
  report.fitted = { percent: fittedPercent, box: fittedBox };
  assert.ok(fittedPercent < 100, `A ${IMAGE_WIDTH}px image opened at ${fittedPercent}%, not fitted.`);
  await shot("fitted", desktop.locator("body"));

  // 2. Ctrl and the wheel zoom in.
  const point = centre(fittedBox);
  await desktop.mouse.move(point.x, point.y);
  await desktop.keyboard.down("Control");
  await desktop.mouse.wheel(0, -120);
  await desktop.keyboard.up("Control");
  const wheelPercent = await waitFor(
    desktop,
    "the wheel zooms in",
    percent,
    (value) => value > fittedPercent,
    UI_WAIT_MS,
  );
  const wheelBox = await settledBox();
  report.wheel = { percent: wheelPercent, box: wheelBox };
  assert.ok(wheelBox.width > fittedBox.width * 1.5, "The image did not grow with the zoom.");
  await shot("zoomed", desktop.locator("body"));

  // 3. A drag moves the zoomed image, and the viewer stays open.
  await desktop.mouse.move(point.x, point.y);
  await desktop.mouse.down();
  await desktop.mouse.move(point.x + 160, point.y + 90, { steps: 8 });
  await desktop.mouse.up();
  const draggedBox = await settledBox();
  const viewerOpen = await viewer().isVisible();
  report.drag = { before: wheelBox, after: draggedBox, viewerOpen };
  assert.ok(viewerOpen, "The drag closed the viewer.");
  assert.ok(Math.abs(draggedBox.x - wheelBox.x - 160) < 2, "The drag did not move the image with the pointer.");
  assert.ok(Math.abs(draggedBox.y - wheelBox.y - 90) < 2, "The drag did not move the image with the pointer.");
  await shot("dragged", desktop.locator("body"));

  // 4. The keys and the zoom level button.
  await desktop.keyboard.press("0");
  const fitPercent = await waitFor(desktop, "0 fits", percent, (value) => value === fittedPercent, UI_WAIT_MS);
  const refitBox = await settledBox();
  assert.ok(Math.abs(refitBox.width - fittedBox.width) < 1, "0 did not give back the fitted size.");
  await desktop.keyboard.press("+");
  const zoomInPercent = await waitFor(desktop, "+ zooms in", percent, (value) => value > fittedPercent, UI_WAIT_MS);
  await fitButton().click();
  const buttonFitPercent = await waitFor(
    desktop,
    "the zoom level button fits",
    percent,
    (value) => value === fittedPercent,
    UI_WAIT_MS,
  );
  report.keys = { fitPercent, zoomInPercent, buttonFitPercent };

  // 5. A double-click zooms in, and a second one fits.
  const doublePoint = centre(await settledBox());
  await desktop.mouse.dblclick(doublePoint.x, doublePoint.y);
  const zoomedPercent = await waitFor(
    desktop,
    "a double-click zooms in",
    percent,
    (value) => value > fittedPercent * 2,
    UI_WAIT_MS,
  );
  await settledBox();
  // A click on a zoomed image, with no drag, keeps the viewer and the zoom.
  await desktop.mouse.click(doublePoint.x, doublePoint.y);
  const clickKeptViewer = await viewer().isVisible();
  assert.ok(clickKeptViewer, "A click on the zoomed image closed the viewer.");
  assert.equal(await percent(), zoomedPercent, "A click on the zoomed image changed the zoom.");
  await desktop.mouse.dblclick(doublePoint.x, doublePoint.y);
  const doubleFitPercent = await waitFor(
    desktop,
    "a second double-click fits",
    percent,
    (value) => value === fittedPercent,
    UI_WAIT_MS,
  );
  report.doubleClick = { zoomedPercent, clickKeptViewer, fittedPercent: doubleFitPercent };
  assert.ok(await viewer().isVisible(), "A double-click closed the viewer.");

  // 6. Escape closes the viewer.
  await desktop.keyboard.press("Escape");
  await viewer().waitFor({ state: "detached", timeout: UI_WAIT_MS });
  report.closedWithEscape = true;

  assert.deepEqual(report.pageErrors, [], "The page had errors.");
  report.passed = true;
} finally {
  await client.cleanup().catch(() => undefined);
  writeReport("image-lightbox-zoom-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
