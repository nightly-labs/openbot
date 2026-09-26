import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  // The native application menu. Electron localizes its own `role:` entries from the operating
  // system, so only the custom items are here.
  "menu.stopAllAgents": "Arrêter tous les agents",
  "menu.checkForUpdates": "Rechercher des mises à jour…",
  "menu.preferences": "Réglages…",
} as const satisfies PartialTranslation<typeof source>;
