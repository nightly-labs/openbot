import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot – lokalny host",
  "window.localClientTitle": "OpenBot – lokalny klient",
  "window.computerUsePermissionTitle": "Włącz Sterowanie komputerem",
  "window.rendererStoppedTitle": "OpenBot przestał działać",
  "window.rendererStoppedBody": "Okno kilka razy przestało działać. Twoje czaty są zapisane, a agenci dalej pracują.",
  "window.rendererStoppedReload": "Wczytaj ponownie",
  "window.minimize": "Minimalizuj",
  "window.maximize": "Maksymalizuj",
  "window.restore": "Przywróć",
} as const satisfies PartialTranslation<typeof source>;
