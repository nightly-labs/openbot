// The frame of the pastel video. Each scene sits on its own layer, above the round wipe that brings
// in its color, so the wipe covers the scene before it. The confetti canvas is on top of all.

import { html, show, svg, token } from "../dom";
import type { RenderScene } from "../scene";
import { clamp, decay, ease, progress, random, STAGE_HEIGHT, STAGE_WIDTH } from "../timeline";
import { Confetti, type Popper } from "./confetti";
import { WIPE } from "./cues";
import { float, placePose, pop } from "./motion";

export interface Wipe {
  at: number;
  /** Where the color floods out from, in stage pixels. */
  x: number;
  y: number;
  /** A CSS color. */
  color: string;
}

export interface PastelContext {
  layer: HTMLElement;
  /** A scene adds its confetti here while it is built. */
  poppers: Popper[];
  /** Confetti colors as plain strings, for the canvas. */
  confetti: readonly string[];
}

export interface Segment {
  /** Every scene but the first comes in on a wipe. */
  wipe?: Wipe;
  create(context: PastelContext): RenderScene;
}

/** Far enough from any point of the frame to cover all of it. */
const COVER = Math.hypot(STAGE_WIDTH, STAGE_HEIGHT);

export async function createPastelStage(segments: readonly Segment[]): Promise<(t: number) => void> {
  const stage = document.getElementById("stage");
  if (!stage) throw new Error("The page has no #stage element.");
  const fitStage = () => {
    const scale = Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT);
    stage.style.transform = `scale(${scale})`;
  };
  fitStage();
  window.addEventListener("resize", fitStage);
  await Promise.all([600, 700, 800].map((weight) => document.fonts.load(`${weight} 100px "Inter Variable"`)));
  await document.fonts.ready;

  const world = html("div", "camera", stage);
  const poppers: Popper[] = [];
  const confetti = [
    "--pastel-lilac",
    "--pastel-pink",
    "--pastel-peach",
    "--pastel-sky",
    "--pastel-aqua",
    "--pastel-butter",
    "--pastel-green",
    "--pastel-white",
  ].map(token);

  const built = segments.map((segment) => {
    const lead = segment.wipe ? html("div", "pastel-wipe", world) : undefined;
    const fill = segment.wipe ? html("div", "pastel-wipe", world) : undefined;
    if (lead && segment.wipe)
      lead.style.background = `color-mix(in srgb, ${segment.wipe.color} 45%, var(--pastel-white))`;
    if (fill && segment.wipe) fill.style.background = segment.wipe.color;
    const layer = html("div", "layer", world);
    const render = segment.create({ layer, poppers, confetti });
    return { wipe: segment.wipe, lead, fill, layer, render };
  });
  const paper = new Confetti(world, poppers);

  return (t) => {
    built.forEach((segment, index) => {
      const next = built[index + 1]?.wipe;
      const visible = (!segment.wipe || t >= segment.wipe.at) && (!next || t < next.at + WIPE);
      if (segment.wipe && segment.lead && segment.fill) {
        drawWipe(segment.lead, segment.wipe, t, 0);
        drawWipe(segment.fill, segment.wipe, t, 0.07);
        // Once the next wipe has covered it, the color can go too.
        if (next && t >= next.at + WIPE) {
          show(segment.lead, false);
          show(segment.fill, false);
        }
      }
      if (show(segment.layer, visible)) segment.render(t);
    });
    paper.render(t);

    // The camera breathes, and leans in a little on each wipe.
    const lean = built.reduce((total, segment) => total + (segment.wipe ? decay(t, segment.wipe.at, 0.8) : 0), 0);
    world.style.transform = `scale(${1 + 0.006 * Math.sin(t * 0.9) + 0.025 * lean})`;
  };
}

function drawWipe(element: HTMLElement, wipe: Wipe, t: number, delay: number) {
  const amount = progress(t, wipe.at + delay, WIPE);
  if (!show(element, t >= wipe.at + delay)) return;
  const radius = COVER * ease.inOutCubic(amount);
  element.style.clipPath = amount >= 1 ? "" : `circle(${radius}px at ${wipe.x}px ${wipe.y}px)`;
}

type Shape = "dot" | "ring" | "square" | "sparkle";

/** A box in stage pixels that the floaters stay out of, such as a line of copy. */
export interface KeepOut {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How far a floater stays from a box, past its own radius, and how many places it tries. */
const CLEARANCE = 28;
const TRIES = 40;

/**
 * Soft shapes that drift near the edges of a scene, away from the middle and from the boxes in
 * `keepOut`, where the copy is. They pop in one after another from `start`.
 */
export function createFloaters(
  layer: HTMLElement,
  options: { seed: number; start: number; colors: readonly string[]; count?: number; keepOut?: readonly KeepOut[] },
): RenderScene {
  const next = random(options.seed);
  const kinds: readonly Shape[] = ["dot", "ring", "square", "sparkle"];
  const floaters = Array.from({ length: options.count ?? 9 }, (_, index) => {
    const kind = kinds[index % kinds.length] ?? "dot";
    const size = 34 + next() * 70;
    // The left or the right band, at the first place clear of the copy.
    const place = () => {
      const side = index % 2 === 0 ? 0.04 + next() * 0.2 : 0.76 + next() * 0.2;
      return { x: side * STAGE_WIDTH, y: (0.08 + next() * 0.84) * STAGE_HEIGHT };
    };
    let spot = place();
    for (let attempt = 0; attempt < TRIES && blocked(spot, size / 2, options.keepOut); attempt += 1) spot = place();
    const { x, y } = spot;
    const color = options.colors[index % options.colors.length] ?? "var(--pastel-white)";
    const element = svg("svg", { class: "pastel-shape", viewBox: "-50 -50 100 100", width: size, height: size }, layer);
    if (kind === "dot") svg("circle", { r: 48, style: `fill: ${color}` }, element);
    if (kind === "ring") svg("circle", { r: 38, style: `fill: none; stroke: ${color}; stroke-width: 18` }, element);
    if (kind === "square")
      svg("rect", { x: -42, y: -42, width: 84, height: 84, rx: 24, style: `fill: ${color}` }, element);
    if (kind === "sparkle") {
      svg(
        "path",
        {
          d: "M0 -50 C6 -10 10 -6 50 0 C10 6 6 10 0 50 C-6 10 -10 6 -50 0 C-10 -6 -6 -10 0 -50Z",
          style: `fill: ${color}`,
        },
        element,
      );
    }
    return {
      element,
      x,
      y,
      start: options.start + 0.05 + index * 0.06,
      seed: index + options.seed,
      spin: next() * 40 - 20,
    };
  });

  return (t) => {
    for (const floater of floaters) {
      const { scaleX, scaleY } = pop(t, floater.start, 2.2, 0.4);
      const drift = float(t, floater.seed, 14);
      placePose(floater.element, {
        x: floater.x + drift.x,
        y: floater.y + drift.y,
        scaleX,
        scaleY,
        rotate: floater.spin + drift.rotate * 6,
        opacity: clamp((t - floater.start) * 8),
      });
    }
  };
}

function blocked(spot: { x: number; y: number }, radius: number, boxes: readonly KeepOut[] = []): boolean {
  const reach = radius + CLEARANCE;
  return boxes.some(
    (box) =>
      spot.x > box.left - reach &&
      spot.x < box.right + reach &&
      spot.y > box.top - reach &&
      spot.y < box.bottom + reach,
  );
}
