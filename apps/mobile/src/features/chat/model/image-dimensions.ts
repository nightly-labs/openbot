import { base64ToBytes } from "@openbot/team-client/base64";

export interface ImageDimensions {
  width: number;
  height: number;
}

const HEADER_BASE64_LENGTH = 96 * 1024;

export function imageDimensions(base64: string): ImageDimensions | null {
  const bytes = decodePrefix(base64);
  if (!bytes) return null;
  const size = png(bytes) ?? gif(bytes) ?? webp(bytes) ?? jpeg(bytes);
  return size && size.width > 0 && size.height > 0 ? size : null;
}

function decodePrefix(base64: string): Uint8Array | null {
  const prefix = base64.slice(0, HEADER_BASE64_LENGTH);
  try {
    return base64ToBytes(prefix.slice(0, prefix.length - (prefix.length % 4)));
  } catch {
    return null;
  }
}

function byte(bytes: Uint8Array, offset: number) {
  return bytes[offset] ?? 0;
}
function u16be(bytes: Uint8Array, offset: number) {
  return (byte(bytes, offset) << 8) | byte(bytes, offset + 1);
}
function u16le(bytes: Uint8Array, offset: number) {
  return byte(bytes, offset) | (byte(bytes, offset + 1) << 8);
}
function u24le(bytes: Uint8Array, offset: number) {
  return byte(bytes, offset) | (byte(bytes, offset + 1) << 8) | (byte(bytes, offset + 2) << 16);
}
function u32be(bytes: Uint8Array, offset: number) {
  return (
    ((byte(bytes, offset) << 24) >>> 0) +
    ((byte(bytes, offset + 1) << 16) | (byte(bytes, offset + 2) << 8) | byte(bytes, offset + 3))
  );
}
function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function png(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24 || u32be(bytes, 0) !== 0x89504e47 || ascii(bytes, 12, 4) !== "IHDR") return null;
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

function gif(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 10 || ascii(bytes, 0, 4) !== "GIF8") return null;
  return { width: u16le(bytes, 6), height: u16le(bytes, 8) };
}

function webp(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
  if (chunk === "VP8 ") return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = u24le(bytes, 21) | (byte(bytes, 24) << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

function jpeg(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let orientation = 1;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = byte(bytes, offset + 1);
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = u16be(bytes, offset + 2);
    if (length < 2) return null;
    if (marker === 0xe1) orientation = exifOrientation(bytes, offset + 4, length - 2) ?? orientation;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 > bytes.length) return null;
      const height = u16be(bytes, offset + 5);
      const width = u16be(bytes, offset + 7);
      return orientation >= 5 ? { width: height, height: width } : { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

function exifOrientation(bytes: Uint8Array, start: number, length: number): number | null {
  if (start + 14 > bytes.length || ascii(bytes, start, 6) !== "Exif\0\0") return null;
  const tiff = start + 6;
  const little = ascii(bytes, tiff, 2) === "II";
  const read16 = (offset: number) => (little ? u16le(bytes, offset) : u16be(bytes, offset));
  const read32 = (offset: number) =>
    little ? (u16le(bytes, offset) + u16le(bytes, offset + 2) * 0x10000) >>> 0 : u32be(bytes, offset);
  const directory = tiff + read32(tiff + 4);
  const end = Math.min(bytes.length, start + length);
  if (directory + 2 > end) return null;
  const entries = read16(directory);
  for (let index = 0; index < entries; index += 1) {
    const entry = directory + 2 + index * 12;
    if (entry + 12 > end) return null;
    if (read16(entry) === 0x0112) {
      const value = read16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

export function sameShape(left: ImageDimensions, right: ImageDimensions) {
  return Math.abs(left.width / left.height - right.width / right.height) < 0.01;
}
