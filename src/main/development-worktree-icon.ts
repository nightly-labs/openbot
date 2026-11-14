import { type NativeImage, nativeImage } from "electron";

/** The green channel of the gold dev icon body, `--openbot-logo-dev` (#e3b866). */
const DEV_ICON_BODY_GREEN = 0xb8;

/**
 * The dev icon in the color of this worktree (`developmentWorktreeColor`). The dev icon is flat: a
 * gold body and near-black eyes. Each pixel takes the worktree color, scaled by its green channel
 * against the gold body, so the eyes stay dark and the edges stay smooth. The scale is linear, so the
 * result is the same for premultiplied and straight alpha.
 */
export function tintDevelopmentIcon(icon: NativeImage, color: string): NativeImage {
  const size = icon.getSize();
  const pixels = Buffer.from(icon.toBitmap());
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  // Chromium bitmaps are BGRA on macOS and Windows, and on little-endian Linux.
  for (let index = 0; index < pixels.length; index += 4) {
    const scale = (pixels[index + 1] ?? 0) / DEV_ICON_BODY_GREEN;
    pixels[index] = Math.min(255, Math.round(blue * scale));
    pixels[index + 1] = Math.min(255, Math.round(green * scale));
    pixels[index + 2] = Math.min(255, Math.round(red * scale));
  }
  return nativeImage.createFromBitmap(pixels, { width: size.width, height: size.height });
}
