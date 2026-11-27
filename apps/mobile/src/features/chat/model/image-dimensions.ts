import { type ImageSize, imageSizeFromBytes } from "@openbot/contracts/image-size";
import { base64ToBytes } from "@openbot/team-client/base64";

export type ImageDimensions = ImageSize;

const HEADER_BASE64_LENGTH = 96 * 1024;

export function imageDimensions(base64: string): ImageDimensions | null {
  const bytes = decodePrefix(base64);
  return bytes ? imageSizeFromBytes(bytes) : null;
}

function decodePrefix(base64: string): Uint8Array | null {
  const prefix = base64.slice(0, HEADER_BASE64_LENGTH);
  try {
    return base64ToBytes(prefix.slice(0, prefix.length - (prefix.length % 4)));
  } catch {
    return null;
  }
}

export function sameShape(left: ImageDimensions, right: ImageDimensions) {
  return Math.abs(left.width / left.height - right.width / right.height) < 0.01;
}
