import { createSignal } from "solid-js";

/**
 * The root attribute that a desktop window sets when Chromium draws it on the CPU. `primitives.css`
 * then turns off each backdrop blur.
 */
export const SOFTWARE_RENDERING_ATTRIBUTE = "data-openbot-software-rendering";

function read(): boolean {
  return document.documentElement.hasAttribute(SOFTWARE_RENDERING_ATTRIBUTE);
}

let softwareRendering: (() => boolean) | undefined;

/**
 * Whether this document is drawn on the CPU. Each frame of an animation is then a repaint on the
 * CPU, so code that keeps animating, such as a moving avatar, stops. The app sets the root attribute;
 * this only reads it, so the shared UI stays free of the app's settings. A server render has no
 * document and draws nothing.
 */
export function documentSoftwareRendering(): boolean {
  if (typeof document === "undefined") return false;
  if (!softwareRendering) {
    const [current, setCurrent] = createSignal(read());
    new MutationObserver(() => setCurrent(read())).observe(document.documentElement, {
      attributeFilter: [SOFTWARE_RENDERING_ATTRIBUTE],
    });
    softwareRendering = current;
  }
  return softwareRendering();
}
