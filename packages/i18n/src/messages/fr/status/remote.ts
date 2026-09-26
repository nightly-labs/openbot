import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  // Status lines of remote desktop setup and remote connection recovery.
  "status.remote.setupMacOnly": "La configuration des autorisations est disponible sous macOS.",
  "status.remote.setupInstallHost": "Installez le composant d’hôte du bureau à distance, puis vérifiez à nouveau.",
  "status.remote.setupUpdateRuntime":
    "Mettez à jour le runtime du bureau à distance pour vérifier les autorisations macOS.",
  "status.remote.setupCheckFailed":
    "Sunshine n’a pas pu terminer la vérification des autorisations. Vérifiez la session de l’hôte, puis réessayez.",
  "status.remote.setupServiceFailed":
    "Le service de bureau à distance n’a pas pu démarrer. Vérifiez que cet utilisateur macOS a une session graphique active.",
  "status.remote.connectingSunshine": "Connexion via Sunshine…",
  "status.remote.switchingMonitor": "Changement de l’écran partagé…",
  "status.remote.controlConnected": "Contrôle à distance connecté.",
  "status.remote.controlFailed": "Le contrôle à distance a échoué.",
  "status.remote.stagePreferences": "Chargement des préférences de discussion locales : {reason}",
  "status.remote.stageConnection": "Connexion à l’ordinateur : {reason}",
  "status.remote.stageCompatibility": "Vérification de la compatibilité de l’ordinateur : {reason}",
  "status.remote.stageAgents": "Chargement des agents : {reason}",
  "status.remote.stageReads": "Chargement de l’état de lecture : {reason}",
  "status.remote.stageConversations": "Chargement des conversations : {reason}",
  "status.remote.suspendedDetail": "Mettez à jour OpenBot Mobile ou l’app de bureau avant de vous connecter.\n{detail}",
  "status.remote.cooldownDetail":
    "La connexion a échoué après {limit} tentatives. Nouvelle tentative dans {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown":
    "La connexion a échoué après {limit} tentatives. Nouvelle tentative dans {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    one: "Connexion perdue. Nouvelle tentative dans {count} s.\n{detail}",
    other: "Connexion perdue. Nouvelle tentative dans {count} s.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "Connexion perdue. Nouvelle tentative dans {count} s.",
    other: "Connexion perdue. Nouvelle tentative dans {count} s.",
  },
  "status.remote.attemptFailedDetail": {
    one: "La tentative de connexion a échoué. Nouvelle tentative dans {count} s.\n{detail}",
    other: "La tentative de connexion a échoué. Nouvelle tentative dans {count} s.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "La tentative de connexion a échoué. Nouvelle tentative dans {count} s.",
    other: "La tentative de connexion a échoué. Nouvelle tentative dans {count} s.",
  },
  "status.remote.reconnectingDetail": {
    one: "Reconnexion {attempt}/{count}\n{detail}",
    other: "Reconnexion {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": { one: "Reconnexion {attempt}/{count}", other: "Reconnexion {attempt}/{count}" },
} as const satisfies PartialTranslation<typeof source>;
