import type { File } from "expo-file-system";
import { isAndroid } from "@/shared/lib/platform";

/**
 * The file as base64. Expo Go on Android lets the file API read only its own folders, and a picker
 * can return a file outside them. On Android, React Native then reads the same file.
 */
export async function readFileBase64(file: File): Promise<string> {
  try {
    return await file.base64();
  } catch (error) {
    if (!isAndroid) throw error;
    const blob = await (await fetch(file.uri)).blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? error);
      reader.readAsDataURL(blob);
    });
    return dataUrl.slice(dataUrl.indexOf(",") + 1);
  }
}
