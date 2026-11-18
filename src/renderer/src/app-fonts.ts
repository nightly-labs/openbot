import type { AppAppearancePreference, AppFontFamily } from "@openbot/contracts/app-appearance";
import { type Accessor, createSignal, onSettled } from "solid-js";
import { appPort } from "./app-port";

/** A font name in quotes, as a CSS font list needs it. The preload let no quote or backslash through. */
function quotedFontFamily(font: AppFontFamily): string {
  return `"${font}"`;
}

const FONT_PROPERTIES = [
  { property: "--openbot-font-sans", fallback: "var(--openbot-font-sans-default)", field: "interfaceFont" },
  { property: "--openbot-font-mono", fallback: "var(--openbot-font-mono-default)", field: "codeFont" },
] as const;

/**
 * Puts the chosen interface font and code font before the default fonts on the root element, or
 * removes them for null. The default fonts stay after the chosen one, so a letter that the chosen
 * font does not have still shows.
 */
export function applyAppFonts(preference: Pick<AppAppearancePreference, "interfaceFont" | "codeFont">): void {
  const root = document.documentElement;
  for (const { property, fallback, field } of FONT_PROPERTIES) {
    const font = preference[field];
    if (font === null) root.style.removeProperty(property);
    else root.style.setProperty(property, `${quotedFontFamily(font)}, ${fallback}`);
  }
}

/**
 * The fonts of this computer, for the font choices in Settings. Empty until main answers, and when
 * the list does not load: then the choices show only the default and the saved font.
 */
export function useInstalledFonts(): Accessor<readonly AppFontFamily[]> {
  const [fonts, setFonts] = createSignal<readonly AppFontFamily[]>([]);
  onSettled(() => {
    void appPort()
      .listInstalledFonts()
      .then((next) => setFonts(() => next))
      .catch(() => undefined);
  });
  return fonts;
}
