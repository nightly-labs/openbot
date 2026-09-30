/**
 * Writes one app icon for each logo color in `build/logo-colors/`, from the release icons.
 *
 * macOS has no alternate app icon API (`setAlternateIconName` is UIKit only), so the app sets the
 * Dock icon from one of these files while it runs. The files are committed: a designer can replace
 * one by hand, and this script is only the first draft of each color.
 *
 * Each pixel is placed on the line from the eye color to the lavender body color, and the new pixel
 * takes the same place on the line from the new eye color to the new body color. The eyes and the
 * antialiased edges keep their shape, and only the body and eye colors change.
 *
 * The release icons are 8-bit RGBA PNG files with no interlace, so the script reads and writes PNG
 * with `node:zlib` and needs no image library.
 *
 * Run with `bun scripts/generate-logo-color-icons.ts`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import {
  APP_LOGO_COLOR_HEX,
  APP_LOGO_COLORS,
  APP_LOGO_EYE_HEX,
  DEFAULT_APP_LOGO_COLOR,
  DEFAULT_APP_LOGO_EYE_HEX,
} from "@openbot/contracts/app-logo-color";
import { createOpenBotLogger } from "@openbot/logging";

type Rgb = readonly [number, number, number];

interface RgbaImage {
  width: number;
  height: number;
  pixels: Buffer;
}

const SOURCES = ["icon-production.png", "icon-production-macos-safe-area.png"] as const;
const BUILD = resolve(import.meta.dirname, "../build");
const OUTPUT = join(BUILD, "logo-colors");
const logger = createOpenBotLogger("generate-logo-color-icons");
/** The logo eyes in `build/icon-production*.png`, `--openbot-logo-eye`. */
const ICON_EYE = hexToRgb(DEFAULT_APP_LOGO_EYE_HEX);

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Reads an 8-bit RGBA PNG with no interlace. Any other format stops the script. */
function decodePng(file: Buffer): RgbaImage {
  if (!file.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("The file is not a PNG.");
  let width = 0;
  let height = 0;
  const data: Buffer[] = [];
  for (let offset = 8; offset < file.length; ) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("latin1", offset + 4, offset + 8);
    const body = file.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) {
        throw new Error("The icon must be an 8-bit RGBA PNG with no interlace.");
      }
    } else if (type === "IDAT") data.push(body);
    offset += 12 + length;
  }
  const rows = inflateSync(Buffer.concat(data));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = rows[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const raw = rows[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= 4 ? (pixels[y * stride + x - 4] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = x >= 4 && y > 0 ? (pixels[(y - 1) * stride + x - 4] ?? 0) : 0;
      pixels[y * stride + x] = (raw + unfilter(filter, left, up, upLeft)) & 255;
    }
  }
  return { width, height, pixels };
}

function unfilter(filter: number | undefined, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return Math.floor((left + up) / 2);
    case 4: {
      const estimate = left + up - upLeft;
      const toLeft = Math.abs(estimate - left);
      const toUp = Math.abs(estimate - up);
      const toUpLeft = Math.abs(estimate - upLeft);
      if (toLeft <= toUp && toLeft <= toUpLeft) return left;
      return toUp <= toUpLeft ? up : upLeft;
    }
    default:
      throw new Error(`Unknown PNG filter ${filter}.`);
  }
}

/** Writes an 8-bit RGBA PNG. Each row uses the "up" filter, which suits the flat icon colors. */
function encodePng(image: RgbaImage): Buffer {
  const stride = image.width * 4;
  const rows = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    rows[y * (stride + 1)] = 2;
    for (let x = 0; x < stride; x += 1) {
      const up = y > 0 ? (image.pixels[(y - 1) * stride + x] ?? 0) : 0;
      rows[y * (stride + 1) + 1 + x] = ((image.pixels[y * stride + x] ?? 0) - up) & 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, body: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + body.length);
  chunk.writeUInt32BE(body.length, 0);
  chunk.write(type, 4, "latin1");
  body.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + body.length)), 8 + body.length);
  return chunk;
}

function recolor(pixels: Buffer, source: Rgb, target: Rgb, targetEye: Rgb): Buffer {
  const result = Buffer.from(pixels);
  const axis = [0, 1, 2].map((channel) => (source[channel] ?? 0) - (ICON_EYE[channel] ?? 0));
  const axisLength = axis.reduce((sum, value) => sum + value ** 2, 0);
  for (let offset = 0; offset + 3 < result.length; offset += 4) {
    if (result[offset + 3] === 0) continue;
    let along = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      along += ((result[offset + channel] ?? 0) - (ICON_EYE[channel] ?? 0)) * (axis[channel] ?? 0);
    }
    const position = Math.min(1, Math.max(0, along / axisLength));
    for (let channel = 0; channel < 3; channel += 1) {
      const eye = targetEye[channel] ?? 0;
      result[offset + channel] = Math.round(eye + position * ((target[channel] ?? 0) - eye));
    }
  }
  return result;
}

await mkdir(OUTPUT, { recursive: true });
const source = hexToRgb(APP_LOGO_COLOR_HEX[DEFAULT_APP_LOGO_COLOR]);
for (const file of SOURCES) {
  const image = decodePng(await readFile(join(BUILD, file)));
  for (const color of APP_LOGO_COLORS) {
    if (color === DEFAULT_APP_LOGO_COLOR) continue;
    const name = file.replace("production", color);
    const pixels = recolor(
      image.pixels,
      source,
      hexToRgb(APP_LOGO_COLOR_HEX[color]),
      hexToRgb(APP_LOGO_EYE_HEX[color]),
    );
    await writeFile(join(OUTPUT, name), encodePng({ ...image, pixels }));
    logger.info(`Wrote build/logo-colors/${name}`);
  }
}
