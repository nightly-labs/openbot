import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot – Hôte local",
  "window.localClientTitle": "OpenBot – Client local",
  "window.computerUsePermissionTitle": "Activer Computer Use",
  "window.rendererStoppedTitle": "OpenBot ne fonctionne plus",
  "window.rendererStoppedBody":
    "La fenêtre s’est arrêtée plusieurs fois. Vos discussions sont enregistrées et vos agents continuent de travailler.",
  "window.rendererStoppedReload": "Recharger",
  "window.minimize": "Réduire",
  "window.maximize": "Agrandir",
  "window.restore": "Restaurer",
} as const satisfies PartialTranslation<typeof source>;
