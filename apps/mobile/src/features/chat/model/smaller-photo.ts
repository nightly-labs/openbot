import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { loadPhotoQualityPreference, usePhotoQualityPreference } from "@/features/settings/model/photo-quality";

/** The long edge of a sent photo. It keeps text in a photo of a document readable. */
const PHOTO_LONG_EDGE = 2048;
const PHOTO_QUALITY = 0.8;
/** A photo of this size or less goes as it is. */
const SMALL_PHOTO_BYTES = 1024 * 1024;

/**
 * A smaller JPEG copy of a photo, unless the user sends photos at full quality. A 12 MP photo of
 * 4–10 MB becomes about 0.3–0.8 MB, so it arrives on a slow relay path too (#8205). The copy has no
 * location or other metadata. Only JPEG and HEIC go through it: a PNG or GIF can have transparency
 * or frames. When the copy cannot be made, or is not smaller, the photo goes as it is.
 */
export async function smallerPhoto(uri: string, name: string): Promise<{ uri: string; name: string }> {
  const original = { uri, name };
  if (!/\.(jpe?g|heic|heif)$/iu.test(name)) return original;
  // The app reads the setting when it first comes to the foreground; a photo chosen before that waits for it.
  await loadPhotoQualityPreference().catch(() => undefined);
  if (usePhotoQualityPreference.getState().fullQuality) return original;
  // Native objects that hold decoded pixels. They are released at the end, not when the garbage collector runs.
  // A set: `resize` can return the same context.
  const natives = new Set<{ release(): void }>();
  try {
    const file = new File(uri);
    const size = file.exists ? file.size : null;
    if (size !== null && size <= SMALL_PHOTO_BYTES) return original;
    const decode = ImageManipulator.manipulate(uri);
    natives.add(decode);
    const source = await decode.renderAsync();
    natives.add(source);
    let image = source;
    if (Math.max(source.width, source.height) > PHOTO_LONG_EDGE) {
      const base = ImageManipulator.manipulate(source);
      natives.add(base);
      const context = base.resize(
        source.width >= source.height ? { width: PHOTO_LONG_EDGE } : { height: PHOTO_LONG_EDGE },
      );
      natives.add(context);
      image = await context.renderAsync();
      natives.add(image);
    }
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY });
    const copy = new File(saved.uri);
    if (size !== null && copy.size >= size) {
      copy.delete();
      return original;
    }
    return { uri: saved.uri, name: `${name.replace(/\.(jpe?g|heic|heif)$/iu, "")}.jpg` };
  } catch {
    return original;
  } finally {
    for (const native of natives) native.release();
  }
}
