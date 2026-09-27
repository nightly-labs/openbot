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
