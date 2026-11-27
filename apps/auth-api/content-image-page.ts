// Runs inside a throwaway Electron page during `vite build`. Bundled to a single
// classic script by content-images.ts and injected with `executeJavaScript`, so
// it must not rely on module loading, the network, or anything on the page.
//
// Workers have no WebGL, so the card artwork cannot be produced at request time.
// This is the one place that turns the shared gradient description into pixels.

import { APP_LOGO_CORNER, APP_LOGO_EYE_POINTS, APP_LOGO_SIZE } from "@openbot/brand/app-logo-shape";
import { getShaderColorFromString, meshGradientFragmentShader, ShaderMount } from "@paper-design/shaders";
import type { ContentImageJob, ContentImageLockup, ContentImageMark, ContentImageRenderJob } from "./content-images";
import { RIVAL_MARK_SHAPES, type RivalMarkName } from "./src/components/compare/rival-mark-shapes";
import { articleGradient, articleGradientUniforms } from "./src/lib/article-gradient";

declare global {
  interface Window {
    openBotContentImage?: { render: (job: ContentImageRenderJob) => Promise<string> };
  }
}

/** `--openbot-bg-canvas`, as the RGB channels of the scrim. */
const SCRIM_COLOR = "26, 26, 26";
const TITLE_MAX_LINES = 3;
/** Under a lockup or a row of marks there is room for two lines. */
const TITLE_MAX_LINES_WITH_LOCKUP = 2;
/** `--openbot-logo-production` and `--openbot-logo-eye`. */
const LOGO_BACKGROUND = "#d6adf2";
const LOGO_EYE = "#040007";
/** The black logo with light eyes from the brand rules, for the felt patch. */
const DARK_LOGO = { background: "#040007", eye: "#fefdff" } as const;
const LIGHT_LOGO = { background: LOGO_BACKGROUND, eye: LOGO_EYE } as const;

/** The felt under a centred card is darkened to this average luma, so white marks on the patch stay readable. */
const FELT_MAX_LUMA = 0.5;
/** How strongly the fibres of the felt are drawn again over it. */
const FELT_DETAIL_STRENGTH = 0.8;
const FONT_FAMILY = '"Inter Variable", Inter, system-ui, sans-serif';

window.openBotContentImage = { render: renderContentImage };

/**
 * Lossy, for the artwork only: a smooth gradient loses nothing a reader can see,
 * and the file is about 3% of the PNG. Bump `GENERATOR_VERSION` when this changes.
 */
const WEBP_QUALITY = 0.9;

async function renderContentImage(job: ContentImageRenderJob): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = job.width;
  canvas.height = job.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Content images: a 2D canvas context is not available.");

  if (job.backgroundUrl) await drawBackgroundImage(context, job, job.backgroundUrl);
  else await drawGradient(context, job);
  if (job.layout === "centered") {
    // Only the marks, in the middle: the platform shows the title under the card.
    if (job.lockup) drawCenteredLockup(context, job, job.lockup);
    else if (job.markRow) drawCenteredMarkRow(context, job, job.markRow);
  } else if (job.title && job.withTitle) {
    drawScrim(context, job);
    if (job.lockup) drawLockup(context, job, job.lockup);
    else if (job.markRow) drawMarkRow(context, job, job.markRow);
    drawTitle(context, job);
  }

  return job.fileName.endsWith(".webp") ? canvas.toDataURL("image/webp", WEBP_QUALITY) : canvas.toDataURL("image/png");
}

/** A background from the design file, already cut to the size of the card. */
async function drawBackgroundImage(
  context: CanvasRenderingContext2D,
  job: ContentImageJob,
  backgroundUrl: string,
): Promise<void> {
  const image = new Image();
  image.src = backgroundUrl;
  await image.decode();
  context.drawImage(image, 0, 0, job.width, job.height);
  if (job.layout !== "centered") return;

  // On a pale felt, white marks disappear. Measured
  // where the plate goes, the middle of the card.
  const luma = averageLuma(context, job.width * 0.25, job.height * 0.3, job.width * 0.5, job.height * 0.4);
  if (luma > FELT_MAX_LUMA) {
    context.filter = `brightness(${(FELT_MAX_LUMA / luma).toFixed(3)}) saturate(1.3)`;
    context.drawImage(image, 0, 0, job.width, job.height);
    context.filter = "none";
  }
  drawFeltDetail(context, job, image);
}

/**
 * The image with its edge pixels stretched outwards by `pad`, so a blur near the
 * edge does not take in the empty pixels outside the card.
 */
function edgePadded(image: HTMLImageElement, job: ContentImageJob, pad: number): HTMLCanvasElement {
  const { width, height } = job;
  const canvas = document.createElement("canvas");
  canvas.width = width + pad * 2;
  canvas.height = height + pad * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Content images: a 2D canvas context is not available.");
  const sx = image.naturalWidth / width;
  const sy = image.naturalHeight / height;
  context.drawImage(image, 0, 0, image.naturalWidth, sy, pad, 0, width, pad);
  context.drawImage(image, 0, image.naturalHeight - sy, image.naturalWidth, sy, pad, height + pad, width, pad);
  context.drawImage(image, 0, 0, sx, image.naturalHeight, 0, pad, pad, height);
  context.drawImage(image, image.naturalWidth - sx, 0, sx, image.naturalHeight, width + pad, pad, pad, height);
  context.drawImage(image, pad, pad, width, height);
  return canvas;
}

/**
 * Makes the felt read as felt at the size of a link preview: the fine detail of
 * the image (the image less a blur of itself, as a grey around the middle) is
 * laid back over it, stronger, with an overlay blend that keeps the colour.
 */
function drawFeltDetail(context: CanvasRenderingContext2D, job: ContentImageJob, image: HTMLImageElement): void {
  const unit = job.width / 1200;
  const detail = document.createElement("canvas");
  detail.width = job.width;
  detail.height = job.height;
  const detailContext = detail.getContext("2d");
  if (!detailContext) throw new Error("Content images: a 2D canvas context is not available.");
  detailContext.filter = "grayscale(1)";
  detailContext.drawImage(image, 0, 0, job.width, job.height);
  detailContext.globalAlpha = 0.5;
  detailContext.filter = `grayscale(1) invert(1) blur(${6 * unit}px)`;
  detailContext.drawImage(edgePadded(image, job, 24 * unit), -24 * unit, -24 * unit);

  context.save();
  context.globalCompositeOperation = "overlay";
  context.globalAlpha = FELT_DETAIL_STRENGTH;
  context.filter = "contrast(3)";
  context.drawImage(detail, 0, 0);
  context.restore();
}

async function drawGradient(context: CanvasRenderingContext2D, job: ContentImageJob): Promise<void> {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:0;top:0;width:${job.width}px;height:${job.height}px;`;
  document.body.append(host);

  const gradient = articleGradient(job.title);
  const mount = new ShaderMount(
    host,
    meshGradientFragmentShader,
    articleGradientUniforms(gradient, getShaderColorFromString),
    // Without this the colour buffer is undefined by the time toDataURL reads it,
    // which shows up as an image that is empty on some machines and correct on
    // others.
    { preserveDrawingBuffer: true },
    0,
    gradient.frame,
  );

  try {
    // The mount sizes its canvas from a ResizeObserver callback, so nothing can
    // be read back until that callback has run at least once.
    await waitForCanvas(mount.canvasElement);
    // Draws synchronously at exactly this frame, which is what makes two runs of
    // the build produce the same bytes.
    mount.setFrame(gradient.frame);
    // The shader canvas is rendered at twice the output size, so this draw is a
    // supersample rather than a stretch.
    context.drawImage(mount.canvasElement, 0, 0, job.width, job.height);
  } finally {
    mount.dispose();
    host.remove();
  }
}

const CANVAS_TIMEOUT_MS = 10_000;

async function waitForCanvas(canvas: HTMLCanvasElement): Promise<void> {
  const deadline = Date.now() + CANVAS_TIMEOUT_MS;
  while (canvas.width === 0 || canvas.height === 0) {
    if (Date.now() > deadline) {
      throw new Error("Paper shaders: the canvas was never sized. The page produced no frames.");
    }
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

/**
 * A scrim only over the lower half. The gradient stays readable as artwork and
 * the text keeps its contrast whatever colours the title happened to draw.
 */
function drawScrim(context: CanvasRenderingContext2D, job: ContentImageJob): void {
  const scrim = context.createLinearGradient(0, job.height * 0.3, 0, job.height);
  scrim.addColorStop(0, `rgba(${SCRIM_COLOR}, 0)`);
  scrim.addColorStop(1, `rgba(${SCRIM_COLOR}, 0.88)`);
  context.fillStyle = scrim;
  context.fillRect(0, 0, job.width, job.height);
}

function drawTitle(context: CanvasRenderingContext2D, job: ContentImageJob): void {
  const { width, height } = job;
  const padding = Math.round(width * 0.06);
  const titleSize = Math.round(width * 0.052);
  const lineHeight = Math.round(titleSize * 1.14);

  context.textBaseline = "alphabetic";
  context.font = `600 ${titleSize}px ${FONT_FAMILY}`;
  const maxLines = job.lockup || job.markRow ? TITLE_MAX_LINES_WITH_LOCKUP : TITLE_MAX_LINES;
  const lines = wrapText(context, job.title, width - padding * 2, maxLines);

  // The block is anchored to the bottom, so a one-line and a three-line title
  // both sit on the same baseline and the set reads as one series.
  const lastBaseline = height - padding;
  const firstBaseline = lastBaseline - (lines.length - 1) * lineHeight;

  context.fillStyle = "#ffffff";
  lines.forEach((line, index) => {
    context.fillText(line, padding, firstBaseline + index * lineHeight);
  });

  if (job.wordmark) {
    // The wordmark of the site's social cards: lowercase Inter Bold in white.
    context.font = `700 ${Math.round(width * 0.03)}px ${FONT_FAMILY}`;
    context.fillStyle = "#ffffff";
    context.fillText("openbot.", padding, firstBaseline - lineHeight);
    return;
  }
  const eyebrowSize = Math.round(width * 0.017);
  context.font = `600 ${eyebrowSize}px ${FONT_FAMILY}`;
  context.fillStyle = "rgba(255, 255, 255, 0.62)";
  context.fillText(job.eyebrow, padding, firstBaseline - lineHeight);
}

/**
 * The lockup from the top of a comparison page: one frosted plate with both marks,
 * split by a hairline with "vs" on it. It sits at the top left, over the title,
 * on the same left edge.
 */
function drawLockup(context: CanvasRenderingContext2D, job: ContentImageJob, lockup: ContentImageLockup): void {
  const unit = job.width / 1200;
  const logoSize = 128 * unit;
  const column = 180 * unit;
  const padX = 40 * unit;
  const padY = 36 * unit;
  const nameGap = 16 * unit;
  const nameSize = 26 * unit;
  const vsWidth = 24 * unit;
  const vsMargin = 36 * unit;
  const plateWidth = padX * 2 + column * 2 + vsMargin * 2 + vsWidth;
  const plateHeight = padY * 2 + logoSize + nameGap + nameSize * 1.2;
  const x = Math.round(job.width * 0.06);
  const y = 64 * unit;
  drawPlate(context, job, x, y, plateWidth, plateHeight);

  const logoTop = y + padY;
  const left = x + padX + (column - logoSize) / 2;
  const right = x + padX + column + vsMargin * 2 + vsWidth + (column - logoSize) / 2;
  drawMark(context, lockup.left?.mark ?? "openbot", left, logoTop, logoSize);
  drawMark(context, lockup.rivalMark, right, logoTop, logoSize);

  context.font = `500 ${nameSize}px ${FONT_FAMILY}`;
  context.fillStyle = "rgba(255, 255, 255, 0.86)";
  context.textAlign = "center";
  const nameBaseline = logoTop + logoSize + nameGap + nameSize * 0.9;
  context.fillText(lockup.left?.name ?? "OpenBot", left + logoSize / 2, nameBaseline);
  context.fillText(lockup.rivalName, right + logoSize / 2, nameBaseline);

  // The hairline, broken around "vs".
  const center = x + padX + column + vsMargin + vsWidth / 2;
  const middle = y + plateHeight / 2;
  const vsSize = 20 * unit;
  const gap = vsSize * 0.9;
  context.strokeStyle = "rgba(255, 255, 255, 0.2)";
  context.lineWidth = unit;
  context.beginPath();
  context.moveTo(center, y + padY);
  context.lineTo(center, middle - gap);
  context.moveTo(center, middle + gap);
  context.lineTo(center, y + plateHeight - padY);
  context.stroke();
  context.font = `500 ${vsSize}px ${FONT_FAMILY}`;
  context.fillStyle = "rgba(255, 255, 255, 0.62)";
  context.textBaseline = "middle";
  context.fillText("vs", center, middle);
  context.textAlign = "start";
  context.textBaseline = "alphabetic";
}

/**
 * The lockup of an index card, in the middle of the social card: both marks and
 * "vs" on one wide plate, with no names, and room around each mark.
 */
function drawCenteredLockup(context: CanvasRenderingContext2D, job: ContentImageJob, lockup: ContentImageLockup): void {
  const unit = job.width / 1200;
  const plateWidth = 600 * unit;
  const plateHeight = 216 * unit;
  const logoSize = 96 * unit;
  const x = (job.width - plateWidth) / 2;
  const y = (job.height - plateHeight) / 2;
  drawFeltPatch(context, job, x, y, plateWidth, plateHeight);

  const logoTop = y + (plateHeight - logoSize) / 2;
  context.save();
  setMarkShadow(context, unit);
  drawMark(context, lockup.left?.mark ?? "openbot", x + plateWidth * 0.25 - logoSize / 2, logoTop, logoSize, DARK_LOGO);
  drawMark(context, lockup.rivalMark, x + plateWidth * 0.75 - logoSize / 2, logoTop, logoSize, DARK_LOGO);
  context.restore();

  // The hairline, broken around "vs".
  const center = x + plateWidth / 2;
  const middle = y + plateHeight / 2;
  const vsSize = 20 * unit;
  const gap = vsSize * 1.1;
  const inset = 64 * unit;
  context.save();
  setMarkShadow(context, unit);
  context.strokeStyle = "rgba(255, 255, 255, 0.5)";
  context.lineWidth = unit;
  context.beginPath();
  context.moveTo(center, y + inset);
  context.lineTo(center, middle - gap);
  context.moveTo(center, middle + gap);
  context.lineTo(center, y + plateHeight - inset);
  context.stroke();
  context.font = `500 ${vsSize}px ${FONT_FAMILY}`;
  context.fillStyle = "rgba(255, 255, 255, 0.9)";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("vs", center, middle);
  context.restore();
}

/** A soft shadow under the white marks, so they stand off the felt. */
function setMarkShadow(context: CanvasRenderingContext2D, unit: number): void {
  context.shadowColor = "rgba(12, 10, 24, 0.28)";
  context.shadowBlur = 14 * unit;
  context.shadowOffsetY = 2 * unit;
}

/** The roundup's marks in the middle of the social card, smaller than the title layout's, with room around each. */
function drawCenteredMarkRow(
  context: CanvasRenderingContext2D,
  job: ContentImageJob,
  marks: readonly ContentImageMark[],
): void {
  const unit = job.width / 1200;
  const size = 48 * unit;
  const gap = 28 * unit;
  const padX = 48 * unit;
  const padY = 44 * unit;
  const plateWidth = padX * 2 + size * marks.length + gap * (marks.length - 1);
  const plateHeight = padY * 2 + size;
  const x = (job.width - plateWidth) / 2;
  const y = (job.height - plateHeight) / 2;
  drawFeltPatch(context, job, x, y, plateWidth, plateHeight);
  context.save();
  setMarkShadow(context, unit);
  marks.forEach((mark, index) => {
    drawMark(context, mark, x + padX + index * (size + gap), y + padY, size, DARK_LOGO);
  });
  context.restore();
}

/** The roundup's lockup: one frosted plate with the mark of every app in a row, at the same place. */
function drawMarkRow(
  context: CanvasRenderingContext2D,
  job: ContentImageJob,
  marks: readonly ContentImageMark[],
): void {
  const unit = job.width / 1200;
  const pad = 32 * unit;
  const gap = 20 * unit;
  const margin = Math.round(job.width * 0.06);
  // As large as fits in the width of the title, and no larger than the lockup's marks.
  const available = job.width - margin * 2 - pad * 2 - gap * (marks.length - 1);
  const size = Math.min(128 * unit, available / marks.length);
  const plateWidth = pad * 2 + size * marks.length + gap * (marks.length - 1);
  const plateHeight = pad * 2 + size;
  const x = margin;
  const y = 64 * unit;
  drawPlate(context, job, x, y, plateWidth, plateHeight);
  marks.forEach((mark, index) => {
    drawMark(context, mark, x + pad + index * (size + gap), y + pad, size);
  });
}

/**
 * A patch of the same felt sewn onto the card: a lighter piece cut from another
 * part of the background, a stitch just inside its edge and a short shadow.
 */
function drawFeltPatch(
  context: CanvasRenderingContext2D,
  job: ContentImageJob,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const unit = job.width / 1200;
  const radius = 36 * unit;
  const under = document.createElement("canvas");
  under.width = job.width;
  under.height = job.height;
  under.getContext("2d")?.drawImage(context.canvas, 0, 0);

  context.save();
  context.shadowColor = "rgba(12, 10, 24, 0.32)";
  context.shadowBlur = 14 * unit;
  context.shadowOffsetY = 5 * unit;
  roundedRect(context, x, y, width, height, radius);
  context.fillStyle = "#000000";
  context.fill();
  context.restore();

  context.save();
  roundedRect(context, x, y, width, height, radius);
  context.clip();
  // Another part of the felt, turned half a turn, so its fibres do not line up.
  context.translate(x + width / 2, y + height / 2);
  context.rotate(Math.PI);
  context.filter = "brightness(1.14) saturate(1.05)";
  context.drawImage(under, -job.width / 2 + 90 * unit, -job.height / 2 + 40 * unit);
  context.restore();

  // The cut edge: lit at the top, in shade at the bottom.
  const edge = context.createLinearGradient(0, y, 0, y + height);
  edge.addColorStop(0, "rgba(255, 255, 255, 0.3)");
  edge.addColorStop(1, "rgba(0, 0, 0, 0.18)");
  context.save();
  roundedRect(context, x + unit, y + unit, width - 2 * unit, height - 2 * unit, radius);
  context.strokeStyle = edge;
  context.lineWidth = 2 * unit;
  context.stroke();

  // The stitch.
  const inset = 12 * unit;
  roundedRect(context, x + inset, y + inset, width - inset * 2, height - inset * 2, radius - inset);
  context.setLineDash([9 * unit, 7 * unit]);
  context.lineCap = "round";
  context.strokeStyle = "rgba(255, 255, 255, 0.6)";
  context.lineWidth = 2 * unit;
  context.shadowColor = "rgba(0, 0, 0, 0.3)";
  context.shadowBlur = 2 * unit;
  context.shadowOffsetY = unit;
  context.stroke();
  context.restore();
}

/** The average luma of an area, from a sparse sample of its pixels. */
function averageLuma(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): number {
  const pixels = context.getImageData(Math.round(x), Math.round(y), Math.round(width), Math.round(height)).data;
  let total = 0;
  let count = 0;
  for (let offset = 0; offset < pixels.length; offset += 4 * 37) {
    total += 0.2126 * (pixels[offset] ?? 0) + 0.7152 * (pixels[offset + 1] ?? 0) + 0.0722 * (pixels[offset + 2] ?? 0);
    count += 1;
  }
  return total / count / 255;
}

/** The frosted plate under the marks, with a hairline edge. */
function drawPlate(
  context: CanvasRenderingContext2D,
  job: ContentImageJob,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const unit = job.width / 1200;
  const radius = 24 * unit;

  // The frost: what is under the plate, blurred. A copy, because a canvas that
  // draws itself through a filter reads the pixels it is writing.
  const under = document.createElement("canvas");
  under.width = job.width;
  under.height = job.height;
  under.getContext("2d")?.drawImage(context.canvas, 0, 0);
  context.save();
  roundedRect(context, x, y, width, height, radius);
  context.clip();
  context.filter = `blur(${24 * unit}px) saturate(1.4)`;
  context.drawImage(under, 0, 0);
  context.filter = "none";
  context.fillStyle = "rgba(14, 14, 18, 0.26)";
  context.fillRect(x, y, width, height);
  context.restore();

  context.save();
  roundedRect(context, x + 0.75, y + 0.75, width - 1.5, height - 1.5, radius);
  context.strokeStyle = "rgba(255, 255, 255, 0.14)";
  context.lineWidth = 1.5;
  context.stroke();
  context.restore();
}

function drawMark(
  context: CanvasRenderingContext2D,
  mark: ContentImageMark,
  x: number,
  y: number,
  size: number,
  logo: { background: string; eye: string } = LIGHT_LOGO,
): void {
  if (mark === "openbot") drawOpenBotMark(context, x, y, size, logo);
  else drawRivalMark(context, mark, x, y, size);
}

/** `AppLogo`: the rounded square and the two scribbled eyes. */
function drawOpenBotMark(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  logo: { background: string; eye: string },
): void {
  context.save();
  context.translate(x, y);
  context.scale(size / APP_LOGO_SIZE, size / APP_LOGO_SIZE);
  roundedRect(context, 0, 0, APP_LOGO_SIZE, APP_LOGO_SIZE, APP_LOGO_CORNER);
  context.fillStyle = logo.background;
  context.fill();
  context.clip();
  context.strokeStyle = logo.eye;
  context.lineWidth = 9.5;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const points of [APP_LOGO_EYE_POINTS.left, APP_LOGO_EYE_POINTS.right]) {
    const values = points.split(/\s+/u).map(Number);
    context.beginPath();
    for (let index = 0; index + 1 < values.length; index += 2) {
      context.lineTo(values[index] ?? 0, values[index + 1] ?? 0);
    }
    context.stroke();
  }
  context.restore();
}

function drawRivalMark(
  context: CanvasRenderingContext2D,
  mark: RivalMarkName,
  x: number,
  y: number,
  size: number,
): void {
  const shape = RIVAL_MARK_SHAPES[mark];
  const [minX, minY, boxWidth, boxHeight] = shape.viewBox;
  context.save();
  context.translate(x, y);
  context.scale(size / boxWidth, size / boxHeight);
  context.translate(-minX, -minY);
  context.fillStyle = "#ffffff";
  context.fill(new Path2D(shape.path), shape.fillRule ?? "evenodd");
  context.restore();
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

/**
 * Greedy wrap. The last allowed line absorbs the rest of the words and is cut
 * with an ellipsis, so an unexpectedly long title degrades instead of running
 * off the bottom of the image.
 */
function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    } else {
      line = candidate;
    }
  }

  const consumed = lines.join(" ");
  const remainder = consumed ? text.slice(consumed.length).trim() : text;
  lines.push(ellipsize(context, remainder, maxWidth));
  return lines;
}

function ellipsize(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}
