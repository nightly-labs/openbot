import type { WorkflowMediaSize } from "@openbot/contracts/ipc";
import { nativeImage } from "electron";

/**
 * The picture of an image step with a custom size (`workflows-media-size-v1`): the centre of the
 * picture cropped to the shape of `size`, then scaled to exactly `size`, as a PNG. Null when Skia
 * cannot decode the file: Electron decodes PNG and JPEG only, so a WebP file keeps the model's size.
 * The decode is synchronous, as for `clearPictureBackground`.
 */
export function sizeWorkflowPicture(bytes: Uint8Array, size: WorkflowMediaSize): Uint8Array | null {
  const picture = nativeImage.createFromBuffer(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  if (picture.isEmpty()) return null;
  const { width, height } = picture.getSize();
  if (width < 1 || height < 1) return null;
  const shape = size.width / size.height;
  const crop =
    width / height > shape
      ? { width: Math.max(1, Math.round(height * shape)), height }
      : { width, height: Math.max(1, Math.round(width / shape)) };
  const cropped = picture.crop({
    x: Math.floor((width - crop.width) / 2),
    y: Math.floor((height - crop.height) / 2),
    width: crop.width,
    height: crop.height,
  });
  const sized = cropped.resize({ width: size.width, height: size.height, quality: "best" });
  return sized.isEmpty() ? null : sized.toPNG();
}
