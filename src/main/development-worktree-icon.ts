import { type NativeImage, nativeImage } from "electron";

/** The green channel of the gold dev icon body, `--openbot-logo-dev` (#e3b866). */
const DEV_ICON_BODY_GREEN = 0xb8;

/**
 * The dev icon in the color of this worktree (`developmentWorktreeColor`). The dev icon is flat: a
 * gold body and near-black eyes. Each pixel takes the worktree color, scaled by its green channel
 * against the gold body, so the eyes stay dark and the edges stay smooth.
 */
export function tintDevelopmentIcon(icon: NativeImage, color: string): NativeImage {
  const size = icon.getSize();
  const pixels = Buffer.from(icon.toBitmap());
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  // Chromium bitmaps are premultiplied BGRA on macOS and Windows, and on little-endian Linux. A
  // premultiplied channel cannot be more than the alpha, so a light color on a highlight or an edge
  // pixel stops at the alpha.
  for (let index = 0; index < pixels.length; index += 4) {
    const scale = (pixels[index + 1] ?? 0) / DEV_ICON_BODY_GREEN;
    const alpha = pixels[index + 3] ?? 0;
    pixels[index] = Math.min(alpha, Math.round(blue * scale));
    pixels[index + 1] = Math.min(alpha, Math.round(green * scale));
    pixels[index + 2] = Math.min(alpha, Math.round(red * scale));
  }
  return nativeImage.createFromBitmap(pixels, { width: size.width, height: size.height });
}
