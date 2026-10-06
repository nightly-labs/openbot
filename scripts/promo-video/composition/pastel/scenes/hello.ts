// Beats 0-5. The mark drops in, lands with a squash, looks down at its name as the words pop in,
// blinks, and hops.

import type { RenderScene } from "../../scene";
import { PASTEL_COPY } from "../copy";
import { at, CUE } from "../cues";
import { createMascot, createWord } from "../parts";
import { createFloaters, type PastelContext } from "../stage";

export const HELLO_MASCOT = { x: 960, ground: 640, size: 320 } as const;
const WORDS = { y: 860, size: 170, gap: 56 } as const;

export function createHello(context: PastelContext): RenderScene {
  const { layer } = context;
  const floaters = createFloaters(layer, {
    seed: 11,
    start: CUE.land - 0.1,
    colors: ["var(--pastel-white)", "var(--pastel-lilac)", "var(--pastel-pink)"],
    keepOut: [
      { left: 760, top: 300, right: 1160, bottom: 680 },
      { left: 360, top: 720, right: 1560, bottom: 1000 },
    ],
  });
  const mascot = createMascot(layer);
  const meet = createWord(layer, PASTEL_COPY.meet, WORDS.size);
  const name = createWord(layer, PASTEL_COPY.name, WORDS.size);
  const left = 960 - (meet.width + WORDS.gap + name.width) / 2;

  context.poppers.push(
    // Dust where the mark lands.
    {
      at: CUE.land,
      x: HELLO_MASCOT.x,
      y: HELLO_MASCOT.ground,
      count: 18,
      speed: 900,
      direction: 0,
      spread: 150,
      life: 0.6,
      seed: 401,
      colors: context.confetti.slice(-1),
      size: 16,
    },
    {
      at: CUE.name + 0.04,
      x: 960,
      y: WORDS.y - 60,
      count: 70,
      speed: 2100,
      direction: 0,
      spread: 110,
      life: 1.3,
      seed: 402,
      colors: context.confetti,
    },
  );

  return (t) => {
    floaters(t);
    mascot(t, {
      ...HELLO_MASCOT,
      drop: CUE.drop,
      land: CUE.land,
      hops: [at(4)],
      blink: CUE.blink,
      looks: [
        [CUE.meet - 0.1, -0.02, 0.035],
        [CUE.name - 0.1, 0.03, 0.035],
        [CUE.blink - 0.15, 0, 0],
      ],
    });
    // Each word grows away from the gap, so the two never touch.
    meet.render(t, CUE.meet, left + meet.width / 2, WORDS.y, "100% 100%");
    name.render(t, CUE.name, left + meet.width + WORDS.gap + name.width / 2, WORDS.y, "0% 100%");
  };
}
