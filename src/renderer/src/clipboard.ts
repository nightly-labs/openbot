/**
 * Writes text to the clipboard. When the async clipboard is missing or refuses the write, such as
 * when the document has no focus, a hidden text area and the copy command are used. Throws when
 * both fail.
 */
export async function writeClipboardText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // The copy command below is the fallback.
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  try {
    input.select();
    if (!document.execCommand("copy")) throw new Error("Could not copy the text.");
  } finally {
    input.remove();
  }
}
