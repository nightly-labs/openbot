import { prefersReducedMotion } from "@openbot/ui/utils";
import { onCleanup } from "solid-js";

const ONE_ROW_MAX_PX = 40;

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
    form(element: HTMLElement) {
      form = element;
    },
    label(element: HTMLElement) {
      rows.disconnect();
      rows.observe(element);
    },
  };
}
