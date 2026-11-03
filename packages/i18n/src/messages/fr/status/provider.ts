import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Téléchargement arrêté. Réessayez.",
  "status.provider.downloadFailed": "Échec du téléchargement. Réessayez.",
  "status.provider.updateWaiting": "La mise à jour démarre à la fin du tour en cours.",
  "status.provider.confirmContinue": "Continuer",
  "status.provider.confirmCancel": "Annuler",
  "status.provider.retryUnreachable":
    "{provider} ne peut pas se connecter à son serveur. Nouvelle tentative {attempt} sur {maxAttempts}.",
  "status.provider.retryServerError":
    "Le serveur de {provider} est occupé ou en erreur. Nouvelle tentative {attempt} sur {maxAttempts}.",
  "status.provider.retryRecovered": "{provider} reçoit de nouveau des réponses de son serveur.",
} as const satisfies PartialTranslation<typeof source>;
