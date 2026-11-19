import { BloubBot } from "@norbert_bodziony/bloub";
import { APP_LOGO_CORNER, APP_LOGO_EYE_POINTS, APP_LOGO_SIZE } from "@openbot/brand/app-logo-shape";
import { bloubAvatarProfile } from "@openbot/brand/bloub-avatar";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { render } from "@solidjs/web";
import { flush } from "solid-js";

export interface MarketplaceCardJob {
  kind: "agent" | "skill";
  name: string;
  role: string;
  creatorName: string;
  verified: boolean;
  avatarSeed: string | null;
  avatarHue: AvatarHue | null;
  image: string | null;
}

declare global {
  interface Window {
    openBotMarketplaceCard?: { render: (job: MarketplaceCardJob) => Promise<string> };
  }
}

const WIDTH = 1200;
const HEIGHT = 630;
const FONT_FAMILY = '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const CANVAS = "#1a1a1a";
const PRIMARY = "#ffffff";
const SECONDARY = "#dcdcdc";
const LOGO_BACKGROUND = "#d6adf2";
const LOGO_EYE = "#040007";

const AVATAR = { x: 24, y: (HEIGHT - 540) / 2, size: 540 };
const BRAND = { x: 590, y: 96, logo: 48, gap: 14, font: 32 };
const COPY = { x: 590, width: 560, gap: 14 };
const NAME_SIZES = [92, 80, 68];
const NAME_MAX_LINES = 2;
const ROLE = { size: 40, maxLines: 2 };
const SOURCE = { size: 30, marginTop: 10 };

const SHIELD_PATHS = [
  "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
  "m9 12 2 2 4-4",
];
const BLOCKS_PATHS = [
  "M10 22V7a1 1 0 0 0-1-1H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 0 0-1-1H2",
  "M15 2h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z",
];

window.openBotMarketplaceCard = { render: renderMarketplaceCard };

async function renderMarketplaceCard(job: MarketplaceCardJob): Promise<string> {
  await Promise.all([
    document.fonts.load(`700 92px ${FONT_FAMILY}`),
    document.fonts.load(`600 32px ${FONT_FAMILY}`),
    document.fonts.load(`500 40px ${FONT_FAMILY}`),
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A 2D canvas context is not available.");

  context.fillStyle = CANVAS;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  await drawMedia(context, job);
  drawBrand(context);
  drawCopy(context, job);
  return canvas.toDataURL("image/png");
}

async function drawMedia(context: CanvasRenderingContext2D, job: MarketplaceCardJob): Promise<void> {
  const centerX = AVATAR.x + AVATAR.size / 2;
  const centerY = AVATAR.y + AVATAR.size / 2;
  if (job.image) {
    const image = await loadImage(job.image);
    if (job.kind === "agent") {
      drawCover(context, image, centerX, centerY, 400, (size) => {
        context.arc(centerX, centerY, size / 2, 0, Math.PI * 2);
      });
    } else {
      drawCover(context, image, centerX, centerY, 360, (size) => {
        context.roundRect(centerX - size / 2, centerY - size / 2, size, size, size * 0.22);
      });
    }
    return;
  }
  if (job.kind === "skill" || job.avatarSeed === null) {
    drawLucide(context, BLOCKS_PATHS, centerX - 76, centerY - 76, 152, PRIMARY);
    return;
  }
  const svg = staticAvatarSvg(job.avatarSeed, job.avatarHue);
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(AVATAR.size));
  svg.setAttribute("height", String(AVATAR.size));
  const source = new XMLSerializer().serializeToString(svg);
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`);
  context.drawImage(image, AVATAR.x, AVATAR.y, AVATAR.size, AVATAR.size);
}

function staticAvatarSvg(seed: string, hue: AvatarHue | null): SVGSVGElement {
  const profile = bloubAvatarProfile(seed, hue);
  const host = document.createElement("span");
  const dispose = render(
    () =>
      BloubBot({
        size: 100,
        shape: profile.shape,
        color: profile.color,
        expression: profile.expression,
        frozenAt: 0,
        ariaLabel: "",
      }),
    host,
  );
  flush();
  const svg = host.querySelector("svg")?.cloneNode(true);
  dispose();
  if (!(svg instanceof SVGSVGElement)) throw new Error("Bloub did not render an SVG avatar.");
  return svg;
}

function drawCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  centerX: number,
  centerY: number,
  size: number,
  clip: (size: number) => void,
): void {
  const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.save();
  context.beginPath();
  clip(size);
  context.clip();
  context.drawImage(image, centerX - width / 2, centerY - height / 2, width, height);
  context.restore();
}

function drawBrand(context: CanvasRenderingContext2D): void {
  drawLogo(context, BRAND.x, BRAND.y, BRAND.logo);
  setFont(context, 600, BRAND.font, -0.02);
  context.fillStyle = PRIMARY;
  const metrics = context.measureText("OpenBot");
  const textHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
  const baseline = BRAND.y + (BRAND.logo - textHeight) / 2 + metrics.fontBoundingBoxAscent;
  context.fillText("OpenBot", BRAND.x + BRAND.logo + BRAND.gap, baseline);
}

function drawLogo(context: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  context.save();
  context.translate(x, y);
  context.scale(size / APP_LOGO_SIZE, size / APP_LOGO_SIZE);
  context.beginPath();
  context.roundRect(0, 0, APP_LOGO_SIZE, APP_LOGO_SIZE, APP_LOGO_CORNER);
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

interface TextBlock {
  lines: string[];
  size: number;
  weight: number;
  tracking: number;
  lineHeight: number;
  color: string;
}

function drawCopy(context: CanvasRenderingContext2D, job: MarketplaceCardJob): void {
  const shieldSpace = (size: number) => (job.verified ? size * (0.16 + 0.62) : 0);

  let name: TextBlock | null = null;
  for (const size of NAME_SIZES) {
    setFont(context, 700, size, -0.035);
    const lines = balancedLines(context, job.name, COPY.width, shieldSpace(size));
    name = { lines, size, weight: 700, tracking: -0.035, lineHeight: size, color: PRIMARY };
    if (lines.length <= NAME_MAX_LINES) break;
  }
  if (!name) return;
  if (name.lines.length > NAME_MAX_LINES) {
    setFont(context, 700, name.size, -0.035);
    name.lines = clampLines(context, name.lines, NAME_MAX_LINES, COPY.width - shieldSpace(name.size));
  }

  setFont(context, 500, ROLE.size, -0.02);
  const role: TextBlock = {
    lines: clampLines(context, wrapLines(context, oneLine(job.role), COPY.width), ROLE.maxLines, COPY.width),
    size: ROLE.size,
    weight: 500,
    tracking: -0.02,
    lineHeight: normalLineHeight(context),
    color: SECONDARY,
  };

  setFont(context, 500, SOURCE.size, 0);
  const source: TextBlock = {
    lines: clampLines(context, [`by ${oneLine(job.creatorName)}`], 1, COPY.width),
    size: SOURCE.size,
    weight: 500,
    tracking: 0,
    lineHeight: normalLineHeight(context),
    color: SECONDARY,
  };

  const blocks = [name, ...(role.lines.length > 0 ? [role] : []), source];
  const height =
    blocks.reduce((sum, block) => sum + block.lines.length * block.lineHeight, 0) +
    COPY.gap * (blocks.length - 1) +
    SOURCE.marginTop;
  let top = HEIGHT / 2 - height * 0.38;
  for (const block of blocks) {
    if (block === source) top += SOURCE.marginTop;
    setFont(context, block.weight, block.size, block.tracking);
    context.fillStyle = block.color;
    for (const [index, line] of block.lines.entries()) {
      const baseline = baselineIn(context, top, block.lineHeight);
      context.fillText(line, COPY.x, baseline);
      if (block === name && job.verified && index === block.lines.length - 1) {
        drawShield(context, COPY.x + context.measureText(line).width, baseline, block.size);
      }
      top += block.lineHeight;
    }
    top += COPY.gap;
  }
}

function drawShield(context: CanvasRenderingContext2D, x: number, baseline: number, size: number): void {
  const side = size * 0.62;
  drawLucide(context, SHIELD_PATHS, x + size * 0.16, baseline + size * 0.04 - side, side, SECONDARY);
}

function drawLucide(
  context: CanvasRenderingContext2D,
  paths: readonly string[],
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  context.save();
  context.translate(x, y);
  context.scale(size / 24, size / 24);
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const path of paths) context.stroke(new Path2D(path));
  context.restore();
}

function setFont(context: CanvasRenderingContext2D, weight: number, size: number, trackingEm: number): void {
  context.font = `${weight} ${size}px ${FONT_FAMILY}`;
  context.letterSpacing = `${trackingEm * size}px`;
  context.textBaseline = "alphabetic";
}

function normalLineHeight(context: CanvasRenderingContext2D): number {
  const metrics = context.measureText("Hg");
  return metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
}

function baselineIn(context: CanvasRenderingContext2D, top: number, lineHeight: number): number {
  const metrics = context.measureText("Hg");
  const content = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
  return top + (lineHeight - content) / 2 + metrics.fontBoundingBoxAscent;
}

function oneLine(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function wrapLines(context: CanvasRenderingContext2D, text: string, width: number, lastLineReserve = 0): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of oneLine(text).split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (!line || context.measureText(next).width <= width) {
      line = next;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  const last = lines.at(-1);
  if (last !== undefined && lastLineReserve > 0 && context.measureText(last).width + lastLineReserve > width) {
    const space = last.lastIndexOf(" ");
    if (space > 0) lines.splice(-1, 1, last.slice(0, space), last.slice(space + 1));
  }
  return lines;
}

function balancedLines(context: CanvasRenderingContext2D, text: string, width: number, reserve: number): string[] {
  const lines = wrapLines(context, text, width, reserve);
  if (lines.length !== 2) return lines;
  const words = oneLine(text).split(" ");
  let best = lines;
  let bestWidth = Number.POSITIVE_INFINITY;
  for (let split = 1; split < words.length; split += 1) {
    const first = words.slice(0, split).join(" ");
    const second = words.slice(split).join(" ");
    const firstWidth = context.measureText(first).width;
    const secondWidth = context.measureText(second).width + reserve;
    if (firstWidth > width || secondWidth > width) continue;
    const longer = Math.max(firstWidth, secondWidth);
    if (longer < bestWidth) {
      best = [first, second];
      bestWidth = longer;
    }
  }
  return best;
}

function clampLines(context: CanvasRenderingContext2D, lines: string[], max: number, width: number): string[] {
  if (lines.length <= max && lines.every((line) => context.measureText(line).width <= width)) return lines;
  const kept = lines.slice(0, max);
  const rest = lines.slice(max - 1).join(" ");
  kept[kept.length - 1] = ellipsize(context, rest, width);
  return kept.map((line) => (context.measureText(line).width > width ? ellipsize(context, line, width) : line));
}

function ellipsize(context: CanvasRenderingContext2D, text: string, width: number): string {
  let value = text;
  while (value && context.measureText(`${value}…`).width > width) {
    const space = value.lastIndexOf(" ");
    value = space > 0 ? value.slice(0, space) : value.slice(0, -1);
  }
  return `${value.replace(/[\s,.;:]+$/u, "")}…`;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}
