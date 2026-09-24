/**
 * Writes text to the clipboard. A window without the async clipboard, or one that refuses it, uses
 * a hidden text area and the copy command. Throws when both fail.
 */
export async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
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
