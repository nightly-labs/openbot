import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { loadPhotoQualityPreference, usePhotoQualityPreference } from "@/features/settings/model/photo-quality";

const PHOTO_LONG_EDGE = 2048;
const PHOTO_QUALITY = 0.8;
const CONVERTED_PHOTO_QUALITY = 0.9;
const SMALL_PHOTO_BYTES = 1024 * 1024;

export async function smallerPhoto(uri: string, name: string): Promise<{ uri: string; name: string }> {
  const original = { uri, name };
  if (!/\.(jpe?g|heic|heif)$/iu.test(name)) return original;
  await loadPhotoQualityPreference().catch(() => undefined);
  if (usePhotoQualityPreference.getState().fullQuality) return original;
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

export async function jpegPhoto(uri: string, name: string): Promise<{ uri: string; name: string }> {
  const natives = new Set<{ release(): void }>();
  try {
    const decode = ImageManipulator.manipulate(uri);
    natives.add(decode);
    const image = await decode.renderAsync();
    natives.add(image);
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: CONVERTED_PHOTO_QUALITY });
    return { uri: saved.uri, name: `${name.replace(/\.(heic|heif)$/iu, "")}.jpg` };
  } finally {
    for (const native of natives) native.release();
  }
}
