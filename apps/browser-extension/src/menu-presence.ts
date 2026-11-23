import { createEffect, createSignal } from "solid-js";

/** The exit of a menu (`.ext-menu[data-closing]` in `extension.css`), as the phone app's menu closes. */
const MENU_EXIT_MS = 150;

/**
 * Keeps a menu on screen while it plays its exit. `mounted` renders the menu; `closing` marks the
 * exit, which ends after `MENU_EXIT_MS`. With reduced motion the menu goes at once.
 */
export function createMenuPresence(open: () => boolean) {
  const [mounted, setMounted] = createSignal(false);
  createEffect(open, (isOpen) => {
    if (isOpen) {
      setMounted(true);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMounted(false);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), MENU_EXIT_MS);
    return () => window.clearTimeout(timer);
  });
  return { mounted, closing: () => mounted() && !open() };
}
