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
  "status.provider.modelRetryUnreachable":
    "{provider} ne peut pas se connecter au fournisseur du modèle. Nouvel essai : tentative {attempt}.",
  "status.provider.modelRetryServerError":
    "Le fournisseur du modèle est occupé ou en erreur. {provider} réessaie : tentative {attempt}.",
  "status.provider.modelRetryOutOfMemory":
    "Le serveur du modèle manque de mémoire pour cette conversation. {provider} réessaie : tentative {attempt}. Une nouvelle conversation demande moins de mémoire.",
  "status.provider.modelRetryRecovered": "Le fournisseur du modèle répond de nouveau.",
  "status.provider.retryRecovered": "{provider} reçoit de nouveau des réponses de son serveur.",
  "status.provider.claudeFastModeNeedsUsageCredits":
    "Claude a répondu à la vitesse standard. Avec un abonnement Claude, le mode rapide utilise des crédits d’utilisation. Activez-les dans votre compte Claude.",
  "status.provider.claudeFastModeNotOnPlan":
    "Claude a répondu à la vitesse standard. Votre forfait Claude n’inclut pas le mode rapide.",
  "status.provider.claudeFastModeNotFirstParty":
    "Claude a répondu à la vitesse standard. Le mode rapide fonctionne uniquement avec une clé API Anthropic ou un abonnement Claude, pas avec Bedrock, Vertex, Foundry ou une passerelle.",
  "status.provider.claudeFastModeModelNotAllowed":
    "Claude a répondu à la vitesse standard. Ce modèle ne peut pas utiliser le mode rapide sur votre compte.",
  "status.provider.claudeFastModeTurnedOff":
    "Claude a répondu à la vitesse standard. Le mode rapide est désactivé dans les paramètres de Claude Code ou par votre organisation.",
  "status.provider.claudeFastModeUnavailable":
    "Claude a répondu à la vitesse standard. Claude Code n’a pas pu utiliser le mode rapide pour ce tour.",
  "status.provider.claudeOwnApiKey":
    "Claude Code est configuré pour utiliser une clé API Anthropic. Anthropic facture chaque requête sur le crédit API de la clé, et non sur votre forfait Claude. Pour utiliser votre forfait, retirez la clé des paramètres de Claude Code ou des variables d'environnement, puis redémarrez OpenBot.",
} as const satisfies PartialTranslation<typeof source>;
