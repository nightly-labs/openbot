import { type NativeImage, nativeImage } from "electron";

const DEV_ICON_BODY_GREEN = 0xb8;

export function tintDevelopmentIcon(icon: NativeImage, color: string): NativeImage {
  const size = icon.getSize();
  const pixels = Buffer.from(icon.toBitmap());
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  for (let index = 0; index < pixels.length; index += 4) {
    const scale = (pixels[index + 1] ?? 0) / DEV_ICON_BODY_GREEN;
    const alpha = pixels[index + 3] ?? 0;
    pixels[index] = Math.min(alpha, Math.round(blue * scale));
    pixels[index + 1] = Math.min(alpha, Math.round(green * scale));
    pixels[index + 2] = Math.min(alpha, Math.round(red * scale));
  }
  return nativeImage.createFromBitmap(pixels, { width: size.width, height: size.height });
}
