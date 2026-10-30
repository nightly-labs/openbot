import type { AppAppearance } from "@openbot/contracts/app-appearance";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

/**
 * `tokens-light.css` changes the palette when the root element has `data-openbot-color-scheme="light"`.
 * Code that cannot use the tokens in CSS reads the attribute through `@openbot/ui/document-color-scheme`.
 */
function applyColorScheme(scheme: "light" | "dark"): void {
  document.documentElement.dataset.openbotColorScheme = scheme;
}

/**
 * Keeps this window's colors on the appearance choice, and returns the functions that refresh it
 * after the choice changes and that stop it. System follows `prefers-color-scheme`, which is the
 * computer's setting, so visited websites keep the computer's colors. Main changes it only while the
 * window is transparent, and then to Light or Dark only; System still gives the computer's setting.
 */
export function syncColorScheme(choice: () => AppAppearance) {
  const query = window.matchMedia(LIGHT_QUERY);
  const refresh = () => {
    const appearance = choice();
    applyColorScheme(appearance === "system" ? (query.matches ? "light" : "dark") : appearance);
  };
  refresh();
  query.addEventListener("change", refresh);
  return {
    refresh,
    stop() {
      query.removeEventListener("change", refresh);
      delete document.documentElement.dataset.openbotColorScheme;
    },
  };
}
