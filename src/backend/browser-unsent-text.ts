import type { WebContents } from "electron";

const USER_EDITS_WORLD = 1_020;

const HELD_TEXT_FUNCTION = `(element) => {
  const role = element.getAttribute("role") ?? "";
  if (role === "searchbox" || role === "combobox" || element.closest("[role=search], search")) return false;
  const text = element.isContentEditable
    ? element.textContent
    : element.localName === "textarea" || (element.localName === "input" && /^(?:text|email|url|tel|number)$/.test(element.type))
      ? element.value
      : "";
  return typeof text === "string" && text.replace(/[\\s\\u200b\\ufeff]/g, "") !== "";
}`;

const WATCH_EDITS_SCRIPT = `(() => {
  if (globalThis.openbotUserEdits) return;
  const edited = new Set();
  globalThis.openbotUserEdits = edited;
  addEventListener("input", (event) => {
    if (event.isTrusted) edited.add(event.composedPath()[0]);
  }, true);
  addEventListener("keydown", (event) => {
    const target = event.composedPath()[0];
    if (event.isTrusted && event.key === "Enter" && target?.localName === "input") edited.delete(target);
  }, true);
  addEventListener("submit", (event) => {
    for (const element of edited) if (event.target.contains(element)) edited.delete(element);
  }, true);
})()`;

const EDITED_TEXT_SCRIPT = `(() => {
  const heldText = ${HELD_TEXT_FUNCTION};
  const edited = globalThis.openbotUserEdits;
  if (!edited) return false;
  for (const element of edited) {
    if (!element.isConnected) {
      edited.delete(element);
      continue;
    }
    if (heldText(element)) return true;
  }
  return false;
})()`;

const FRAME_TEXT_SCRIPT = `(() => {
  const heldText = ${HELD_TEXT_FUNCTION};
  for (const element of document.querySelectorAll("input, textarea")) {
    if (element.value !== element.defaultValue && heldText(element)) return true;
  }
  return document.body !== null && (document.designMode === "on" || document.body.isContentEditable) && heldText(document.body);
})()`;

export function watchUserEdits(contents: WebContents): void {
  if (contents.isDestroyed()) return;
  void contents
    .executeJavaScriptInIsolatedWorld(USER_EDITS_WORLD, [{ code: WATCH_EDITS_SCRIPT }])
    .catch(() => undefined);
}

export async function pageHoldsUnsentText(contents: WebContents): Promise<boolean> {
  if (contents.isDestroyed() || contents.mainFrame.isDestroyed()) return false;
  const mainFrame = contents.mainFrame;
  const answers = await Promise.all([
    contents.executeJavaScriptInIsolatedWorld(USER_EDITS_WORLD, [{ code: EDITED_TEXT_SCRIPT }]).then(
      (held) => held === true,
      () => false,
    ),
    ...mainFrame.framesInSubtree.map((frame) =>
      frame === mainFrame || frame.isDestroyed()
        ? false
        : frame.executeJavaScript(FRAME_TEXT_SCRIPT).then(
            (held) => held === true,
            () => false,
          ),
    ),
  ]);
  return answers.includes(true);
}
