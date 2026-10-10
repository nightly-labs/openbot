// The cue sheet of the everywhere video, in beats of the song, so that every cut lands on a beat.
// `at(beat)` gives the time in seconds.

import { beats, FPS } from "../timeline";
import { EVERYWHERE_MUSIC } from "./music";

export const BEAT = beats(1, EVERYWHERE_MUSIC.bpm);

export function at(beat: number): number {
  return beats(beat, EVERYWHERE_MUSIC.bpm);
}

/** 28 beats, cut down to a whole frame. */
export const EVERYWHERE_DURATION = Math.floor(at(28) * FPS) / FPS;

export const CUE = {
  /** The request lands in the composer one word per half beat. The first word is in before t = 0. */
  words: [at(-0.5), at(0.5), at(1)],
  send: at(1.5),
  reply: at(2),
  tasks: at(2.5),
  desktopCaption: at(2.5),
  browser: at(6),
  typeUrl: at(6.5),
  typedUrl: at(7.5),
  browserCaption: at(6.5),
  phone: at(12),
  phoneDone: at(13),
  phoneCaption: at(13),
  home: at(15),
  compact: at(15.5),
  expand: at(16.5),
  message: at(17.5),
  fly: at(19.25),
  logo: at(20),
  tagline: at(21),
  line: at(22),
  url: at(22.5),
  blink: at(26),
  end: EVERYWHERE_DURATION,
} as const;

/** One step of the task list is done on each screen. The reply on the island stands for the last. */
export const TASK_TICKS = [at(3.5), at(8), at(14)] as const;
