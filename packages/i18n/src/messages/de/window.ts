import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "Lokaler OpenBot-Host",
  "window.localClientTitle": "Lokaler OpenBot-Client",
  "window.computerUsePermissionTitle": "Computersteuerung aktivieren",
  "window.controls.label": "Fenster",
  "window.controls.minimize": "Minimieren",
  "window.controls.maximize": "Maximieren",
  "window.controls.restore": "Wiederherstellen",
  "window.controls.close": "Schließen",
} as const satisfies PartialTranslation<typeof source>;
