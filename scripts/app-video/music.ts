// The song. It is not in the repository: render.ts downloads it from the source into
// .openbot-build/app-video/music/ and checks the hash. The licence needs the credit line.
//
// `bpm` and `start` were measured from the decoded audio (onset autocorrelation). `start` is the
// first beat of the drop at bar 17, so beat 0 of the video is the drop.

export const MUSIC = {
  title: "Laserpack",
  artist: "Kevin MacLeod",
  source: "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1800018",
  download: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Laserpack.mp3",
  file: "Laserpack.mp3",
  sha256: "9da19607351c507328840537491030d2f31e8ee8f87b8921986a5ed11e1e8359",
  licence: "CC BY 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
  credit: [
    '"Laserpack"',
    "Kevin MacLeod (incompetech.com)",
    "Licensed under Creative Commons: By Attribution 4.0",
    "http://creativecommons.org/licenses/by/4.0/",
  ].join("\n"),
  bpm: 128,
  start: 30.03,
} as const;
