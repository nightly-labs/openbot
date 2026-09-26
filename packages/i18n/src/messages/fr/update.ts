import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/update";

export const messages = {
  "update.action.check": "Rechercher des mises à jour",
  "update.action.checking": "Recherche de mises à jour…",
  "update.action.download": "Télécharger la mise à jour",
  "update.action.downloading": "Téléchargement de la mise à jour…",
  "update.action.restart": "Redémarrer pour mettre à jour",
  "update.action.restarting": "Redémarrage…",
  "update.action.retryDownload": "Relancer le téléchargement",
  "update.managedByHost": "Géré par l’hôte",
  "update.upToDate": "À jour",

  "update.provider.update": "Mettre à jour",
  "update.provider.upToDate": "{name} est à jour",
  "update.provider.checking": "Recherche de mises à jour pour {name}",
  "update.provider.available": "Mise à jour de {name} disponible",
  "update.provider.updating": "Mise à jour de {name}",
  "update.provider.failed": "Échec de la mise à jour de {name}",
  "update.provider.settingUp": "Configuration",
  "update.provider.interrupted": "La mise à jour a été interrompue. Réessayez.",
  "update.provider.unknownVersion": "version inconnue",
  "update.provider.remoteHost":
    "Les mises à jour de la CLI d’un fournisseur s’exécutent sur l’ordinateur qui l’héberge.",
  "update.provider.unavailable": "Les mises à jour des fournisseurs ne sont pas disponibles.",
  "update.provider.downloadsUnavailable": "Les téléchargements des fournisseurs ne sont pas disponibles.",
  "update.provider.startFailed": "La mise à jour n’a pas pu démarrer. Réessayez.",
} as const satisfies PartialTranslation<typeof source>;
