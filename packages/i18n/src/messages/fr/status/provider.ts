import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Téléchargement arrêté. Réessayez.",
  "status.provider.downloadFailed": "Échec du téléchargement. Réessayez.",
  "status.provider.updateWaiting": "La mise à jour démarre à la fin du tour en cours.",
  "status.provider.confirmContinue": "Continuer",
  "status.provider.confirmCancel": "Annuler",
} as const satisfies PartialTranslation<typeof source>;
