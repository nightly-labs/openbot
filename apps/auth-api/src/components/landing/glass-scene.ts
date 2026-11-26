import type { GlassPoint } from "./glass-lens";

const WORD = /\S+/g;
const SVG_NS = "http://www.w3.org/2000/svg";

export interface GlassOrigin {
  readonly left: number;
  readonly top: number;
}

export interface CenteredText {
  readonly lines: readonly string[];
  readonly center: GlassPoint;
  readonly size: number;
  readonly family: string;
  readonly weight: string;
  readonly letterSpacing: number;
  readonly color: string;
}

const fontOf = (style: CSSStyleDeclaration) =>
  `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

const spacingOf = (style: CSSStyleDeclaration) => (style.letterSpacing === "normal" ? "0px" : style.letterSpacing);

function paintWords(
  ctx: CanvasRenderingContext2D,
  node: Text,
  origin: GlassOrigin,
  color: string | undefined,
  range: Range,
) {
  const parent = node.parentElement;
  const value = node.data;
  if (!parent || !value.trim()) return;
  const style = getComputedStyle(parent);
  ctx.font = fontOf(style);
  ctx.letterSpacing = spacingOf(style);
  ctx.fillStyle = color ?? style.color;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const metrics = ctx.measureText("Hg");
  const ascent = metrics.fontBoundingBoxAscent;
  const content = ascent + metrics.fontBoundingBoxDescent;
  for (const match of value.matchAll(WORD)) {
    range.setStart(node, match.index);
    range.setEnd(node, match.index + match[0].length);
    const rect = range.getBoundingClientRect();
    if (!rect.width) continue;
    const baseline = rect.top - origin.top + (rect.height - content) / 2 + ascent;
    ctx.fillText(match[0], rect.left - origin.left, baseline);
  }
}

function paintIcon(ctx: CanvasRenderingContext2D, svg: SVGSVGElement, origin: GlassOrigin) {
  const rect = svg.getBoundingClientRect();
  const box = svg.viewBox.baseVal;
  if (!rect.width || !box.width) return;
  const style = getComputedStyle(svg);
  const paintOf = (value: string) => (value === "currentcolor" || value === "currentColor" ? style.color : value);
  const stroke = paintOf(style.stroke);
  const fill = paintOf(style.fill);
  ctx.save();
  ctx.translate(rect.left - origin.left, rect.top - origin.top);
  ctx.scale(rect.width / box.width, rect.height / box.height);
  ctx.translate(-box.x, -box.y);
  ctx.lineWidth = Number.parseFloat(style.strokeWidth) || 1;
  ctx.lineCap = style.strokeLinecap === "round" ? "round" : style.strokeLinecap === "square" ? "square" : "butt";
  ctx.lineJoin = style.strokeLinejoin === "round" ? "round" : style.strokeLinejoin === "bevel" ? "bevel" : "miter";
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;
  for (const shape of svg.querySelectorAll("path")) {
    if (shape.namespaceURI !== SVG_NS) continue;
    const path = new Path2D(shape.getAttribute("d") ?? "");
    if (fill !== "none") ctx.fill(path);
    if (stroke !== "none") ctx.stroke(path);
  }
  ctx.restore();
}

export function paintElement(ctx: CanvasRenderingContext2D, element: Element, origin: GlassOrigin, color?: string) {
  const range = document.createRange();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text) paintWords(ctx, node, origin, color, range);
  }
  for (const svg of element.querySelectorAll("svg")) paintIcon(ctx, svg, origin);
}

export function paintCentered(ctx: CanvasRenderingContext2D, text: CenteredText) {
  const { lines, center, size } = text;
  ctx.font = `${text.weight} ${size}px ${text.family}`;
  ctx.letterSpacing = `${text.letterSpacing * size}px`;
  ctx.fillStyle = text.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const metrics = ctx.measureText(lines.join(" "));
  const ascent = metrics.actualBoundingBoxAscent || size * 0.72;
  const descent = metrics.actualBoundingBoxDescent || size * 0.2;
  const lineHeight = size * 1.02;
  const total = lineHeight * (lines.length - 1) + ascent + descent;
  let y = center.y - total / 2 + ascent;
  for (const line of lines) {
    ctx.fillText(line, center.x, y);
    y += lineHeight;
  }
}

export function fitSize(
  ctx: CanvasRenderingContext2D,
  text: Omit<CenteredText, "size" | "center" | "color">,
  width: number,
  height: number,
) {
  ctx.font = `${text.weight} 100px ${text.family}`;
  ctx.letterSpacing = `${text.letterSpacing * 100}px`;
  const widest = Math.max(...text.lines.map((line) => ctx.measureText(line).width), 1);
  return Math.min((width * 100) / widest, height / (text.lines.length * 1.02));
}

export function paintRobot(ctx: CanvasRenderingContext2D, center: GlassPoint, size: number, color: string) {
  const scale = ctx.getTransform().a || 1;
  const sprite = document.createElement("canvas");
  sprite.width = Math.ceil(size * scale);
  sprite.height = Math.ceil(size * scale);
  const pen = sprite.getContext("2d");
  if (!pen) return;
  const u = size * scale;
  const mid = u / 2;
  pen.fillStyle = color;
  pen.beginPath();
  pen.roundRect(mid - 0.42 * u, 0.26 * u, 0.84 * u, 0.62 * u, 0.2 * u);
  pen.roundRect(mid - 0.5 * u, 0.46 * u, 0.1 * u, 0.24 * u, 0.04 * u);
  pen.roundRect(mid + 0.4 * u, 0.46 * u, 0.1 * u, 0.24 * u, 0.04 * u);
  pen.roundRect(mid - 0.03 * u, 0.1 * u, 0.06 * u, 0.18 * u, 0.03 * u);
  pen.moveTo(mid + 0.07 * u, 0.1 * u);
  pen.arc(mid, 0.1 * u, 0.07 * u, 0, Math.PI * 2);
  pen.fill();
  pen.globalCompositeOperation = "destination-out";
  pen.beginPath();
  pen.moveTo(mid - 0.095 * u, 0.5 * u);
  pen.arc(mid - 0.18 * u, 0.5 * u, 0.085 * u, 0, Math.PI * 2);
  pen.moveTo(mid + 0.265 * u, 0.5 * u);
  pen.arc(mid + 0.18 * u, 0.5 * u, 0.085 * u, 0, Math.PI * 2);
  pen.fill();
  pen.beginPath();
  pen.roundRect(mid - 0.17 * u, 0.7 * u, 0.34 * u, 0.065 * u, 0.0325 * u);
  pen.fill();
  ctx.drawImage(sprite, center.x - size / 2, center.y - size * 0.52, size, size);
}
