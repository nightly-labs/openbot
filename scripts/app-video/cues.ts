// The cue sheet of the app video, in beats of the song, so that every cut lands on a beat.
// render.ts and the page both read it. Every time is in seconds from the first frame.

import { MUSIC } from "./music";

export const FPS = 60;
export const STAGE = { width: 1920, height: 1080 } as const;
/** The app's own window size. The stage scales it; the app lays out at this size. */
export const APP = { width: 1440, height: 900 } as const;
/** The wall clock of the app at t = 0. Messages and the day divider read it. */
export const APP_CLOCK_START = Date.parse("2026-10-06T09:41:00.000Z");

export const BEAT = 60 / MUSIC.bpm;

export function at(beat: number): number {
  return beat * BEAT;
}

/** 56 beats, cut down to a whole frame. */
export const DURATION = Math.floor(at(56) * FPS) / FPS;

export const CUE = {
  /** The logo lands on the drop. */
  logo: at(0),
  words: [at(2), at(2.5), at(3), at(4), at(4.5), at(5)],
  /** The window rises and the logo leaves. */
  window: at(7),
  settled: at(9),
  /** After the zoom, so the caption does not cover the window header. */
  askCaption: at(11.5),
  composerClick: at(11),
  typeFrom: at(11.5),
  /** The `@` of each mention is typed at this beat, then the picker is confirmed. */
  typeTo: at(19),
  send: at(19.5),
  turnStart: at(20),
  thinking: [at(20.5), at(21.5)],
  answerFrom: at(22.5),
  answerTo: at(27.5),
  handoff: at(28.5),
  teamCaption: at(30),
  researchClick: at(31.5),
  researchThinking: at(32.5),
  researchAnswerFrom: at(33.5),
  researchAnswerTo: at(37),
  modelsCaption: at(39),
  modelClick: at(40),
  /** Clicks on three provider tabs in the open model picker. */
  modelTabs: [at(41.5), at(42.5), at(43.5)],
  modelClose: at(45),
  outro: at(47),
  tagline: at(48),
  url: at(49),
  wink: at(51),
  end: DURATION,
} as const;

export interface FrameInput {
  /** Where the real mouse is, in page pixels. Hover states in the app follow it. */
  mouse: { x: number; y: number } | null;
  down: boolean;
  up: boolean;
  /** Text to type with the keyboard this frame. */
  type: string;
  press: string[];
}

declare global {
  /** What the stage page gives render.ts. */
  interface Window {
    appVideo: {
      ready: Promise<void>;
      frame(t: number): Promise<FrameInput>;
    };
  }
}
