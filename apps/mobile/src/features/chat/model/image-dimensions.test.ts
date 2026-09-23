import { describe, expect, it } from "vitest";
import { imageDimensions } from "./image-dimensions";

function encode(bytes: number[]) {
  return btoa(String.fromCharCode(...bytes));
}
const text = (value: string) => [...value].map((character) => character.charCodeAt(0));
const be16 = (value: number) => [value >> 8, value & 0xff];
const be32 = (value: number) => [(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
const le16 = (value: number) => [value & 0xff, value >> 8];
const le24 = (value: number) => [value & 0xff, (value >> 8) & 0xff, value >> 16];

function jpeg(width: number, height: number, orientation?: number) {
  const exif = orientation
    ? [
        0xff,
        0xe1,
        ...be16(2 + 6 + 8 + 2 + 12 + 4),
        ...text("Exif\0\0"),
        ...text("MM"),
        ...be16(42),
        ...be32(8),
        ...be16(1),
        ...be16(0x0112),
        ...be16(3),
        ...be32(1),
        ...be16(orientation),
        0,
        0,
        ...be32(0),
      ]
    : [];
  // A quantization table before the frame, as a real encoder writes it.
  const table = [0xff, 0xdb, ...be16(4), 0, 0];
  const frame = [0xff, 0xc0, ...be16(11), 8, ...be16(height), ...be16(width), 1, 1, 0x11, 0];
  return encode([0xff, 0xd8, ...exif, ...table, ...frame]);
}

describe("image dimensions from the file header", () => {
  it("reads PNG, GIF, and WebP sizes", () => {
    const png = [0x89, ...text("PNG\r\n\x1a\n"), ...be32(13), ...text("IHDR"), ...be32(1600), ...be32(900), 8, 6, 0, 0];
    expect(imageDimensions(encode(png))).toEqual({ width: 1600, height: 900 });
    expect(imageDimensions(encode([...text("GIF89a"), ...le16(64), ...le16(32), 0, 0]))).toEqual({
      width: 64,
      height: 32,
    });
    const webp = [...text("RIFF"), 0, 0, 0, 0, ...text("WEBPVP8X"), 10, 0, 0, 0, 0, 0, 0, 0];
    expect(imageDimensions(encode([...webp, ...le24(1023), ...le24(767)]))).toEqual({ width: 1024, height: 768 });
  });

  it("reads a JPEG frame after other segments and turns it by its EXIF orientation", () => {
    expect(imageDimensions(jpeg(4032, 3024))).toEqual({ width: 4032, height: 3024 });
    expect(imageDimensions(jpeg(4032, 3024, 1))).toEqual({ width: 4032, height: 3024 });
    // A portrait phone photo stores landscape pixels and a quarter turn.
    expect(imageDimensions(jpeg(4032, 3024, 6))).toEqual({ width: 3024, height: 4032 });
  });

  it("returns null for a format it cannot read, so the caller waits for the decoder", () => {
    expect(imageDimensions(btoa("hello world, not an image"))).toBeNull();
    expect(imageDimensions("")).toBeNull();
    expect(imageDimensions("%%%%")).toBeNull();
  });
});
