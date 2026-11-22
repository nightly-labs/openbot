import { createSignal } from "solid-js";

export const NO_BLUR_ATTRIBUTE = "data-openbot-no-blur";

export const STILL_FACES_ATTRIBUTE = "data-openbot-still-faces";

function read(): boolean {
  return document.documentElement.hasAttribute(STILL_FACES_ATTRIBUTE);
}

let stillFaces: (() => boolean) | undefined;

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
