import { createSignal } from "solid-js";

const [heldPages, setHeldPages] = createSignal(0);

export const nativeBrowserPageShown = () => heldPages() > 0;

export function holdNativeBrowserPage(): () => void {
  setHeldPages((count) => count + 1);
  return () => setHeldPages((count) => count - 1);
}
