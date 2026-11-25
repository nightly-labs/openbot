import { createSignal, untrack } from "solid-js";

const TOAST_EDGE_OFFSET = 24;

const [heldPages, setHeldPages] = createSignal(0);
const [pageInsets, setPageInsets] = createSignal<ReadonlyMap<symbol, number>>(new Map());

export const nativeBrowserPageShown = () => heldPages() > 0;

export const nativeBrowserPageToastOffset = () => ({
  right: TOAST_EDGE_OFFSET + Math.max(0, ...pageInsets().values()),
});

export function holdNativeBrowserPage(): () => void {
  setHeldPages((count) => count + 1);
  return () => setHeldPages((count) => count - 1);
}

export function reserveNativeBrowserPageInset() {
  const owner = Symbol("native-browser-page-inset");
  return {
    update(inset: number) {
      if (untrack(pageInsets).get(owner) === inset) return;
      setPageInsets((current) => new Map(current).set(owner, inset));
    },
    release() {
      setPageInsets((current) => {
        const next = new Map(current);
        next.delete(owner);
        return next;
      });
    },
  };
}
