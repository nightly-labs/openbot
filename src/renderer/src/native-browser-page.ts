import { createSignal } from "solid-js";

/**
 * The page of a local browser tab is a native view above this window, so it covers what the window
 * draws there, toasts too. Each conversation that shows such a page in the full view holds it here.
 */
const [heldPages, setHeldPages] = createSignal(0);

export const nativeBrowserPageShown = () => heldPages() > 0;

/** Marks a native page as shown. The returned function marks it as hidden again. */
export function holdNativeBrowserPage(): () => void {
  setHeldPages((count) => count + 1);
  return () => setHeldPages((count) => count - 1);
}
