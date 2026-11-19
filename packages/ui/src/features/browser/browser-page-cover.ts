import { createContext, createEffect, useContext } from "solid-js";

export const BrowserPageCover = createContext<() => () => void>();

export function useBrowserPageCover(open: () => boolean): void {
  const cover = useContext(BrowserPageCover);
  createEffect(open, (covered) => (covered ? cover() : undefined));
}
