// Small builders for the app parts that the device draws: boxes, text, icons and color mixes.

import { html, svg } from "../dom";

type Style = Partial<CSSStyleDeclaration>;

/** An absolutely placed box. Its coordinates are its parent's. */
export function box(parent: Element, style: Style = {}, text?: string, className = ""): HTMLDivElement {
  const element = html("div", className, parent, text);
  Object.assign(element.style, { position: "absolute", left: "0", top: "0", boxSizing: "border-box", ...style });
  return element;
}

/** One line of app text. */
export function label(parent: Element, text: string, style: Style, className = "text"): HTMLDivElement {
  const element = html("div", className, parent, text);
  Object.assign(element.style, style);
  return element;
}

export function put(element: HTMLElement | SVGElement, x: number, y: number, width?: number, height?: number) {
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
  if (width !== undefined) element.style.width = `${Math.max(0, width)}px`;
  if (height !== undefined) element.style.height = `${Math.max(0, height)}px`;
}

/** `from` at 0, `to` at 1. */
export function mix(from: string, to: string, amount: number): string {
  if (amount <= 0) return from;
  if (amount >= 1) return to;
  return `color-mix(in srgb, ${to} ${amount * 100}%, ${from})`;
}

/** 24-point stroke icons, drawn in the text color. */
export const ICONS = {
  search: "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14M20 20l-4.2-4.2",
  back: "M15 5l-7 7l7 7",
  forward: "M9 5l7 7l-7 7",
  reload: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.5H15",
  lock: "M8 11V8.5a4 4 0 0 1 8 0V11M6 11h12v9H6z",
  close: "M7 7l10 10M17 7L7 17",
  check: "M5 12.5l4.5 4.5L19 7.5",
  send: "M12 19V5M5.5 11.5L12 5l6.5 6.5",
} as const;

/** Filled 24-point icons: the SF Symbols that the Live Activity uses, drawn by hand. */
export const SYMBOLS = {
  sparkles:
    "M10 3l1.9 5.6L17.5 10.5l-5.6 1.9L10 18l-1.9-5.6L2.5 10.5l5.6-1.9zM18.5 2.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z",
  message:
    "M5 4h14a2.5 2.5 0 0 1 2.5 2.5v8.5A2.5 2.5 0 0 1 19 17.5h-7.5L6.5 21.5v-4H5A2.5 2.5 0 0 1 2.5 15V6.5A2.5 2.5 0 0 1 5 4z",
} as const;

export function icon(parent: Element, size: number, path: string, filled = false): SVGSVGElement {
  const element = svg("svg", { viewBox: "0 0 24 24", width: size, height: size }, parent);
  svg(
    "path",
    filled
      ? { d: path, fill: "currentColor" }
      : {
          d: path,
          fill: "none",
          stroke: "currentColor",
          "stroke-width": 2.4,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        },
    element,
  );
  return element;
}

export function placeIcon(element: SVGSVGElement, x: number, y: number) {
  Object.assign(element.style, { position: "absolute", left: `${x}px`, top: `${y}px` });
}
