import * as Clipboard from "expo-clipboard";

export async function readClipboardText(): Promise<string> {
  const text = (await Clipboard.getStringAsync()).trim();
  if (text) return text;
  return ((await Clipboard.getUrlAsync()) ?? "").trim();
}
