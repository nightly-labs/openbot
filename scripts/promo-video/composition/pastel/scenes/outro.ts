// Beats 25-32. The mark drops onto the lavender end card, the line pops in under it, the URL pill
// bounces, the team peeks up from the bottom edge, and the mark winks.

import { createAvatar } from "../../avatar";
import { html } from "../../dom";
import type { RenderScene } from "../../scene";
import { clamp, ease, progress, STAGE_HEIGHT, STAGE_WIDTH } from "../../timeline";
import { PASTEL_COPY } from "../copy";
import { at, BEAT, CUE } from "../cues";
import { float, hop, placePose, pop } from "../motion";
import { createMascot, createWord, memberOf } from "../parts";
import { createFloaters, type PastelContext } from "../stage";

const MASCOT = { x: 960, ground: 450, size: 260 } as const;
const TAGLINE = { y: 590, step: 104, size: 96 } as const;
const PILL = { y: 840 } as const;
const PEEKS = [
  { x: 250, tilt: 12 },
  { x: 560, tilt: -6 },
  { x: 1360, tilt: 6 },
  { x: 1670, tilt: -12 },
] as const;
const PEEK = { size: 240, rest: 1010 } as const;

export function createOutro(context: PastelContext): RenderScene {
  const { layer } = context;
  const floaters = createFloaters(layer, {
    seed: 71,
    start: CUE.wipeOutro,
    colors: ["var(--pastel-white)", "var(--pastel-pink)", "var(--pastel-butter)"],
    keepOut: [
      { left: 780, top: MASCOT.ground - MASCOT.size - 40, right: 1140, bottom: MASCOT.ground },
      { left: 380, top: TAGLINE.y - 90, right: 1540, bottom: TAGLINE.y + TAGLINE.step + 40 },
      { left: 0, top: PILL.y - 70, right: STAGE_WIDTH, bottom: STAGE_HEIGHT },
    ],
  });
  const mascot = createMascot(layer);
  const lines = PASTEL_COPY.tagline.map((text) => createWord(layer, text, TAGLINE.size));
  const url = html("div", "pastel-pill", layer, PASTEL_COPY.url);
  Object.assign(url.style, {
    height: "124px",
    padding: "0 70px",
    background: "var(--pastel-ink)",
    color: "var(--pastel-white)",
    fontSize: "56px",
    letterSpacing: "-0.02em",
    boxShadow: "0 24px 60px var(--pastel-shadow)",
  });

  const peeks = PASTEL_COPY.messages.map((message, index) => {
    const member = memberOf(message.name);
    const avatar = createAvatar(layer, member.seed, member.hue, PEEK.size);
    return { avatar, ...(PEEKS[index] ?? PEEKS[0]), start: CUE.peek[index] ?? 0 };
  });

  context.poppers.push(
    {
      at: CUE.logo + 0.45,
      x: MASCOT.x,
      y: MASCOT.ground,
      count: 70,
      speed: 2300,
      direction: 0,
      spread: 160,
      life: 1.5,
      seed: 471,
      colors: context.confetti,
    },
    {
      at: CUE.url + 0.05,
      x: 960,
      y: PILL.y,
      count: 40,
      speed: 1500,
      direction: 0,
      spread: 120,
      life: 1.1,
      seed: 472,
      colors: context.confetti,
      size: 14,
    },
  );

  return (t) => {
    floaters(t);
    mascot(t, {
      ...MASCOT,
      drop: CUE.logo,
      land: CUE.logo + 0.45,
      hops: [at(29.5)],
      wink: CUE.wink,
      looks: [
        [CUE.peek[0] ?? 0, -0.04, 0.03],
        [CUE.peek[3] ?? 0, 0.04, 0.03],
        [CUE.wink - 0.2, 0, 0],
      ],
    });
    lines.forEach((line, index) => {
      line.render(t, CUE.tagline + index * BEAT, 960, TAGLINE.y + index * TAGLINE.step);
    });

    const { scaleX, scaleY } = pop(t, CUE.url, 2.6, 0.34);
    const drift = float(t, 5, 4);
    placePose(url, { x: 960, y: PILL.y + drift.y, scaleX, scaleY, rotate: 0, opacity: clamp((t - CUE.url) * 10) });

    for (const [index, peek] of peeks.entries()) {
      // Up from below the frame on a spring, then a small hop on every other beat.
      const rise = ease.outBack(progress(t, peek.start, 0.45));
      const jump = hop(t, peek.start + 1 + (index % 2) * BEAT, 0.36, 40);
      placePose(
        peek.avatar.element,
        {
          x: peek.x,
          y: PEEK.rest + 260 * (1 - rise) - jump.lift,
          scaleX: jump.scaleX,
          scaleY: jump.scaleY,
          rotate: peek.tilt + 3 * Math.sin(t * 2.4 + index),
          opacity: t >= peek.start ? 1 : 0,
        },
        "50% 100%",
      );
      peek.avatar.render(t);
    }
  };
}
