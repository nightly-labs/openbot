// Runs inside a throwaway Electron page during `vite build`. Bundled to a single
// classic script by content-images.ts and injected with `executeJavaScript`, so
// it must not rely on module loading, the network, or anything on the page.
//
// Workers have no WebGL, so the card artwork cannot be produced at request time.
// This is the one place that turns the shared gradient description into pixels.

import { APP_LOGO_CORNER, APP_LOGO_EYE_POINTS, APP_LOGO_SIZE } from "@openbot/brand/app-logo-shape";
import { getShaderColorFromString, meshGradientFragmentShader, ShaderMount } from "@paper-design/shaders";
import type { ContentImageJob, ContentImageLockup, ContentImageMark } from "./content-images";
import { RIVAL_MARK_SHAPES, type RivalMarkName } from "./src/components/compare/rival-mark-shapes";
import { articleGradient, articleGradientUniforms } from "./src/lib/article-gradient";

declare global {
  interface Window {
    openBotContentImage?: { render: (job: ContentImageJob) => Promise<string> };
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
const FONT_FAMILY = '"Inter Variable", Inter, system-ui, sans-serif';

window.openBotContentImage = { render: renderContentImage };

/**
 * Lossy, for the artwork only: a smooth gradient loses nothing a reader can see,
 * and the file is about 3% of the PNG. Bump `GENERATOR_VERSION` when this changes.
 */
const WEBP_QUALITY = 0.9;

async function renderContentImage(job: ContentImageJob): Promise<string> {
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

    const canvas = document.createElement("canvas");
    canvas.width = job.width;
    canvas.height = job.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Paper shaders: a 2D canvas context is not available.");

    // The shader canvas is rendered at twice the output size, so this draw is a
    // supersample rather than a stretch.
    context.drawImage(mount.canvasElement, 0, 0, job.width, job.height);
    if (job.title && job.withTitle) {
      drawScrim(context, job);
      if (job.lockup) drawLockup(context, job, job.lockup);
      else if (job.markRow) drawMarkRow(context, job, job.markRow);
      drawTitle(context, job);
    }

    return job.fileName.endsWith(".webp")
      ? canvas.toDataURL("image/webp", WEBP_QUALITY)
      : canvas.toDataURL("image/png");
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

/** The roundup's lockup: one frosted plate with the mark of every app in a row, at the same place. */
function drawMarkRow(
  context: CanvasRenderingContext2D,
  job: ContentImageJob,
  marks: readonly ContentImageMark[],
): void {
  const unit = job.width / 1200;
  const pad = 32 * unit;
  const gap = 20 * unit;
  const x = Math.round(job.width * 0.06);
  const y = 64 * unit;
  // As large as fits in the width of the title, and no larger than the lockup's marks.
  const available = job.width - x * 2 - pad * 2 - gap * (marks.length - 1);
  const size = Math.min(128 * unit, available / marks.length);
  drawPlate(context, job, x, y, pad * 2 + size * marks.length + gap * (marks.length - 1), pad * 2 + size);
  marks.forEach((mark, index) => {
    drawMark(context, mark, x + pad + index * (size + gap), y + pad, size);
  });
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

function drawMark(context: CanvasRenderingContext2D, mark: ContentImageMark, x: number, y: number, size: number): void {
  if (mark === "openbot") drawOpenBotMark(context, x, y, size);
  else drawRivalMark(context, mark, x, y, size);
}

/** `AppLogo`: the rounded square and the two scribbled eyes. */
function drawOpenBotMark(context: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  context.save();
  context.translate(x, y);
  context.scale(size / APP_LOGO_SIZE, size / APP_LOGO_SIZE);
  roundedRect(context, 0, 0, APP_LOGO_SIZE, APP_LOGO_SIZE, APP_LOGO_CORNER);
  context.fillStyle = LOGO_BACKGROUND;
  context.fill();
  context.clip();
  context.strokeStyle = LOGO_EYE;
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
