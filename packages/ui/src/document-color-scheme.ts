import { createSignal } from "solid-js";

/** The palette that `@openbot/brand` shows: light when the root element asks for `tokens-light.css`. */
export type DocumentColorScheme = "light" | "dark";

const ATTRIBUTE = "data-openbot-color-scheme";

function read(): DocumentColorScheme {
  return document.documentElement.getAttribute(ATTRIBUTE) === "light" ? "light" : "dark";
}

let scheme: (() => DocumentColorScheme) | undefined;

/**
 * The palette of this document, for code that cannot use the tokens in CSS, such as a Mermaid
 * drawing or a sandboxed page. The app sets the root attribute; this only reads it, so the shared UI
 * stays free of the app's settings.
 */
export function documentColorScheme(): DocumentColorScheme {
  if (!scheme) {
    const [current, setCurrent] = createSignal<DocumentColorScheme>(read());
    new MutationObserver(() => setCurrent(read())).observe(document.documentElement, {
      attributeFilter: [ATTRIBUTE],
    });
    scheme = current;
  }
  return scheme();
}
