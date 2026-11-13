import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot – lokalny host",
  "window.localClientTitle": "OpenBot – lokalny klient",
  "window.computerUsePermissionTitle": "Włącz Sterowanie komputerem",
  "window.controls.label": "Okno",
  "window.controls.minimize": "Minimalizuj",
  "window.controls.maximize": "Maksymalizuj",
  "window.controls.restore": "Przywróć",
  "window.controls.close": "Zamknij",
} as const satisfies PartialTranslation<typeof source>;
