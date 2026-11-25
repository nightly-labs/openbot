import { createContext, createEffect, useContext } from "solid-js";

export type BrowserPageMenu = () => Element | undefined;

export type CoverBrowserPage = (menu?: BrowserPageMenu) => () => void;

export const BrowserPageCover = createContext<CoverBrowserPage>();

export function useBrowserPageCover(open: () => boolean, menu?: BrowserPageMenu): void {
  const cover = useContext(BrowserPageCover);
  createEffect(open, (covered) => (covered ? cover?.(menu) : undefined));
}

export function menuCoversPage(surface: Element, menu: BrowserPageMenu | undefined): boolean {
  if (!menu) return true;
  const content = menu();
  const positioner = content?.closest("[data-popper-positioner]");
  if (!content || !(positioner instanceof HTMLElement) || positioner.style.transform === "") return false;
  const page = surface.getBoundingClientRect();
  const box = content.getBoundingClientRect();
  return box.left < page.right && page.left < box.right && box.top < page.bottom && page.top < box.bottom;
}
