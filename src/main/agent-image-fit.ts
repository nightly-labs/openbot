import { type NativeImage, nativeImage } from "electron";
import type { FittedImage } from "../backend/agent/image-reader";

/** The longest side that `read_image` gives the model. Codex sends no more than 2048 px at high detail. */
const MAX_EDGE = 2048;
/**
 * The largest file that `read_image` keeps as it is. In Code Mode, Codex drops an image whose data URL
 * is over 8 MiB (#9522); base64 makes 4 MiB about 5.3 MiB.
 */
const MAX_KEPT_BYTES = 4 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** For each EXIF orientation, the stored pixel that an upright pixel shows. 5 to 8 swap the sides. */
const STORED_PIXEL: Record<number, (x: number, y: number, width: number, height: number) => [number, number]> = {
  2: (x, y, width) => [width - 1 - x, y],
  3: (x, y, width, height) => [width - 1 - x, height - 1 - y],
  4: (x, y, _width, height) => [x, height - 1 - y],
  5: (x, y) => [y, x],
  6: (x, y, _width, height) => [y, height - 1 - x],
  7: (x, y, width, height) => [width - 1 - y, height - 1 - x],
  8: (x, y, width) => [width - 1 - y, x],
};

/**
 * The picture of a PNG or JPEG file for `read_image`. A small file stays as it is. A larger one is made
 * no larger than `MAX_EDGE`, and turned upright: Electron does not apply the EXIF orientation that a
 * phone photo has, and the new file has no EXIF data.
 */
export function fitImageForAgent(bytes: Uint8Array): FittedImage | null {
  const file = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jpeg = file[0] === 0xff && file[1] === 0xd8;
  if (!jpeg && !file.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const source = nativeImage.createFromBuffer(file);
  if (source.isEmpty()) return null;
  const { width, height } = source.getSize();
  const orientation = jpeg ? exifOrientation(file) : 1;
  const turned = orientation >= 5 && orientation <= 8;
  const sourceWidth = turned ? height : width;
  const sourceHeight = turned ? width : height;
  if (Math.max(width, height) <= MAX_EDGE && file.length <= MAX_KEPT_BYTES) {
    const dataUrl = `data:image/${jpeg ? "jpeg" : "png"};base64,${file.toString("base64")}`;
    return { dataUrl, width: sourceWidth, height: sourceHeight, sourceWidth, sourceHeight };
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
  // A PNG keeps its transparency when it fits; a photo saved as PNG becomes a JPEG.
  const png = jpeg ? null : fitted.toPNG();
  const encoded = png && png.length <= MAX_KEPT_BYTES ? png : fitted.toJPEG(85);
  const size = fitted.getSize();
  return {
    dataUrl: `data:image/${encoded === png ? "png" : "jpeg"};base64,${encoded.toString("base64")}`,
    width: size.width,
    height: size.height,
    sourceWidth,
    sourceHeight,
  };
}

function upright(image: NativeImage, orientation: number): NativeImage {
  const storedPixel = STORED_PIXEL[orientation];
  if (!storedPixel) return image;
  const { width, height } = image.getSize();
  const stored = new Uint32Array(Uint8Array.from(image.toBitmap()).buffer);
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

/** The orientation tag of a JPEG file's EXIF data, or 1 (upright) when it has none. */
function exifOrientation(file: Buffer): number {
  let offset = 2;
  while (offset + 4 <= file.length && file[offset] === 0xff) {
    const marker = file[offset + 1];
    const end = Math.min(file.length, offset + 2 + file.readUInt16BE(offset + 2));
    // The image data starts at the start-of-scan marker, after all EXIF data.
    if (marker === 0xda) return 1;
    if (marker === 0xe1 && file.toString("latin1", offset + 4, offset + 10) === "Exif\0\0") {
      const tiff = offset + 10;
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
    offset = end;
  }
  return 1;
}
