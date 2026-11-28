import { APP_LOGO_CORNER, APP_LOGO_EYE_POINTS, APP_LOGO_SIZE } from "@openbot/brand/app-logo-shape";
import type { ContentImageMark } from "./content-images";
import { RIVAL_MARK_SHAPES, type RivalMarkName } from "./src/components/compare/rival-mark-shapes";

export const LOGO_BACKGROUND = "#d6adf2";
const LOGO_EYE = "#040007";
export const FONT_FAMILY = '"Inter Variable", Inter, system-ui, sans-serif';

export function drawMark(
  context: CanvasRenderingContext2D,
  mark: ContentImageMark,
  x: number,
  y: number,
  size: number,
): void {
  if (mark === "openbot") drawOpenBotMark(context, x, y, size);
  else drawRivalMark(context, mark, x, y, size);
}

export function appLogoEyes(): number[][] {
  return [APP_LOGO_EYE_POINTS.left, APP_LOGO_EYE_POINTS.right].map((points) => points.split(/\s+/u).map(Number));
}

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
  for (const values of appLogoEyes()) {
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

export function roundedRect(
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
