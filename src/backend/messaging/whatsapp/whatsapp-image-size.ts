import { open } from "node:fs/promises";

/** The start of a file that holds the size of a PNG, a WebP, and a JPEG after its usual metadata. */
const HEADER_BYTES = 256 * 1024;

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * The width and height of a PNG, JPEG or WebP file, read from its header without decoding it, or null.
 * Baileys reads them only with an image library that OpenBot does not ship, and WhatsApp crops an
 * image without them in the chat. The size is as stored: a JPEG rotation in its EXIF data is not applied.
 */
export async function imageSize(path: string): Promise<ImageSize | null> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await file.read(buffer, 0, HEADER_BYTES, 0);
    const size = headerSize(buffer.subarray(0, bytesRead));
    return size && size.width > 0 && size.height > 0 ? size : null;
  } finally {
    await file.close();
  }
}

function headerSize(data: Buffer): ImageSize | null {
  if (data.length >= 24 && data.readUInt32BE(0) === 0x89504e47 && data.toString("latin1", 12, 16) === "IHDR")
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  if (data.length >= 30 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP")
    return webpSize(data);
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) return jpegSize(data);
  return null;
}

function webpSize(data: Buffer): ImageSize | null {
  const chunk = data.toString("latin1", 12, 16);
  if (chunk === "VP8 ") return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = data.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") return { width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 };
  return null;
}

/** The size in the first frame header (SOF0 to SOF15, without DHT, JPG and DAC), after the segments before it. */
function jpegSize(data: Buffer): ImageSize | null {
  let offset = 2;
  while (offset + 9 <= data.length) {
    if (data[offset] !== 0xff) return null;
    const marker = data[offset + 1] ?? 0;
    // Fill bytes, and the markers that have no length.
    if (marker === 0xff) offset += 1;
    else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) offset += 2;
    else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
    else offset += 2 + data.readUInt16BE(offset + 2);
  }
  return null;
}
