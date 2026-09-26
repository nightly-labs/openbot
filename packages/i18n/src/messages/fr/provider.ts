import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/provider";

export const messages = {
  // The provider list, shown in Settings and during onboarding.
  "provider.availableHere": "Disponible sur cet ordinateur",
  "provider.availableOnHost": "S’exécute sur {name}",
  "provider.custom.name": "Fournisseur personnalisé",
  "provider.custom.description": "Votre propre point de terminaison de modèle",
  "provider.custom.addLabel": "Ajouter un fournisseur personnalisé",
  "provider.custom.installLabel": "Installer un fournisseur personnalisé",
  "provider.endpointCount": { one: "{count} point de terminaison", other: "{count} points de terminaison" },
  "provider.manageEndpoints": {
    one: "Gérer {count} point de terminaison",
    other: "Gérer {count} points de terminaison",
  },
  "provider.refresh": "Actualiser",
  "provider.refreshLabel": "Actualiser les fournisseurs",
  "provider.refreshingLabel": "Vérification des fournisseurs",
  "provider.refreshing": "Vérification…",

  // What a provider row reports about itself. A percentage while downloading is a number, not a
  // message, so it has no key.
  "provider.status.connecting": "Connexion",
  "provider.status.updateAvailable": "Mise à jour disponible",
  "provider.status.settingUp": "Configuration",
  "provider.status.downloadFailed": "Échec du téléchargement",
  "provider.status.connected": "Connecté",
  "provider.status.notDownloaded": "Non téléchargé",
  "provider.status.ready": "Prêt",
  "provider.status.notConnected": "Non connecté",
  "provider.status.notInstalled": "Non installé",
  "provider.status.updateRequired": "Mise à jour requise",
  "provider.status.unavailable": "Indisponible",
  "provider.status.checking": "Vérification",

  // Which account tier the OpenCode row runs on. It shows only while it adds to the runtime
  // badge: a saved key leaves the runtime "Connected" to speak for the row.
  "provider.key.free": "Gratuit",

  // The buttons on a provider row, and the name a screen reader reads for each. The name repeats
  // the provider, because a list of rows all saying "Connect" tells a screen reader user nothing.
  "provider.action.download": "Télécharger",
  "provider.action.cancel": "Annuler",
  "provider.action.connect": "Se connecter",
  "provider.action.reconnect": "Se reconnecter",
  "provider.action.restart": "Redémarrer",
  "provider.action.retry": "Réessayer",
  "provider.action.updateTo": "Mettre à jour vers {version}",
  "provider.action.checkForUpdates": "Rechercher des mises à jour",
  "provider.action.install": "Installer",
  "provider.action.signIn": "Se connecter",
  "provider.action.signInWithCode": "Se connecter avec un code",
  "provider.action.add": "Ajouter",
  "provider.aria.download": "Télécharger {name}",
  "provider.aria.cancel": "Annuler {name}",
  "provider.aria.connect": "Connecter {name}",
  "provider.aria.reconnect": "Reconnecter {name}",
  "provider.aria.restart": "Redémarrer {name}",
  "provider.aria.retry": "Réessayer {name}",
  "provider.aria.install": "Installer {name}",
  "provider.aria.signIn": "Se connecter à {name}",
  "provider.aria.moreActions": "Autres actions pour {name}",
  "provider.aria.signInWithCode": "Se connecter à {name} avec un code sur un autre appareil",
} as const satisfies PartialTranslation<typeof source>;
