import { prefersReducedMotion } from "@openbot/ui/utils";
import { onCleanup } from "solid-js";

/** The input row is 28px with one line of text and 48px with two. */
const ONE_ROW_MAX_PX = 40;

/**
 * A one-row input outside the main chat (dock chat, diagram chat, side question, side thread, Tasks).
 * A draft with more than one line gets card corners (`data-multiline`), as the main message input
 * does, and the input moves to its new height on the curve of the main input
 * (`data-rows-resizing`). A different `key` shows its draft at once.
 */
export function createComposerRowsResize(key?: () => string) {
  let form: HTMLElement | undefined;
  let paintedHeight = 0;
  let paintedKey: string | undefined;
  let animation: Animation | undefined;

  const rows = new ResizeObserver(([entry]) => {
    const element = form;
    if (!entry || !element) return;
    const from = animation ? element.getBoundingClientRect().height : paintedHeight;
    animation?.cancel();
    animation = undefined;
    element.removeAttribute("data-rows-resizing");
    element.toggleAttribute("data-multiline", entry.contentRect.height > ONE_ROW_MAX_PX);
    const to = element.getBoundingClientRect().height;
    const nextKey = key?.();
    const sameKey = paintedKey === nextKey;
    paintedHeight = to;
    paintedKey = nextKey;
    // A hidden panel has no height: its next draft shows at once.
    if (!sameKey || from <= 0 || to <= 0 || Math.abs(to - from) < 1 || prefersReducedMotion()) return;
    const style = getComputedStyle(element);
    const current = element.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: Number.parseFloat(style.getPropertyValue("--composer-resize-duration")) || 300,
      easing: style.getPropertyValue("--composer-resize-ease").trim() || "ease-out",
    });
    animation = current;
    element.setAttribute("data-rows-resizing", "");
    current.addEventListener("finish", () => {
      if (animation !== current) return;
      animation = undefined;
      element.removeAttribute("data-rows-resizing");
    });
  });

  onCleanup(() => {
    rows.disconnect();
    animation?.cancel();
  });

  return {
    /** The `.composer` form. */
    form(element: HTMLElement) {
      form = element;
    },
    /** The `.composer-input-label` that holds the editor. */
    label(element: HTMLElement) {
      rows.disconnect();
      rows.observe(element);
    },
  };
}
