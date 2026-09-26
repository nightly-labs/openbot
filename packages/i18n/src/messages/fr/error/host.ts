import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  // Errors from host setup, publishing, and host maintenance.
  "error.host.iceServersMissing": "Remote Signal n’a pas fourni de serveurs ICE.",
  "error.host.webRtcNotConfigured": "Le service d’hôte WebRTC n’est pas configuré.",
  "error.host.runtimeNotInstalled": "Le runtime du bureau à distance n’est pas installé.",
  "error.host.setupUnavailable": "La configuration des autorisations n’est pas disponible.",
  "error.host.accountChangedDuringUpdate": "Le compte connecté a changé pendant la mise à jour de ce serveur.",
  "error.host.nameBeforePublish": "Donnez un nom à cet OpenBot avant de le publier.",
  "error.host.memberNotFound": "Le membre distant n’existe pas.",
  "error.host.publishBeforeInvite": "Rendez cet OpenBot public avant de créer une invitation.",
  "error.host.teamAccessUnavailable": "Votre accès à l’équipe n’est pas disponible.",
  "error.host.ownerIdentityUnavailable": "L’identité du propriétaire de l’hôte n’est pas disponible.",
  "error.host.reserveAddressFailed": "Impossible de réserver l’adresse publique.",
  "error.host.publishFailed": "Impossible de publier cet OpenBot.",
  "error.host.mobileConnectPublishFailed": "Impossible de publier cet OpenBot pour Mobile Connect.",
  "error.host.mobileConnectHostChanged": "L’hôte Mobile Connect a changé. Réessayez.",
  "error.host.noServer": "Cet ordinateur n’a aucun serveur à modifier.",
  "error.host.identityLocalOnly":
    "Le nom et le logo du serveur ne peuvent être modifiés que sur l’ordinateur qui l’exécute.",
  "error.host.maintenanceInterrupted":
    "La maintenance de l’hôte a été interrompue. Vérifiez l’application et réinitialisez l’état de l’hôte avant de réessayer.",
  "error.host.updateFailed":
    "La mise à jour de l’hôte a échoué pendant {phase}. Vérifiez le propriétaire du bundle, la signature, l’état des locataires et l’espace disque libre avant de réinitialiser l’état.",
  "error.host.tenantsNotIdle": "Les locataires ne sont pas restés inactifs pendant cinq minutes en deux heures.",
  "error.host.tenantShutdownTimeout":
    "L’arrêt des locataires a expiré. Aucun remplacement de l’application n’a démarré.",
  "error.host.tenantHealthMissing":
    "Les rapports d’état des locataires sont absents ou mauvais après le redémarrage. Examinez les sessions des locataires avant une autre mise à jour.",
} as const satisfies PartialTranslation<typeof source>;
