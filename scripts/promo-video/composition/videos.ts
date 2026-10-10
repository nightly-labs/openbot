// The videos that render.ts can make. Each one is a page in this folder.

import { EVERYWHERE_DURATION } from "./everywhere/cues";
import { EVERYWHERE_MUSIC } from "./everywhere/music";
import type { Music } from "./music";
import { TEAM_DURATION } from "./team/cues";
import { MUSIC } from "./team/music";
import { DURATION } from "./timeline";

export interface Video {
  page: string;
  duration: number;
  /** The output file name, without the extension. */
  name: string;
  /** "synth": the page makes its own sound. Otherwise, the song that render.ts downloads. */
  audio: "synth" | Music;
}

export const VIDEOS = {
  promo: { page: "index.html", duration: DURATION, name: "openbot-promo", audio: "synth" },
  team: { page: "team.html", duration: TEAM_DURATION, name: "openbot-team", audio: MUSIC },
  everywhere: {
    page: "everywhere.html",
    duration: EVERYWHERE_DURATION,
    name: "openbot-everywhere",
    audio: EVERYWHERE_MUSIC,
  },
} as const satisfies Record<string, Video>;

export type VideoName = keyof typeof VIDEOS;
