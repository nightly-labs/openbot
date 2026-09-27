// The cue sheet of the team video, in beats of the song, so that every cut lands on a beat.
// `at(beat)` gives the time in seconds.

import { beats, FPS } from "../timeline";
import { MUSIC } from "./music";

export const BEAT = beats(1, MUSIC.bpm);

export function at(beat: number): number {
  return beats(beat, MUSIC.bpm);
}

/** 18 beats, cut down to a whole frame. */
export const TEAM_DURATION = Math.floor(at(18) * FPS) / FPS;

export const CUE = {
  /** The first line is already in the frame at t = 0. */
  line: at(-0.18),
  line2: at(0.5),
  mention: at(1),
  pull: at(1.5),
  stack: [at(1.75), at(2), at(2.25), at(2.5)],
  shipped: at(11),
  fold: at(12),
  logo: at(13),
  tagline: at(13.5),
  url: at(14),
  blink: at(16),
  end: TEAM_DURATION,
} as const;

/** One agent per two beats: typing on the first beat, the message on the second. */
export const TURNS = [3, 5, 7, 9].map((beat) => ({ typing: at(beat), message: at(beat + 1) }));

/** A baton flies from each @mention to the next agent, and lands when that agent starts to type. */
export const BATONS = [2.5, 4.5, 6.5, 8.5].map((beat) => ({ start: at(beat), land: at(beat + 0.5) }));
