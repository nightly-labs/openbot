// The cue sheet of the pastel video, in beats at 120 BPM. The scenes and the soundtrack both read
// it, so a pop and its sound cannot drift apart.

import { BEAT } from "../timeline";

export { BEAT };

export function at(beat: number): number {
  return beat * BEAT;
}

/** 32 beats. */
export const PASTEL_DURATION = at(32);

export const CUE = {
  /** The mascot drops in, lands, and blinks. */
  drop: at(0.3),
  land: at(1),
  blink: at(2.5),
  meet: at(2),
  name: at(3),
  /** Each wipe floods the frame with the next scene's color from one point. */
  wipeTeam: at(5),
  teamTitle: at(5.5),
  cards: [at(7), at(7.5), at(8), at(8.5)],
  dance: { from: at(9), to: at(11.5) },
  wipeChat: at(12),
  window: at(12.25),
  chatTitle: [at(12.5), at(13), at(13.5)],
  request: at(14),
  messages: [at(15), at(16), at(17), at(18)],
  shipped: at(19),
  wipeModels: at(20.5),
  modelsTitle: at(21),
  modelsLine: at(21.5),
  coins: [at(22), at(22.5), at(23), at(23.5)],
  wipeOutro: at(25),
  logo: at(25.5),
  tagline: at(26.5),
  url: at(27.5),
  peek: [at(28.5), at(28.75), at(29), at(29.25)],
  wink: at(30.5),
  end: PASTEL_DURATION,
} as const;

/** How long a wipe takes to fill the frame. */
export const WIPE = 0.55;
export const WIPES = [CUE.wipeTeam, CUE.wipeChat, CUE.wipeModels, CUE.wipeOutro] as const;
