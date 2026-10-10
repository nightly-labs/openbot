import { html, token } from "./dom";
import type { Burst, Ring } from "./fx";
import { clamp, ease, progress } from "./timeline";

/** Brand colors as plain strings, for the canvas, which cannot read CSS variables. */
export interface Palette {
  lilac: string;
  white: string;
  eye: string;
  success: string;
}

export function readPalette(): Palette {
  return {
    lilac: token("--openbot-logo-production"),
    white: token("--openbot-text-primary"),
    eye: token("--openbot-logo-eye"),
    success: token("--openbot-success"),
  };
}

export interface Backdrop {
  /** The soft colored light behind the scene. The last call in a frame wins. */
  spot(color: string, opacity: number): void;
}

export interface SceneContext {
  /** The layer that the camera moves and the color split applies to. */
  content: HTMLElement;
  palette: Palette;
  backdrop: Backdrop;
  /** A scene adds its particles and rings here while it is built. */
  bursts: Burst[];
  rings: Ring[];
  /** A scene adds canvas drawing here that is not a burst or a ring, such as the pen light. */
  overlays: ((context: CanvasRenderingContext2D, t: number) => void)[];
}

export type RenderScene = (t: number) => void;

export function sceneLayer(context: SceneContext): HTMLElement {
  return html("div", "layer", context.content);
}

/**
 * The shared entry move: in from below, large, skewed and blurred, and sharp after `length`.
 * `distance` and `skew` can be negative to come in from the other side.
 */
export function punchIn(
  element: HTMLElement,
  t: number,
  start: number,
  x: number,
  y: number,
  options: { length?: number; distance?: number; skew?: number; scale?: number; axis?: "x" | "y"; drift?: number } = {},
) {
  const { length = 0.22, distance = 90, skew = -16, scale = 1.35, axis = "y", drift = 0 } = options;
  const amount = progress(t, start, length);
  const eased = ease.outExpo(amount);
  const offset = distance * (1 - eased);
  const grow = 1 + drift * progress(t, start, 0.6);
  element.style.transform = [
    `translate(${x + (axis === "x" ? offset : 0)}px, ${y + (axis === "y" ? offset : 0)}px)`,
    "translate(-50%, -50%)",
    `skewX(${skew * (1 - eased)}deg)`,
    `scale(${(scale - (scale - 1) * eased) * grow})`,
  ].join(" ");
  element.style.opacity = String(clamp(amount * 4));
  const blur = 22 * (1 - eased);
  element.style.filter = blur > 0.05 ? `blur(${blur}px)` : "";
}

/**
 * The big hit where a logo lands: a white ring and a wider lilac ring, lilac streaks and white
 * dots. The two bursts use `seed` and `seed + 1`.
 */
export function impact(context: SceneContext, at: number, x: number, y: number, seed: number) {
  const { palette } = context;
  context.rings.push(
    { at, x, y, radius: 1200, life: 0.8, width: 22, color: palette.white },
    { at: at + 0.05, x, y, radius: 1600, life: 1, width: 10, color: palette.lilac },
  );
  context.bursts.push(
    {
      at,
      x,
      y,
      count: 80,
      speed: 2400,
      life: 1,
      size: 7,
      color: palette.lilac,
      seed,
      shape: "streak",
      drag: 3.4,
    },
    { at, x, y, count: 30, speed: 1400, life: 0.9, size: 5, color: palette.white, seed: seed + 1, shape: "dot" },
  );
}

/** The lilac pill of a call to action or a URL. */
export function lilacPill(parent: HTMLElement, fontSize: number, padding: number, text?: string): HTMLElement {
  const pill = html("div", "text pill", parent, text);
  Object.assign(pill.style, {
    height: "112px",
    padding: `0 ${padding}px`,
    background: "var(--promo-lilac)",
    color: "var(--promo-eye)",
    fontSize: `${fontSize}px`,
    fontWeight: "700",
    letterSpacing: "-0.02em",
    boxShadow: "0 0 80px var(--promo-glow)",
  });
  return pill;
}
