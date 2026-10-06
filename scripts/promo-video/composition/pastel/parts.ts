// Parts that more than one pastel scene uses: a headline word that pops, and the logo as a mascot
// that drops in, squashes on the ground, hops and blinks.

import type { AvatarHue } from "@openbot/contracts/ipc";
import { html } from "../dom";
import { createLogo, RESTING_POSE } from "../logo";
import { MEMBERS } from "../scenes/team";
import { bump, clamp, ease, progress } from "../timeline";
import { hop, placePose, pop } from "./motion";

/** The avatar of the agent with this name, the same one that the other videos draw. */
export function memberOf(name: string): { seed: string; hue: AvatarHue } {
  return MEMBERS[name] ?? { seed: name, hue: 245 };
}

export interface Word {
  element: HTMLElement;
  width: number;
  /** Pops the word in at `start`, centered on `x`, `y`. It grows from `origin`, the bottom middle by default. */
  render(t: number, start: number, x: number, y: number, origin?: string): void;
}

export function createWord(layer: HTMLElement, text: string, size: number, color = "var(--pastel-ink)"): Word {
  const element = html("div", "pastel-word", layer, text);
  element.style.fontSize = `${size}px`;
  element.style.color = color;
  const width = element.offsetWidth;
  return {
    element,
    width,
    render(t, start, x, y, origin = "50% 100%") {
      const { scaleX, scaleY } = pop(t, start, 2.8, 0.42);
      // The word comes up from below its line as it grows.
      const rise = 40 * (1 - ease.outCubic(progress(t, start, 0.35)));
      placePose(element, { x, y: y + rise, scaleX, scaleY, rotate: 0, opacity: clamp((t - start) * 10) }, origin);
    },
  };
}

export interface MascotMotion {
  x: number;
  /** Where the bottom of the mark rests. */
  ground: number;
  size: number;
  /** The fall starts here and touches the ground at `land`. */
  drop: number;
  land: number;
  hops?: readonly number[];
  blink?: number;
  /** One eye only. */
  wink?: number;
  /** Eye offsets over time, as [time, x, y]. */
  looks?: readonly (readonly [number, number, number])[];
}

const HOP = { length: 0.42, height: 90 } as const;

/** The logo mark as a character, with a soft shadow on the ground under it. */
export function createMascot(layer: HTMLElement) {
  const shadow = html("div", "pastel-shape", layer);
  Object.assign(shadow.style, { borderRadius: "50%", background: "var(--pastel-shadow)", filter: "blur(6px)" });
  const body = html("div", "layer", layer);
  const logo = createLogo(body);
  logo.element.style.filter = "drop-shadow(0 24px 40px var(--pastel-shadow))";

  return (t: number, motion: MascotMotion) => {
    const { x, ground, size } = motion;
    // The fall: from above the frame, faster as it comes down, and stretched by the speed.
    const fall = ease.inCubic(progress(t, motion.drop, motion.land - motion.drop));
    const height = (ground + size) * (1 - fall);
    const falling = t >= motion.drop && t < motion.land;
    // The landing: a squash that rings down.
    const since = t - motion.land;
    const ring = since > 0 ? 0.3 * Math.exp(-since * 7) * Math.cos(since * 26) : 0;
    let lift = 0;
    let scaleX = falling ? 0.86 : 1 + ring * 0.8;
    let scaleY = falling ? 1.18 : 1 - ring;
    for (const at of motion.hops ?? []) {
      const jump = hop(t, at, HOP.length, HOP.height);
      lift += jump.lift;
      scaleX *= jump.scaleX;
      scaleY *= jump.scaleY;
    }
    const blink = motion.blink === undefined ? 1 : 1 - 0.92 * bump(t, motion.blink, 0.18);
    const wink = motion.wink === undefined ? 1 : 1 - 0.92 * bump(t, motion.wink, 0.3);
    let lookX = 0;
    let lookY = 0;
    for (const [at, toX, toY] of motion.looks ?? []) {
      const amount = ease.outCubic(progress(t, at, 0.14));
      lookX += (toX - lookX) * amount;
      lookY += (toY - lookY) * amount;
    }

    const visible = t >= motion.drop;
    const center = ground - size / 2 - height - lift;
    logo.render({
      ...RESTING_POSE,
      x,
      y: center,
      size,
      blink: [blink, blink * wink],
      lookX,
      lookY,
      opacity: visible ? 1 : 0,
    });
    // The squash pivots on the ground, so the mark stays on it.
    body.style.transformOrigin = `${x}px ${center + size / 2}px`;
    body.style.transform = `scale(${scaleX}, ${scaleY})`;

    // The shadow is wide and dark on the ground, and small and faint when the mark is high.
    const air = clamp((height + lift) / 500);
    placePose(shadow, {
      x,
      y: ground + 6,
      scaleX: 1 - 0.6 * air,
      scaleY: 1 - 0.6 * air,
      rotate: 0,
      opacity: visible ? 1 - 0.8 * air : 0,
    });
    shadow.style.width = `${size * 0.8}px`;
    shadow.style.height = `${size * 0.12}px`;
  };
}
