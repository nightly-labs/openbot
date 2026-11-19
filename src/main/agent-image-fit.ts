import { type NativeImage, nativeImage } from "electron";
import type { ImageFitResult } from "../backend/agent/image-reader";

const MAX_EDGE = 2048;
const MAX_KEPT_BYTES = 3 * 1024 * 1024;
const MAX_PIXELS = 120_000_000;
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const STORED_PIXEL: Record<number, (x: number, y: number, width: number, height: number) => [number, number]> = {
  2: (x, y, width) => [width - 1 - x, y],
  3: (x, y, width, height) => [width - 1 - x, height - 1 - y],
  4: (x, y, _width, height) => [x, height - 1 - y],
  5: (x, y) => [y, x],
  6: (x, y, _width, height) => [y, height - 1 - x],
  7: (x, y, width, height) => [width - 1 - y, height - 1 - x],
  8: (x, y, width) => [width - 1 - y, x],
};

export function fitImageForAgent(bytes: Uint8Array): ImageFitResult {
  const file = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jpeg = file[0] === 0xff && file[1] === 0xd8;
  const png = file.length >= 24 && file.subarray(0, 8).equals(PNG_SIGNATURE);
  if (!jpeg && !png) return "unsupported";
  const facts = jpeg ? jpegFacts(file) : { orientation: 1, pixels: file.readUInt32BE(16) * file.readUInt32BE(20) };
  if (facts.pixels > MAX_PIXELS) return "tooLarge";
  if (facts.pixels === 0) return "unsupported";
  const source = nativeImage.createFromBuffer(file);
  if (source.isEmpty()) return "unsupported";
  const { width, height } = source.getSize();
  const { orientation } = facts;
  const turned = orientation >= 5 && orientation <= 8;
  const sourceWidth = turned ? height : width;
  const sourceHeight = turned ? width : height;
  if (Math.max(width, height) <= MAX_EDGE && file.length <= MAX_KEPT_BYTES && !STORED_PIXEL[orientation]) {
    const dataUrl = `data:image/${jpeg ? "jpeg" : "png"};base64,${file.toString("base64")}`;
    return { dataUrl, width, height, sourceWidth, sourceHeight };
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const resized =
    scale < 1
      ? source.resize({
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
          quality: "good",
        })
      : source;
  const fitted = upright(resized, orientation);
  const encodedPng = png ? fitted.toPNG() : null;
  const encoded = encodedPng && encodedPng.length <= MAX_KEPT_BYTES ? encodedPng : fitted.toJPEG(85);
  const size = fitted.getSize();
  return {
    dataUrl: `data:image/${encoded === encodedPng ? "png" : "jpeg"};base64,${encoded.toString("base64")}`,
    width: size.width,
    height: size.height,
    sourceWidth,
    sourceHeight,
  };
}

export function upright(image: NativeImage, orientation: number): NativeImage {
  const storedPixel = STORED_PIXEL[orientation];
  if (!storedPixel) return image;
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  const stored = new Uint32Array(bitmap.buffer.slice(bitmap.byteOffset, bitmap.byteOffset + bitmap.byteLength));
  const outWidth = orientation >= 5 ? height : width;
  const outHeight = orientation >= 5 ? width : height;
  const pixels = new Uint32Array(stored.length);
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const [storedX, storedY] = storedPixel(x, y, width, height);
      pixels[y * outWidth + x] = stored[storedY * width + storedX] ?? 0;
    }
  }
  return nativeImage.createFromBitmap(Buffer.from(pixels.buffer), { width: outWidth, height: outHeight });
}

export function jpegFacts(file: Buffer): { orientation: number; pixels: number } {
  let orientation = 1;
  let pixels = 0;
  let offset = 2;
  while (offset + 4 <= file.length) {
    const marker = file[offset + 1] ?? 0;
    if (file[offset] !== 0xff || marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) break;
    const end = Math.min(file.length, offset + 2 + file.readUInt16BE(offset + 2));
    const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (frame && offset + 9 <= end)
      pixels = Math.max(pixels, file.readUInt16BE(offset + 5) * file.readUInt16BE(offset + 7));
    if (marker === 0xe1 && file.toString("latin1", offset + 4, offset + 10) === "Exif\0\0") {
      orientation = exifOrientation(file, offset + 10, end);
    }
    offset = end;
  }
  return { orientation, pixels };
}

function exifOrientation(file: Buffer, tiff: number, end: number): number {
  if (tiff + 8 > end) return 1;
  const little = file.toString("latin1", tiff, tiff + 2) === "II";
  const u16 = (at: number) => (little ? file.readUInt16LE(at) : file.readUInt16BE(at));
  const directory = tiff + (little ? file.readUInt32LE(tiff + 4) : file.readUInt32BE(tiff + 4));
  if (directory + 2 > end) return 1;
  for (let entry = directory + 2, left = u16(directory); left > 0 && entry + 12 <= end; left--, entry += 12) {
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return 1;
}
