import type { WebContents, WebFrameMain } from "electron";

const EDITS_KEY = `Symbol.for("openbot.userEdits")`;

const WATCH_EDITS_SCRIPT = `(() => {
  const key = ${EDITS_KEY};
  if (globalThis[key]) return;
  const edited = new Set();
  Object.defineProperty(globalThis, key, { value: edited });
  addEventListener("input", (event) => {
    if (event.isTrusted) edited.add(event.composedPath()[0]);
  }, true);
})()`;

const HOLDS_UNSENT_TEXT_SCRIPT = `(() => {
  const edited = globalThis[${EDITS_KEY}];
  if (!edited) return false;
  const textField = /^(?:text|search|email|url|tel|number)$/;
  for (const element of edited) {
    if (!element.isConnected) {
      edited.delete(element);
      continue;
    }
    const text = element.isContentEditable
      ? element.textContent
      : element.localName === "textarea" || (element.localName === "input" && textField.test(element.type))
        ? element.value
        : "";
    if (typeof text === "string" && text.trim() !== "") return true;
  }
  return false;
})()`;

export function watchUserEdits(frame: WebFrameMain | null | undefined): void {
  if (!frame || frame.isDestroyed()) return;
  void frame.executeJavaScript(WATCH_EDITS_SCRIPT).catch(() => undefined);
}

export async function pageHoldsUnsentText(contents: WebContents): Promise<boolean> {
  if (contents.isDestroyed() || contents.mainFrame.isDestroyed()) return false;
  const frames = await Promise.all(
    contents.mainFrame.framesInSubtree.map((frame) =>
      frame.isDestroyed()
        ? false
        : frame.executeJavaScript(HOLDS_UNSENT_TEXT_SCRIPT).then(
            (held) => held === true,
            () => false,
          ),
    ),
  );
  return frames.includes(true);
}
