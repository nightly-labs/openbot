import { AVATAR_IMAGE_LIMITS } from "@openbot/contracts/input-limits";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import type { Href } from "expo-router";
import { requestAvatarCrop } from "@/shared/lib/avatar-crop-request";
import { currentText } from "@/shared/lib/text";

const OUTPUT_SIZES = [512, 448, 384, 320] as const;
const OUTPUT_QUALITIES = [0.88, 0.82, 0.76, 0.7] as const;

export interface AvatarPhoto {
  uri: string;
  name: string;
  mimeType: "image/jpeg";
  bytes: Uint8Array;
  base64: string;
}

/**
 * Opens the photo library, then the crop screen at `cropRoute`, and returns a square JPEG avatar,
 * or null when the user cancels. `allowsEditing` would open the slow legacy iOS picker, so the
 * app shows its own crop screen.
 */
export async function pickAvatarPhoto(cropRoute: Href): Promise<AvatarPhoto | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"] });
  if (result.canceled) return null;
  const [asset] = result.assets;
  if (!asset) throw new Error(currentText().t("mobile.shared.photo.openFailed"));
  const source = await ImageManipulator.manipulate(asset.uri).renderAsync();
  const crop = await requestAvatarCrop({ uri: asset.uri, width: source.width, height: source.height }, cropRoute);
  if (!crop) return null;
  for (const [index, outputSize] of OUTPUT_SIZES.entries()) {
    const image = await ImageManipulator.manipulate(source)
      .crop(crop)
      .resize({ width: Math.min(crop.width, outputSize), height: Math.min(crop.width, outputSize) })
      .renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: OUTPUT_QUALITIES[index] ?? 0.7 });
    const file = new File(saved.uri);
    if (file.size <= AVATAR_IMAGE_LIMITS.storedBytes)
      return {
        uri: saved.uri,
        name: file.name,
        mimeType: "image/jpeg",
        bytes: await file.bytes(),
        base64: await file.base64(),
      };
  }
  throw new Error(currentText().t("mobile.shared.photo.tooLarge"));
}
