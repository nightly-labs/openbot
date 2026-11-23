import { createEffect, createSignal } from "solid-js";

const MENU_EXIT_MS = 150;

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
