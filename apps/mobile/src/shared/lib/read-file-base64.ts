import type { File } from "expo-file-system";
import { isAndroid } from "@/shared/lib/platform";

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
