import { APP_LOGO_CORNER, APP_LOGO_EYE_POINTS, APP_LOGO_SIZE } from "@openbot/brand/app-logo-shape";
import { nextId, svg } from "./dom";

/** Eye pivots, from `.app-logo-eye-left` and `.app-logo-eye-right` in packages/brand/src/logo.css. */
const PIVOTS = [
  { x: APP_LOGO_SIZE * 0.287, y: APP_LOGO_SIZE * 0.487 },
  { x: APP_LOGO_SIZE * 0.712, y: APP_LOGO_SIZE * 0.488 },
] as const;

export interface LogoPose {
  /** Center, in stage pixels. */
  x: number;
  y: number;
  /** Side of the square, in stage pixels. */
  size: number;
  /** Scale of the lilac square around its center. 0 hides it. */
  square: number;
  /** How much of each eye stroke is drawn, 0 to 1. */
  draw: readonly [number, number];
  /** Vertical scale of each eye: 1 open, 0.08 shut. */
  blink: readonly [number, number];
  /** Eye offset, as a fraction of the mark. */
  lookX: number;
  lookY: number;
  /** A CSS color for the eye strokes. */
  eyeColor: string;
  /** Lilac glow around the strokes, in stage pixels. */
  glow: number;
  /** Position of the light band across the square, 0 to 1. Outside that range it is off screen. */
  sheen: number;
  opacity: number;
}

export const RESTING_POSE: LogoPose = {
  x: 960,
  y: 540,
  size: 480,
  square: 1,
  draw: [1, 1],
  blink: [1, 1],
  lookX: 0,
  lookY: 0,
  eyeColor: "var(--promo-eye)",
  glow: 0,
  sheen: -1,
  opacity: 1,
};

export interface Logo {
  element: SVGSVGElement;
  render(pose: LogoPose): void;
  /** The drawing end of each eye stroke, in stage pixels, for the pen light. */
  penTips(pose: LogoPose): { x: number; y: number }[];
  /** A point `along` one eye stroke, as a fraction of the mark, with no pose applied. */
  eyePoint(eye: 0 | 1, along: number): { x: number; y: number };
}

export function createLogo(parent: Element): Logo {
  const element = svg("svg", { class: "logo", viewBox: `0 0 ${APP_LOGO_SIZE} ${APP_LOGO_SIZE}` }, parent);
  const defs = svg("defs", {}, element);
  const clipId = nextId("logo-clip");
  const sheenId = nextId("logo-sheen");
  const clip = svg("clipPath", { id: clipId }, defs);
  svg("rect", { width: APP_LOGO_SIZE, height: APP_LOGO_SIZE, rx: APP_LOGO_CORNER }, clip);
  const gradient = svg("linearGradient", { id: sheenId, x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
  for (const [offset, opacity] of [
    [0, 0],
    [0.5, 0.75],
    [1, 0],
  ] as const) {
    svg("stop", { offset, "stop-opacity": opacity, style: "stop-color: var(--promo-white)" }, gradient);
  }

  const square = svg("g", {}, element);
  svg(
    "rect",
    { width: APP_LOGO_SIZE, height: APP_LOGO_SIZE, rx: APP_LOGO_CORNER, style: "fill: var(--promo-lilac)" },
    square,
  );
  const sheenGroup = svg("g", { "clip-path": `url(#${clipId})` }, square);
  const sheen = svg("rect", { y: -120, width: 70, height: 480, fill: `url(#${sheenId})` }, sheenGroup);

  const eyes = svg("g", {}, element);
  const strokes = [APP_LOGO_EYE_POINTS.left, APP_LOGO_EYE_POINTS.right].map((points) => {
    const group = svg("g", {}, eyes);
    const line = svg("polyline", { class: "logo-eye", points, pathLength: 1, "stroke-dasharray": "1 1" }, group);
    return { group, line, length: line.getTotalLength() };
  });

  const render = (pose: LogoPose) => {
    const style = element.style;
    style.left = `${pose.x - pose.size / 2}px`;
    style.top = `${pose.y - pose.size / 2}px`;
    style.width = `${pose.size}px`;
    style.height = `${pose.size}px`;
    style.opacity = String(pose.opacity);
    style.display = pose.opacity <= 0 ? "none" : "";

    const half = APP_LOGO_SIZE / 2;
    square.setAttribute("transform", `translate(${half} ${half}) scale(${pose.square}) translate(${-half} ${-half})`);
    square.style.display = pose.square <= 0.001 ? "none" : "";
    const sweep = -140 + pose.sheen * 420;
    sheen.setAttribute("transform", `translate(${sweep} 0) rotate(24 35 120)`);
    sheen.style.display = pose.sheen <= 0 || pose.sheen >= 1 ? "none" : "";

    eyes.setAttribute("transform", `translate(${pose.lookX * APP_LOGO_SIZE} ${pose.lookY * APP_LOGO_SIZE})`);
    // A filter on an SVG child is in the mark's units, so the glow is scaled back to stage pixels.
    const glow = (pose.glow * APP_LOGO_SIZE) / pose.size;
    eyes.style.filter = pose.glow > 0.1 ? `drop-shadow(0 0 ${glow}px var(--promo-lilac))` : "";
    strokes.forEach((stroke, index) => {
      const pivot = PIVOTS[index] ?? PIVOTS[0];
      const blink = pose.blink[index] ?? 1;
      stroke.group.setAttribute(
        "transform",
        `translate(${pivot.x} ${pivot.y}) scale(1 ${blink}) translate(${-pivot.x} ${-pivot.y})`,
      );
      const drawn = pose.draw[index] ?? 1;
      stroke.line.setAttribute("stroke-dashoffset", String(1 - drawn));
      stroke.line.style.stroke = pose.eyeColor;
      stroke.line.style.display = drawn <= 0 ? "none" : "";
    });
  };

  const penTips = (pose: LogoPose) =>
    strokes.map((stroke, index) => {
      const point = stroke.line.getPointAtLength((pose.draw[index] ?? 1) * stroke.length);
      const unit = pose.size / APP_LOGO_SIZE;
      return {
        x: pose.x + (point.x + pose.lookX * APP_LOGO_SIZE - APP_LOGO_SIZE / 2) * unit,
        y: pose.y + (point.y + pose.lookY * APP_LOGO_SIZE - APP_LOGO_SIZE / 2) * unit,
      };
    });

  const eyePoint = (eye: 0 | 1, along: number) => {
    const stroke = strokes[eye] ?? strokes[0];
    const point = stroke ? stroke.line.getPointAtLength(along * stroke.length) : { x: 0, y: 0 };
    return { x: point.x / APP_LOGO_SIZE, y: point.y / APP_LOGO_SIZE };
  };

  return { element, render, penTips, eyePoint };
}
