// A song that render.ts downloads for a video. Songs are not in the repository: render.ts gets
// them from the source into .openbot-build/promo-video/music/ and checks the hash.

export interface Music {
  title: string;
  artist: string;
  /** The track page, which states the licence. */
  source: string;
  download: string;
  /** The cache file name in the music folder. */
  file: string;
  sha256: string;
  licence: string;
  licenceUrl: string;
  /** The credit text that the licence needs. */
  credit: string;
  bpm: number;
  /** The first beat of the video, in seconds of the song. */
  start: number;
}
