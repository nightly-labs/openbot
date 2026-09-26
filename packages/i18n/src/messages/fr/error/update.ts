import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  // Updater state the user reads.
  "error.update.unsupported":
    "Les mises à jour sont disponibles dans les versions installées de l’application de bureau.",
  "error.update.notReady": "Une mise à jour n’est pas prête à être installée.",
  "error.update.restartFailed": "OpenBot n’a pas pu redémarrer pour installer la mise à jour.",
  "error.update.downloadStalled": "Le téléchargement de la mise à jour ne répond plus. Réessayez.",
  "error.update.installFailed": "Impossible d’installer la mise à jour. Quittez puis rouvrez OpenBot, et réessayez.",
  "error.update.downloadFailed": "Impossible de télécharger la mise à jour. Réessayez.",
  "error.update.checkFailed": "Impossible de rechercher des mises à jour. Réessayez.",
  "error.update.checkStalled": "La recherche de mise à jour ne répond plus. Réessayez.",
  "error.update.checkOffline":
    "Impossible de joindre le service de mise à jour. Vérifiez votre connexion Internet, puis réessayez.",
  "error.update.checkUnavailable":
    "Le service de mise à jour n’a pas répondu. OpenBot réessaiera de lui-même dans quelques minutes.",
  "error.update.checkNoRelease":
    "Aucune mise à jour publiée n’a été trouvée pour cette plateforme. OpenBot réessaiera de lui-même dans quelques minutes.",
} as const satisfies PartialTranslation<typeof source>;
