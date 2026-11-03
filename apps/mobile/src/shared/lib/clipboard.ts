import * as Clipboard from "expo-clipboard";

/**
 * The text on the clipboard, trimmed. A browser can copy an address as a link with no text, so a
 * link is read when there is no text.
 */
export async function readClipboardText(): Promise<string> {
  const text = (await Clipboard.getStringAsync()).trim();
  if (text) return text;
  return ((await Clipboard.getUrlAsync()) ?? "").trim();
}
