import * as Clipboard from "expo-clipboard";
import { haptics } from "@/shared/lib/haptics";

export async function readClipboardText(): Promise<string> {
  const text = (await Clipboard.getStringAsync()).trim();
  if (text) return text;
  return ((await Clipboard.getUrlAsync()) ?? "").trim();
}

export function copyWithHaptic(text: string): void {
  void Clipboard.setStringAsync(text).then(() => haptics.notification());
}
