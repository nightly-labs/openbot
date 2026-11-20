import type { ImageDimensions } from "./image-dimensions";

const FRAME_HEIGHT = 240;
export const MAX_FRAME_WIDTH = 280;
const MIN_FRAME_WIDTH = 72;
export const FRAME_RADIUS = 18;
export const FILL = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;

export function attachmentFrame(dimensions: ImageDimensions | null, maxWidth: number, unknownRatio: number) {
  const ratio = dimensions ? dimensions.width / dimensions.height : unknownRatio;
  const width = FRAME_HEIGHT * ratio;
  if (width > maxWidth) return { width: maxWidth, height: Math.round(maxWidth / ratio) };
  return { width: Math.max(MIN_FRAME_WIDTH, Math.round(width)), height: FRAME_HEIGHT };
}
