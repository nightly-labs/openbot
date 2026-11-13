import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  // Native window titles.
  "window.localHostTitle": "OpenBot – Hôte local",
  "window.localClientTitle": "OpenBot – Client local",
  "window.computerUsePermissionTitle": "Activer Computer Use",
  "window.controls.label": "Fenêtre",
  "window.controls.minimize": "Réduire",
  "window.controls.maximize": "Agrandir",
  "window.controls.restore": "Restaurer",
  "window.controls.close": "Fermer",
} as const satisfies PartialTranslation<typeof source>;
