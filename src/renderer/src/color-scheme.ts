import type { AppAppearance } from "@openbot/contracts/app-appearance";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

function applyColorScheme(scheme: "light" | "dark"): void {
  document.documentElement.dataset.openbotColorScheme = scheme;
}

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
