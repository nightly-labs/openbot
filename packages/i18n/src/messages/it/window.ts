import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot — host locale",
  "window.localClientTitle": "OpenBot — client locale",
  "window.computerUsePermissionTitle": "Attiva il Controllo del computer",
  "window.controls.label": "Finestra",
  "window.controls.minimize": "Riduci a icona",
  "window.controls.maximize": "Ingrandisci",
  "window.controls.restore": "Ripristina",
  "window.controls.close": "Chiudi",
} as const satisfies PartialTranslation<typeof source>;
