// The song for the everywhere video. The licence needs the credit line.
//
// `bpm` and `start` were measured one time from the decoded audio (onset autocorrelation). `start`
// is the first beat of the drop at bar 41, after the break, so beat 0 of the video is the drop.

import type { Music } from "../music";

export const EVERYWHERE_MUSIC = {
  title: "Voxel Revolution",
  artist: "Kevin MacLeod",
  source: "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN2000025",
  download: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Voxel%20Revolution.mp3",
  file: "Voxel-Revolution.mp3",
  sha256: "9977d93c698abacc29e5da7ff0bccee2b8f6de47ed7e567cb0f1ed9b7564f74e",
  licence: "CC BY 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
  credit: [
    '"Voxel Revolution"',
    "Kevin MacLeod (incompetech.com)",
    "Licensed under Creative Commons: By Attribution 4.0",
    "http://creativecommons.org/licenses/by/4.0/",
  ].join("\n"),
  bpm: 121.94,
  start: 78.71,
} as const satisfies Music;
