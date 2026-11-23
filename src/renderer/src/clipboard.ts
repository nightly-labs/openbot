import { currentText } from "@openbot/ui/text";

export async function writeClipboardText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {}
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const host = previous?.closest<HTMLElement>("[role='dialog']") ?? document.body;
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  host.append(input);
  try {
    input.select();
    if (!document.execCommand("copy")) throw new Error(currentText().t("app.clipboard.copyFailed"));
  } finally {
    input.remove();
    previous?.focus({ preventScroll: true });
  }
}
