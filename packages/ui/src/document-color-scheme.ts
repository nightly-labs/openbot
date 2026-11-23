import { createSignal } from "solid-js";

export type DocumentColorScheme = "light" | "dark";

const ATTRIBUTE = "data-openbot-color-scheme";

function read(): DocumentColorScheme {
  return document.documentElement.getAttribute(ATTRIBUTE) === "light" ? "light" : "dark";
}

let scheme: (() => DocumentColorScheme) | undefined;

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
