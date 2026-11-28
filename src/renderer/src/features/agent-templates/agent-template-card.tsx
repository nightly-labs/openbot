import { AppLogo } from "@openbot/brand";
import { AGENT_TEMPLATE_CARD, type AgentTemplatePreview } from "@openbot/contracts/ipc";
import { bloubAvatarProfile } from "@openbot/ui/bloub-avatar";
import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { loadImage, loadSvg } from "../../avatar-canvas";
import { loadFeltCardArt } from "./felt-card-art";

const { width: WIDTH, height: HEIGHT } = AGENT_TEMPLATE_CARD;
const BODY = { x: 0, y: 34, size: 510 };
const PHOTO_SIZE = 300;
const COLUMN = { x: 619, width: 518, centre: 317, bottom: 482 };
const NAME = { size: 75, lineHeight: 91, maxLines: 2, minSize: 52 };
const ROLE = { size: 33, lineHeight: 40, maxLines: 2, gap: 22 };
const SITE = { size: 24, lineHeight: 29, gap: 10 };
const TEXT = { name: "#ffffff", role: "#e0e0e0", site: "#b8b8b8" };
export const FONT = '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export async function renderAgentTemplateCard(preview: AgentTemplatePreview): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The share card cannot be drawn.");

  const profile = bloubAvatarProfile(preview.avatarSeed, preview.avatarHue);
  const [art] = await Promise.all([
    loadFeltCardArt(profile),
    document.fonts.load(`800 ${NAME.size}px ${FONT}`),
    document.fonts.load(`500 ${ROLE.size}px ${FONT}`),
  ]);

  context.fillStyle = "#000000";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  drawCover(context, art.planet);
  if (preview.avatarImage) {
    await drawPhoto(context, preview.avatarImage);
  } else {
    context.drawImage(art.body, BODY.x, BODY.y, BODY.size, BODY.size);
    context.drawImage(art.eyes, BODY.x, BODY.y, BODY.size, BODY.size);
  }
  drawColumn(context, preview);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The share card cannot be encoded.");
  return new Uint8Array(await blob.arrayBuffer());
}

function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement): void {
  const scale = Math.max(WIDTH / image.naturalWidth, HEIGHT / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.drawImage(image, (WIDTH - width) / 2, (HEIGHT - height) / 2, width, height);
}

async function drawPhoto(
  context: CanvasRenderingContext2D,
  photo: NonNullable<AgentTemplatePreview["avatarImage"]>,
): Promise<void> {
  const image = await loadImage(new Blob([new Uint8Array(photo.bytes)], { type: photo.mimeType }));
  const cx = BODY.x + BODY.size / 2;
  const cy = BODY.y + BODY.size / 2;
  const radius = PHOTO_SIZE / 2;
  const scale = Math.max(PHOTO_SIZE / image.naturalWidth, PHOTO_SIZE / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.55)";
  context.shadowBlur = 28;
  context.shadowOffsetY = 14;
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.fillStyle = "#000000";
  context.fill();
  context.restore();
  context.save();
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.clip();
  context.drawImage(image, cx - drawWidth / 2, cy - drawHeight / 2, drawWidth, drawHeight);
  context.restore();
}
function drawColumn(context: CanvasRenderingContext2D, preview: AgentTemplatePreview): void {
  const { x, width } = COLUMN;
  const centre = x + width / 2;
  context.textAlign = "center";
  context.textBaseline = "top";

  const nameSize = fittedNameSize(context, preview.name, width);
  const nameLineHeight = Math.round((NAME.lineHeight * nameSize) / NAME.size);
  context.font = `800 ${nameSize}px ${FONT}`;
  const name = wrapLines(context, preview.name, width, NAME.maxLines);

  context.font = `500 ${ROLE.size}px ${FONT}`;
  const roleText = (preview.title || preview.description).replace(/\s+/gu, " ").trim();
  const role = roleText ? wrapLines(context, roleText, width, ROLE.maxLines) : [];

  const nameHeight = name.length * nameLineHeight;
  const roleHeight = role.length > 0 ? ROLE.gap + role.length * ROLE.lineHeight : 0;
  const height = nameHeight + roleHeight + SITE.gap + SITE.lineHeight;
  let y = Math.min(COLUMN.centre - height / 2, COLUMN.bottom - height);

  context.font = `800 ${nameSize}px ${FONT}`;
  context.fillStyle = TEXT.name;
  for (const line of name) {
    context.fillText(line, centre, y + (nameLineHeight - nameSize) / 2);
    y += nameLineHeight;
  }
  if (role.length > 0) {
    y += ROLE.gap;
    context.font = `500 ${ROLE.size}px ${FONT}`;
    context.fillStyle = TEXT.role;
    for (const line of role) {
      context.fillText(line, centre, y + (ROLE.lineHeight - ROLE.size) / 2);
      y += ROLE.lineHeight;
    }
  }
  y += SITE.gap;
  context.font = `500 ${SITE.size}px ${FONT}`;
  context.fillStyle = TEXT.site;
  context.fillText("openbot.run", centre, y + (SITE.lineHeight - SITE.size) / 2);
  context.textAlign = "start";
  context.textBaseline = "alphabetic";
}
function fittedNameSize(context: CanvasRenderingContext2D, name: string, width: number) {
  const longest = name
    .trim()
    .split(/\s+/u)
    .reduce((widest, word) => (word.length > widest.length ? word : widest), "");
  let size = NAME.size;
  for (; size > NAME.minSize; size -= 1) {
    context.font = `800 ${size}px ${FONT}`;
    if (context.measureText(longest).width <= width) break;
  }
  return size;
}
export async function drawLogo(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colors: { logo: string; logoEye: string },
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
export function ellipsize(context: CanvasRenderingContext2D, text: string, width: number): string {
  let value = text;
  while (value && context.measureText(`${value}…`).width > width) {
    const space = value.lastIndexOf(" ");
    value = space > 0 ? value.slice(0, space) : value.slice(0, -1);
  }
  return `${value.replace(/[\s,.;:]+$/u, "")}…`;
}
