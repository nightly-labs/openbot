import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/workspace";

export const messages = {
  "mobile.workspace.status.notConnected": "Non connecté",
  "mobile.workspace.status.online": "En ligne",
  "mobile.workspace.status.offline": "Hors ligne",
  "mobile.workspace.status.error": "Erreur de connexion",
  "mobile.workspace.status.reconnecting": "Reconnexion",
  "mobile.workspace.status.attempt": "Tentative {attempt}/{limit}",
  "mobile.workspace.status.attemptPrefix": "Tentative ",
  "mobile.workspace.status.retryIn": "Nouvel essai dans {seconds} secondes",
  "mobile.workspace.section.agents": "Agents",
  "mobile.workspace.error.directoryUnavailable": "L’annuaire des serveurs est indisponible.",
  "mobile.workspace.error.sectionsLoadFailed": "Impossible de charger les sections. Réessayez.",
  "mobile.workspace.error.transportNotReady": "La connexion mobile n’est pas prête.",
  "mobile.workspace.error.sectionsUnsupported": "Cet hôte ne prend pas en charge la modification des sections.",
  "mobile.workspace.error.leaveOwnServer":
    "Vous pouvez quitter uniquement les serveurs distants que vous avez rejoints.",
  "mobile.workspace.error.agentNotOnHost": "L’agent n’est pas sur cet hôte.",
  "mobile.workspace.error.filesUnsupported":
    "Cet hôte ne prend pas en charge la gestion des fichiers. Mettez à jour OpenBot sur l’hôte.",
  "mobile.workspace.error.agentUnavailableOnHost": "L’agent est indisponible sur cet hôte.",
  "mobile.workspace.error.agentUnavailable": "L’agent est indisponible.",
  "mobile.workspace.error.formUnavailable": "Ce formulaire n’est plus disponible.",
  "mobile.workspace.alert.preferencesTitle": "Impossible d’enregistrer les préférences de discussion",
  "mobile.workspace.alert.preferencesBody": "Vos préférences précédentes ont été conservées. Réessayez.",
  "mobile.workspace.alert.updateRequiredTitle": "Mise à jour requise",
  "mobile.workspace.alert.updateRequiredUnread":
    "Mettez à jour ce serveur de bureau pour marquer les conversations comme non lues.",
  "mobile.workspace.alert.markUnreadTitle": "Impossible de marquer comme non lu",
  "mobile.workspace.alert.markUnreadBody": "Reconnectez-vous au serveur et réessayez.",
  "mobile.workspace.alert.serverOrderTitle": "Impossible d’enregistrer l’ordre des serveurs",
  "mobile.workspace.alert.serverOrderBody": "L’ordre précédent a été conservé. Réessayez.",
  "mobile.workspace.error.connectFailed": "La connexion au serveur a échoué.",
  "mobile.workspace.error.disconnectFailed": "Le serveur ne s’est pas déconnecté correctement.",
  "mobile.workspace.error.queueEditRejected": "L’hôte n’a pas accepté cette modification.",
} as const satisfies PartialTranslation<typeof source>;
