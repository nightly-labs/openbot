import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  // The native application menu. Electron localizes its own `role:` entries from the operating
  // system, so only the custom items are here.
  "menu.stopAllAgents": "Arrêter tous les agents",
  "menu.checkForUpdates": "Rechercher des mises à jour…",
  "menu.preferences": "Réglages…",
  "menu.actualSize": "Taille réelle",
  "menu.zoomIn": "Zoom avant",
  "menu.zoomOut": "Zoom arrière",
  "menu.copyLink": "Copier le lien",
  "menu.trayOpen": "Ouvrir OpenBot",
  "menu.trayQuit": "Quitter OpenBot",
  "menu.trayTooltip": "OpenBot",
  "menu.undo": "Annuler",
  "menu.redo": "Rétablir",
  "menu.cut": "Couper",
  "menu.copy": "Copier",
  "menu.paste": "Coller",
  "menu.pasteAndMatchStyle": "Coller et adapter le style",
  "menu.delete": "Supprimer",
  "menu.selectAll": "Tout sélectionner",
} as const satisfies PartialTranslation<typeof source>;
