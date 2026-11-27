import { createSignal, flush } from "solid-js";

let focused: (() => boolean) | undefined;

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
