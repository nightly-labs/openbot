import { AppLogo } from "@openbot/brand";
import { AGENT_TEMPLATE_CARD, type AgentTemplatePreview } from "@openbot/contracts/ipc";
import { avatarHeadColor, createStaticAvatarSvg } from "@openbot/ui/bloub-avatar";
import { render } from "@solidjs/web";
import { flush } from "solid-js";

/*
 * The share card: the image X and other sites show for an `openbot.run/agents/<id>` link.
 *
 * It is drawn here, at publish time, because this is where the agent's avatar is: a generated Bloub
 * or the photo the owner uploaded. The Worker only checks its size and stores it.
 *
 * Layout, on the app's dark canvas: a hero square on the left in the avatar's own colour with the
 * avatar in it, and on the right the OpenBot mark, the name, the role, the instructions, and the
 * "Add to OpenBot" pill the page carries.
 */

const { width: WIDTH, height: HEIGHT } = AGENT_TEMPLATE_CARD;
const HERO = { x: 40, y: 40, size: 550, radius: 40 };
const AVATAR_SIZE = 300;
const COLUMN = { x: 650, width: 490 };
const FONT = '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export async function renderAgentTemplateCard(preview: AgentTemplatePreview): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The share card cannot be drawn.");
  await Promise.all([document.fonts.load(`700 64px ${FONT}`), document.fonts.load(`500 26px ${FONT}`)]);

  const colors = themeColors();
  context.fillStyle = colors.canvas;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  drawHero(context, avatarHeadColor(preview.avatarSeed, preview.avatarHue), colors.canvas);
  await drawAvatar(context, preview);
  await drawColumn(context, preview, colors);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The share card cannot be encoded.");
  return new Uint8Array(await blob.arrayBuffer());
}

interface ThemeColors {
  canvas: string;
  primary: string;
  secondary: string;
  muted: string;
  logo: string;
  logoEye: string;
}

/** The app's tokens, read from the document so the card follows the brand if it changes. */
function themeColors(): ThemeColors {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => {
    const value = style.getPropertyValue(name).trim();
    if (!value) throw new Error(`The share card needs the ${name} token.`);
    return value;
  };
  return {
    canvas: token("--openbot-bg-native-canvas"),
    primary: token("--openbot-text-primary"),
    secondary: token("--openbot-text-secondary"),
    muted: token("--openbot-text-muted"),
    logo: token("--openbot-logo-production"),
    logoEye: token("--openbot-logo-eye"),
  };
}

/** The avatar's colour as soft light on the dark canvas, like the hero of the web page. */
function drawHero(context: CanvasRenderingContext2D, color: string, canvas: string): void {
  const { x, y, size, radius } = HERO;
  context.save();
  context.beginPath();
  context.roundRect(x, y, size, size, radius);
  context.clip();
  context.fillStyle = canvas;
  context.fillRect(x, y, size, size);
  const glow = (cx: number, cy: number, r: number, alpha: number) => {
    const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, r);
    gradient.addColorStop(0, withAlpha(color, alpha));
    gradient.addColorStop(1, withAlpha(color, 0));
    context.fillStyle = gradient;
    context.fillRect(x, y, size, size);
  };
  glow(x + size * 0.3, y + size * 0.85, size * 0.8, 0.55);
  glow(x + size * 0.9, y + size * 0.2, size * 0.6, 0.35);
  glow(x + size / 2, y + size / 2, size * 0.45, 0.4);
  context.restore();
}

async function drawAvatar(context: CanvasRenderingContext2D, preview: AgentTemplatePreview): Promise<void> {
  const cx = HERO.x + HERO.size / 2;
  const cy = HERO.y + HERO.size / 2;
  if (preview.avatarImage) {
    const { bytes, mimeType } = preview.avatarImage;
    const image = await loadImage(new Blob([new Uint8Array(bytes)], { type: mimeType }));
    const radius = AVATAR_SIZE / 2;
    const scale = Math.max(AVATAR_SIZE / image.naturalWidth, AVATAR_SIZE / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    context.save();
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.clip();
    context.drawImage(image, cx - drawWidth / 2, cy - drawHeight / 2, drawWidth, drawHeight);
    context.restore();
    return;
  }
  // The Bloub is drawn larger than its box, the way `.agent-avatar > svg` draws it in the app.
  const size = AVATAR_SIZE * 1.28;
  const svg = createStaticAvatarSvg(preview.avatarSeed, preview.avatarHue);
  const image = await loadSvg(svg, size);
  context.drawImage(image, cx - size / 2, cy - size / 2 - AVATAR_SIZE * 0.08, size, size);
}

async function drawColumn(
  context: CanvasRenderingContext2D,
  preview: AgentTemplatePreview,
  colors: ThemeColors,
): Promise<void> {
  const { x, width } = COLUMN;
  context.textBaseline = "alphabetic";

  // The brand row: the mark and the wordmark.
  await drawLogo(context, x, 92, 44, colors);
  context.fillStyle = colors.primary;
  context.font = `600 28px ${FONT}`;
  context.fillText("OpenBot", x + 58, 124);

  // `y` is always the baseline of the last line drawn.
  let y = 154;
  context.font = `700 60px ${FONT}`;
  context.fillStyle = colors.primary;
  for (const line of wrapLines(context, preview.name, width, 2)) {
    y += 68;
    context.fillText(line, x, y);
  }
  if (preview.title) {
    y += 58;
    context.font = `500 28px ${FONT}`;
    context.fillStyle = colors.muted;
    context.fillText(wrapLines(context, preview.title, width, 1)[0] ?? "", x, y);
  }

  // The instructions fill what is left above the pill, in whole lines.
  const pillTop = 510;
  const lineHeight = 36;
  y += 60;
  const lines = Math.max(0, Math.min(4, Math.floor((pillTop - 28 - y) / lineHeight) + 1));
  context.font = `400 25px ${FONT}`;
  context.fillStyle = colors.secondary;
  for (const line of wrapLines(context, preview.description.replace(/\s+/gu, " "), width, lines)) {
    context.fillText(line, x, y);
    y += lineHeight;
  }

  const label = "Add to OpenBot";
  context.font = `600 24px ${FONT}`;
  const pillWidth = context.measureText(label).width + 64;
  context.fillStyle = colors.primary;
  context.beginPath();
  context.roundRect(x, pillTop, pillWidth, 60, 30);
  context.fill();
  context.fillStyle = colors.canvas;
  context.fillText(label, x + 32, pillTop + 38);
  context.font = `500 24px ${FONT}`;
  context.fillStyle = colors.muted;
  context.fillText("openbot.run", x + pillWidth + 24, pillTop + 38);
}

/** The app mark from `@openbot/brand`, with its CSS colours written onto the shapes. */
async function drawLogo(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colors: ThemeColors,
): Promise<void> {
  const host = document.createElement("span");
  const dispose = render(() => <AppLogo variant="production" />, host);
  flush();
  const svg = host.querySelector("svg")?.cloneNode(true);
  dispose();
  if (!(svg instanceof SVGSVGElement)) return;
  svg.querySelector(".app-logo-background")?.setAttribute("fill", colors.logo);
  for (const eye of svg.querySelectorAll(".app-logo-eye")) {
    eye.setAttribute("fill", "none");
    eye.setAttribute("stroke", colors.logoEye);
    eye.setAttribute("stroke-width", "9.5");
    eye.setAttribute("stroke-linecap", "round");
    eye.setAttribute("stroke-linejoin", "round");
  }
  context.drawImage(await loadSvg(svg, size), x, y, size, size);
}

/** Lines that fit `width`, at most `max`; the last one ends in an ellipsis when text is left over. */
function wrapLines(context: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  const words = text.trim().split(" ");
  for (const [index, word] of words.entries()) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === max) {
      lines[max - 1] = ellipsize(context, `${lines[max - 1]} ${words.slice(index).join(" ")}`, width);
      return lines;
    }
  }
  if (line && lines.length < max) lines.push(line);
  return lines.map((item) => (context.measureText(item).width > width ? ellipsize(context, item, width) : item));
}

/** Cuts at a word where it can, so the line does not end in half a word. */
function ellipsize(context: CanvasRenderingContext2D, text: string, width: number): string {
  let value = text;
  while (value && context.measureText(`${value}…`).width > width) {
    const space = value.lastIndexOf(" ");
    value = space > 0 ? value.slice(0, space) : value.slice(0, -1);
  }
  return `${value.replace(/[\s,.;:]+$/u, "")}…`;
}

function loadSvg(svg: SVGSVGElement, size: number): Promise<HTMLImageElement> {
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  return loadImage(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
}

/**
 * A `data:` URL, not a `blob:` one: the app's Content Security Policy allows `data:` images and
 * refuses `blob:`, so a blob URL fails to decode in the app although it works in Storybook.
 */
async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(reader.error));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
