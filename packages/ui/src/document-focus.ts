import { createSignal, flush } from "solid-js";

let focused: (() => boolean) | undefined;

/**
 * Whether this document's window has the focus. Decoration that keeps moving, such as an avatar that
 * moves with no hover, runs only while the user works in this window: a window left open beside
 * another app then draws no frames. A server render has no window and draws nothing.
 */
export function documentFocused(): boolean {
  if (typeof window === "undefined") return false;
  if (!focused) {
    const [current, setCurrent] = createSignal(document.hasFocus());
    window.addEventListener("focus", () => flush(() => setCurrent(true)));
    window.addEventListener("blur", () => flush(() => setCurrent(false)));
    focused = current;
  }
  return focused();
}
