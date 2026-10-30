import { createContext, createEffect, useContext } from "solid-js";

/**
 * A local page is a native view above the window, so it would hide a menu that opens over it. Calling
 * the value covers the page, and the function it returns uncovers it.
 */
export const BrowserPageCover = createContext<() => () => void>();

/** Covers the page while `open` is true. A menu removed while it is open uncovers it with its owner. */
export function useBrowserPageCover(open: () => boolean): void {
  const cover = useContext(BrowserPageCover);
  createEffect(open, (covered) => (covered ? cover() : undefined));
}
