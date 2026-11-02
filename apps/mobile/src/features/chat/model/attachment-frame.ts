import type { ImageDimensions } from "./image-dimensions";

// An image or video is this tall unless it is too wide for the column. The host sends no media
// size, so a height taken from the file changes once it downloads and moves every message below
// it; a fixed height keeps that change to the frame's own width. Portrait photos and screenshots,
// the usual case, never move the chat.
const FRAME_HEIGHT = 240;
export const MAX_FRAME_WIDTH = 280;
// An extremely narrow image keeps a frame wide enough to tap, and shows whole inside it.
const MIN_FRAME_WIDTH = 72;
export const FRAME_RADIUS = 18;
// Every layer of a frame fills it exactly, with no padding or percentage in between.
export const FILL = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;

/**
 * The frame a picture draws in, always showing the whole picture. It is 240 pt tall with the
 * picture's own width; a picture too wide for the column scales down to the column's width
 * instead, so nothing is cropped. `unknownRatio` reserves the width while the shape is unknown.
 */
export function attachmentFrame(dimensions: ImageDimensions | null, maxWidth: number, unknownRatio: number) {
  const ratio = dimensions ? dimensions.width / dimensions.height : unknownRatio;
  const width = FRAME_HEIGHT * ratio;
  if (width > maxWidth) return { width: maxWidth, height: Math.round(maxWidth / ratio) };
  return { width: Math.max(MIN_FRAME_WIDTH, Math.round(width)), height: FRAME_HEIGHT };
}
