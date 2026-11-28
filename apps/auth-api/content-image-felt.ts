import { APP_LOGO_CORNER, APP_LOGO_SIZE } from "@openbot/brand/app-logo-shape";
import { appLogoEyes, drawMark, FONT_FAMILY, LOGO_BACKGROUND, roundedRect } from "./content-image-marks";
import type { ContentImageJob, ContentImageMark } from "./content-images";

const FELT_MAX_LUMA = 0.5;
const FELT_DETAIL_STRENGTH = 0.8;
const PATCH_RADIUS = 36;
const STITCH_PITCH = 15;
const STITCH_LENGTH = 9;
const STITCH_THREAD = "#2c2b30";
const EYE_THREAD = "#1d1321";
const EYE_THREAD_CORE = "#4b3b52";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

interface EdgePoint {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

interface Fibres {
  spacing: number;
  spread: number;
  bias: number;
  turn: number;
  length: [number, number];
  width: [number, number];
  colour: (random: () => number) => string;
}

export async function drawFeltBackground(
  context: CanvasRenderingContext2D,
  job: ContentImageJob,
  url: string,
): Promise<void> {
  const image = new Image();
  image.src = url;
  await image.decode();
  context.drawImage(image, 0, 0, job.width, job.height);
  const luma = averageLuma(context, job.width * 0.25, job.height * 0.3, job.width * 0.5, job.height * 0.4);
  if (luma > FELT_MAX_LUMA) {
    context.filter = `brightness(${(FELT_MAX_LUMA / luma).toFixed(3)}) saturate(1.3)`;
    context.drawImage(image, 0, 0, job.width, job.height);
    context.filter = "none";
  }
  drawFeltDetail(context, job, image);
}

export function drawFeltLockup(
  context: CanvasRenderingContext2D,
  job: ContentImageJob,
  left: ContentImageMark,
  right: ContentImageMark,
): void {
  const unit = job.width / 1200;
  const width = 600 * unit;
  const height = 240 * unit;
  const logoSize = 96 * unit;
  const patch = centredPatch(job, width, height);
  const felt = copyCanvas(context);
  drawFeltPatch(context, job, felt, patch);

  const logoTop = patch.y + (height - logoSize) / 2;
  drawFeltMark(context, job, felt, left, patch.x + width * 0.25 - logoSize / 2, logoTop, logoSize);
  drawFeltMark(context, job, felt, right, patch.x + width * 0.75 - logoSize / 2, logoTop, logoSize);

  const centre = patch.x + width / 2;
  const middle = patch.y + height / 2;
  const vsSize = 20 * unit;
  const gap = vsSize * 1.3;
  const inset = 56 * unit;
  drawStitchColumn(context, centre, patch.y + inset, middle - gap, unit);
  drawStitchColumn(context, centre, middle + gap, patch.y + height - inset, unit);
  context.save();
  context.font = `500 ${vsSize}px ${FONT_FAMILY}`;
  context.fillStyle = "rgba(255, 255, 255, 0.9)";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("vs", centre, middle);
  context.restore();
}

export function drawFeltMarkRow(
  context: CanvasRenderingContext2D,
  job: ContentImageJob,
  marks: readonly ContentImageMark[],
): void {
  const unit = job.width / 1200;
  const size = 48 * unit;
  const gap = 28 * unit;
  const padX = 48 * unit;
  const padY = 54 * unit;
  const patch = centredPatch(job, padX * 2 + size * marks.length + gap * (marks.length - 1), padY * 2 + size);
  const felt = copyCanvas(context);
  drawFeltPatch(context, job, felt, patch);
  marks.forEach((mark, index) => {
    drawFeltMark(context, job, felt, mark, patch.x + padX + index * (size + gap), patch.y + padY, size);
  });
}

function drawFeltMark(
  context: CanvasRenderingContext2D,
  job: ContentImageJob,
  felt: HTMLCanvasElement,
  mark: ContentImageMark,
  x: number,
  y: number,
  size: number,
): void {
  if (mark === "openbot") drawFeltOpenBotMark(context, job, felt, x, y, size);
  else drawMark(context, mark, x, y, size);
}

function centredPatch(job: ContentImageJob, width: number, height: number): Rect {
  const radius = PATCH_RADIUS * (job.width / 1200);
  return { x: (job.width - width) / 2, y: (job.height - height) / 2, width, height, radius };
}

function drawFeltDetail(context: CanvasRenderingContext2D, job: ContentImageJob, image: HTMLImageElement): void {
  const unit = job.width / 1200;
  const pad = 24 * unit;
  const detail = newCanvas(job.width, job.height);
  const detailContext = canvasContext(detail);
  detailContext.filter = "grayscale(1)";
  detailContext.drawImage(image, 0, 0, job.width, job.height);
  detailContext.globalAlpha = 0.5;
  detailContext.filter = `grayscale(1) invert(1) blur(${6 * unit}px)`;
  detailContext.drawImage(edgePadded(image, job, pad), -pad, -pad);

  context.save();
  context.globalCompositeOperation = "overlay";
  context.globalAlpha = FELT_DETAIL_STRENGTH;
  context.filter = "contrast(3)";
  context.drawImage(detail, 0, 0);
  context.restore();
}

function edgePadded(image: HTMLImageElement, job: ContentImageJob, pad: number): HTMLCanvasElement {
  const { width, height } = job;
  const canvas = newCanvas(width + pad * 2, height + pad * 2);
  const context = canvasContext(canvas);
  const sx = image.naturalWidth / width;
  const sy = image.naturalHeight / height;
  context.drawImage(image, 0, 0, image.naturalWidth, sy, pad, 0, width, pad);
  context.drawImage(image, 0, image.naturalHeight - sy, image.naturalWidth, sy, pad, height + pad, width, pad);
  context.drawImage(image, 0, 0, sx, image.naturalHeight, 0, pad, pad, height);
  context.drawImage(image, image.naturalWidth - sx, 0, sx, image.naturalHeight, width + pad, pad, pad, height);
  context.drawImage(image, pad, pad, width, height);
  return canvas;
}

function drawFeltPatch(
  context: CanvasRenderingContext2D,
  job: ContentImageJob,
  felt: HTMLCanvasElement,
  patch: Rect,
): void {
  const unit = job.width / 1200;
  const { x, y, width, height, radius } = patch;
  const random = seededRandom(job.slug);
  for (const shadow of [
    { colour: "rgba(0, 0, 0, 0.3)", blur: 24, offset: 7 },
    { colour: "rgba(0, 0, 0, 0.55)", blur: 3, offset: 1.5 },
  ]) {
    context.save();
    context.shadowColor = shadow.colour;
    context.shadowBlur = shadow.blur * unit;
    context.shadowOffsetY = shadow.offset * unit;
    roundedRect(context, x, y, width, height, radius);
    context.fillStyle = "#000000";
    context.fill();
    context.restore();
  }

  context.save();
  roundedRect(context, x, y, width, height, radius);
  context.clip();
  context.save();
  context.translate(job.width / 2, job.height / 2);
  context.rotate(Math.PI);
  context.filter = "grayscale(1) contrast(1.8) brightness(0.26)";
  context.drawImage(felt, -job.width / 2, -job.height / 2);
  context.restore();
  const light = context.createLinearGradient(0, y, 0, y + height);
  light.addColorStop(0, "rgba(255, 255, 255, 0.07)");
  light.addColorStop(0.5, "rgba(255, 255, 255, 0)");
  light.addColorStop(1, "rgba(0, 0, 0, 0.12)");
  context.fillStyle = light;
  context.fillRect(x, y, width, height);
  drawInnerShadow(context, patch, "rgba(0, 0, 0, 0.7)", 14 * unit, 60 * unit);
  context.restore();

  drawEdgeFibres(context, patch, random, unit, {
    spacing: 0.9,
    spread: 3,
    bias: 0.5,
    turn: 2.2,
    length: [1.5, 4.5],
    width: [0.5, 0.7],
    colour: (next) => (next() < 0.75 ? `rgba(14, 14, 16, ${0.55 + next() * 0.4})` : "rgba(90, 90, 96, 0.35)"),
  });
  drawRunningStitch(context, patch, random, unit);
}

function drawInnerShadow(
  context: CanvasRenderingContext2D,
  rect: Rect,
  colour: string,
  blur: number,
  margin: number,
): void {
  context.beginPath();
  context.rect(rect.x - margin, rect.y - margin, rect.width + margin * 2, rect.height + margin * 2);
  context.roundRect(rect.x, rect.y, rect.width, rect.height, rect.radius);
  context.shadowColor = colour;
  context.shadowBlur = blur;
  context.fillStyle = "#000000";
  context.fill("evenodd");
}

function drawEdgeFibres(
  context: CanvasRenderingContext2D,
  rect: Rect,
  random: () => number,
  unit: number,
  fibres: Fibres,
): void {
  const perimeter = roundedRectPerimeter(rect);
  const count = Math.round(perimeter / (fibres.spacing * unit));
  context.save();
  context.lineCap = "round";
  for (let index = 0; index < count; index += 1) {
    const point = roundedRectPoint(rect, random() * perimeter);
    const along = (random() - fibres.bias) * fibres.spread * unit;
    const angle = Math.atan2(point.ny, point.nx) + (random() - 0.5) * fibres.turn;
    const length = (fibres.length[0] + random() * fibres.length[1]) * unit;
    const startX = point.x + point.nx * along;
    const startY = point.y + point.ny * along;
    context.strokeStyle = fibres.colour(random);
    context.lineWidth = (fibres.width[0] + random() * fibres.width[1]) * unit;
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(startX + Math.cos(angle) * length, startY + Math.sin(angle) * length);
    context.stroke();
  }
  context.restore();
}

function drawRunningStitch(context: CanvasRenderingContext2D, patch: Rect, random: () => number, unit: number): void {
  const inset = 13 * unit;
  const seam = {
    x: patch.x + inset,
    y: patch.y + inset,
    width: patch.width - inset * 2,
    height: patch.height - inset * 2,
    radius: patch.radius - inset,
  };
  const perimeter = roundedRectPerimeter(seam);
  const count = Math.round(perimeter / (STITCH_PITCH * unit));
  for (let index = 0; index < count; index += 1) {
    const from = (index / count) * perimeter;
    const to = from + STITCH_LENGTH * unit + (random() - 0.5) * unit;
    drawStitch(context, roundedRectPoint(seam, from), roundedRectPoint(seam, to), unit);
  }
}

function drawStitchColumn(
  context: CanvasRenderingContext2D,
  x: number,
  top: number,
  bottom: number,
  unit: number,
): void {
  const pitch = STITCH_PITCH * unit;
  const length = STITCH_LENGTH * unit;
  const count = Math.max(1, Math.floor((bottom - top + pitch - length) / pitch));
  const start = top + (bottom - top - (count - 1) * pitch - length) / 2;
  for (let index = 0; index < count; index += 1) {
    const from = start + index * pitch;
    drawStitch(context, { x, y: from }, { x, y: from + length }, unit);
  }
}

function drawStitch(
  context: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
  unit: number,
): void {
  context.save();
  context.lineCap = "round";
  context.fillStyle = "rgba(0, 0, 0, 0.85)";
  for (const hole of [start, end]) {
    context.beginPath();
    context.arc(hole.x, hole.y + 0.4 * unit, 1.6 * unit, 0, Math.PI * 2);
    context.fill();
  }
  strokeLine(context, start, end, STITCH_THREAD, 2.6 * unit);
  strokeLine(
    context,
    { x: start.x, y: start.y - 0.6 * unit },
    { x: end.x, y: end.y - 0.6 * unit },
    "rgba(255, 255, 255, 0.16)",
    0.9 * unit,
  );
  context.restore();
}

function drawFeltOpenBotMark(
  context: CanvasRenderingContext2D,
  job: ContentImageJob,
  felt: HTMLCanvasElement,
  x: number,
  y: number,
  size: number,
): void {
  const unit = job.width / 1200;
  const scale = size / APP_LOGO_SIZE;
  const logo = { x, y, width: size, height: size, radius: APP_LOGO_CORNER * scale };
  const random = seededRandom(`${job.slug}:logo:${Math.round(x)}`);

  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.6)";
  context.shadowBlur = 4 * unit;
  context.shadowOffsetY = 2 * unit;
  roundedRect(context, x, y, size, size, logo.radius);
  context.fillStyle = LOGO_BACKGROUND;
  context.fill();
  context.restore();

  context.save();
  roundedRect(context, x, y, size, size, logo.radius);
  context.clip();
  context.globalCompositeOperation = "overlay";
  context.globalAlpha = 0.55;
  context.filter = "grayscale(1) contrast(1.7)";
  context.drawImage(felt, x - size * 1.3, y - size * 0.4, size * 2.6, size * 1.4, x, y, size * 2.6, size * 1.4);
  context.filter = "none";
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  drawInnerShadow(context, logo, "rgba(40, 10, 60, 0.45)", 19.2 * scale, size);
  context.restore();

  drawEdgeFibres(context, logo, random, unit, {
    spacing: 1.8,
    spread: 2.5,
    bias: 0.6,
    turn: 2.4,
    length: [0.8, 1.8],
    width: [0.4, 0.6],
    colour: (next) => (next() < 0.6 ? "rgba(214, 173, 242, 0.6)" : "rgba(150, 105, 182, 0.55)"),
  });

  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  for (const values of appLogoEyes()) {
    for (let index = 0; index + 3 < values.length; index += 4) {
      drawEyeStrand(
        context,
        { x: values[index] ?? 0, y: values[index + 1] ?? 0 },
        { x: values[index + 2] ?? 0, y: values[index + 3] ?? 0 },
      );
    }
  }
  context.restore();
}

function drawEyeStrand(
  context: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
): void {
  const width = 8.5;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length === 0) return;
  const ux = (end.x - start.x) / length;
  const uy = (end.y - start.y) / length;
  const from = { x: start.x - ux * 2, y: start.y - uy * 2 };
  const to = { x: end.x + ux * 2, y: end.y + uy * 2 };

  context.save();
  context.lineCap = "round";
  context.shadowColor = "rgba(0, 0, 0, 0.8)";
  context.shadowBlur = 4;
  context.shadowOffsetY = 3;
  strokeLine(context, from, to, EYE_THREAD, width);
  context.restore();

  context.save();
  context.lineCap = "round";
  strokeLine(
    context,
    { x: from.x - uy * 1.2, y: from.y + ux * 1.2 },
    { x: to.x - uy * 1.2, y: to.y + ux * 1.2 },
    EYE_THREAD_CORE,
    width * 0.38,
  );
  const slantX = (-uy - ux * 0.7) * width * 0.42;
  const slantY = (ux - uy * 0.7) * width * 0.42;
  for (let along = 3; along < length + 1; along += 4.2) {
    const cx = from.x + ux * along;
    const cy = from.y + uy * along;
    const a = { x: cx + slantX, y: cy + slantY };
    const b = { x: cx - slantX, y: cy - slantY };
    strokeLine(context, a, b, "rgba(255, 235, 255, 0.22)", 1.4);
    strokeLine(
      context,
      { x: a.x + ux * 1.6, y: a.y + uy * 1.6 },
      { x: b.x + ux * 1.6, y: b.y + uy * 1.6 },
      "rgba(0, 0, 0, 0.55)",
      0.9,
    );
  }
  context.restore();
}

function strokeLine(
  context: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
  colour: string,
  width: number,
): void {
  context.strokeStyle = colour;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
}

function roundedRectPerimeter(rect: Rect): number {
  return 2 * (rect.width - 2 * rect.radius) + 2 * (rect.height - 2 * rect.radius) + 2 * Math.PI * rect.radius;
}

function roundedRectPoint(rect: Rect, distance: number): EdgePoint {
  const { x, y, width, height, radius } = rect;
  const perimeter = roundedRectPerimeter(rect);
  const arc = (Math.PI * radius) / 2;
  const sides = [
    { length: width - 2 * radius, at: (t: number) => ({ x: x + radius + t, y, nx: 0, ny: -1 }) },
    { length: height - 2 * radius, at: (t: number) => ({ x: x + width, y: y + radius + t, nx: 1, ny: 0 }) },
    { length: width - 2 * radius, at: (t: number) => ({ x: x + width - radius - t, y: y + height, nx: 0, ny: 1 }) },
    { length: height - 2 * radius, at: (t: number) => ({ x, y: y + height - radius - t, nx: -1, ny: 0 }) },
  ];
  const corners = [
    { cx: x + width - radius, cy: y + radius, from: -Math.PI / 2 },
    { cx: x + width - radius, cy: y + height - radius, from: 0 },
    { cx: x + radius, cy: y + height - radius, from: Math.PI / 2 },
    { cx: x + radius, cy: y + radius, from: Math.PI },
  ];
  let rest = ((distance % perimeter) + perimeter) % perimeter;
  for (const [index, side] of sides.entries()) {
    if (rest <= side.length) return side.at(rest);
    rest -= side.length;
    const corner = corners[index];
    if (corner && rest <= arc) {
      const angle = corner.from + rest / radius;
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);
      return { x: corner.cx + nx * radius, y: corner.cy + ny * radius, nx, ny };
    }
    rest -= arc;
  }
  return { x: x + radius, y, nx: 0, ny: -1 };
}

function seededRandom(text: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    state = Math.imul(state ^ text.charCodeAt(index), 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

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

function copyCanvas(context: CanvasRenderingContext2D): HTMLCanvasElement {
  const copy = newCanvas(context.canvas.width, context.canvas.height);
  canvasContext(copy).drawImage(context.canvas, 0, 0);
  return copy;
}

function newCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Content images: a 2D canvas context is not available.");
  return context;
}
