import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "Seuls les liens HTTP(S) peuvent s’ouvrir dans le navigateur externe.",
  "error.app.notificationsUnsupported": "Ce système ne prend pas en charge les notifications de bureau.",
  "error.app.notificationSettingsMissing": "Ce système n’a pas de page de réglages des notifications.",
  "error.app.notReady": "OpenBot n’est pas prêt.",
  "error.app.macSecureStorageUnavailable": "Le stockage sécurisé de macOS n’est pas disponible.",
  "error.app.secretStorageUnavailable": "Le stockage des secrets du système n’est pas disponible.",
  "error.app.remoteIdentityUnavailable": "L’identité de l’hôte distant n’est pas disponible.",
  "error.app.iceServersMissing": "Remote Signal n’a pas encore fourni de serveurs ICE.",
  "error.app.finishLocalTest": "Terminez le test local avant de changer d’écran.",
  "error.app.windowBlockedBySecuritySoftware":
    "Un logiciel de sécurité de cet ordinateur a probablement arrêté la fenêtre d’OpenBot. Dans votre logiciel de sécurité, par exemple Kaspersky, ajoutez OpenBot.exe comme application de confiance. Puis redémarrez OpenBot.",
} as const satisfies PartialTranslation<typeof source>;
