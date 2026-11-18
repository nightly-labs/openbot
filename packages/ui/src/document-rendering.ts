import { createSignal } from "solid-js";

/**
 * The root attribute when backdrop blur is off: by the Background blur setting, or by itself when the
 * window is drawn on the CPU. There a blur repaints all that is under it on each frame.
 * `primitives.css` then turns off each backdrop blur.
 */
export const NO_BLUR_ATTRIBUTE = "data-openbot-no-blur";

/**
 * The root attribute when agent faces stay still: by the Moving agent faces setting, or by itself
 * when the window is drawn on the CPU. There each frame of an animation is a repaint on the CPU.
 */
export const STILL_FACES_ATTRIBUTE = "data-openbot-still-faces";

function read(): boolean {
  return document.documentElement.hasAttribute(STILL_FACES_ATTRIBUTE);
}

let stillFaces: (() => boolean) | undefined;

/**
 * Whether agent faces stay still in this document, so code that keeps animating them, such as a
 * moving avatar or the falling crew of the loading screen, stops. The app sets the root attribute;
 * this only reads it, so the shared UI stays free of the app's settings. A server render has no
 * document and draws nothing.
 */
export function documentStillFaces(): boolean {
  if (typeof document === "undefined") return false;
  if (!stillFaces) {
    const [current, setCurrent] = createSignal(read());
    new MutationObserver(() => setCurrent(read())).observe(document.documentElement, {
      attributeFilter: [STILL_FACES_ATTRIBUTE],
    });
    stillFaces = current;
  }
  return stillFaces();
}
