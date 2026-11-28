import { getShaderColorFromString, meshGradientFragmentShader, ShaderMount } from "@paper-design/shaders";
import { drawFeltBackground, drawFeltLockup, drawFeltMarkRow } from "./content-image-felt";
import { drawHeadline, drawIllustration } from "./content-image-headline";
import { drawMark, FONT_FAMILY, roundedRect } from "./content-image-marks";
import type { ContentImageJob, ContentImageLockup, ContentImageMark, ContentImageRenderJob } from "./content-images";
import { articleGradient, articleGradientUniforms } from "./src/lib/article-gradient";

declare global {
  interface Window {
    openBotContentImage?: { render: (job: ContentImageRenderJob) => Promise<string> };
  }
}

const SCRIM_COLOR = "26, 26, 26";
const TITLE_MAX_LINES = 3;
const TITLE_MAX_LINES_WITH_LOCKUP = 2;

window.openBotContentImage = { render: renderContentImage };

const WEBP_QUALITY = 0.9;

async function renderContentImage(job: ContentImageRenderJob): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = job.width;
  canvas.height = job.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Paper shaders: a 2D canvas context is not available.");

  await drawBackground(context, job);
  if (job.title && job.withTitle) drawForeground(context, job);

  return job.fileName.endsWith(".webp") ? canvas.toDataURL("image/webp", WEBP_QUALITY) : canvas.toDataURL("image/png");
}

async function drawBackground(context: CanvasRenderingContext2D, job: ContentImageRenderJob): Promise<void> {
  if (!job.backgroundUrl) await drawGradient(context, job);
  else if (job.layout === "headline") await drawIllustration(context, job, job.backgroundUrl);
  else await drawFeltBackground(context, job, job.backgroundUrl);
}

function drawForeground(context: CanvasRenderingContext2D, job: ContentImageJob): void {
  if (job.layout === "centered") drawCentredMarks(context, job);
  else if (job.layout === "headline" && job.headline) drawHeadline(context, job, job.headline);
  else drawTitledCard(context, job);
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
    { preserveDrawingBuffer: true },
    0,
    gradient.frame,
  );
  try {
    await waitForCanvas(mount.canvasElement);
    mount.setFrame(gradient.frame);
    context.drawImage(mount.canvasElement, 0, 0, job.width, job.height);
  } finally {
    mount.dispose();
    host.remove();
  }
}

function drawCentredMarks(context: CanvasRenderingContext2D, job: ContentImageJob): void {
  if (job.lockup) drawFeltLockup(context, job, job.lockup.left?.mark ?? "openbot", job.lockup.rivalMark);
  else if (job.markRow) drawFeltMarkRow(context, job, job.markRow);
}

function drawTitledCard(context: CanvasRenderingContext2D, job: ContentImageJob): void {
  drawScrim(context, job);
  if (job.lockup) drawLockup(context, job, job.lockup);
  else if (job.markRow) drawMarkRow(context, job, job.markRow);
  drawTitle(context, job);
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
  const available = job.width - x * 2 - pad * 2 - gap * (marks.length - 1);
  const size = Math.min(128 * unit, available / marks.length);
  drawPlate(context, job, x, y, pad * 2 + size * marks.length + gap * (marks.length - 1), pad * 2 + size);
  marks.forEach((mark, index) => {
    drawMark(context, mark, x + pad + index * (size + gap), y + pad, size);
  });
}

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
