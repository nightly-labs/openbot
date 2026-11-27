import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot — host locale",
  "window.localClientTitle": "OpenBot — client locale",
  "window.computerUsePermissionTitle": "Attiva il Controllo del computer",
  "window.rendererStoppedTitle": "OpenBot ha smesso di funzionare",
  "window.rendererStoppedBody":
    "La finestra si è fermata più volte. Le tue chat sono salvate e i tuoi agenti continuano a lavorare.",
  "window.rendererStoppedReload": "Ricarica",
  "window.minimize": "Riduci a icona",
  "window.maximize": "Ingrandisci",
  "window.restore": "Ripristina",
} as const satisfies PartialTranslation<typeof source>;
