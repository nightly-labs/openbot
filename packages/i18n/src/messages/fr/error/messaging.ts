import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Cet espace de travail Slack n’est pas connecté.",
  "error.messaging.unsupported": "Cet ordinateur ne peut pas se connecter à Slack.",
  "error.messaging.relayUnavailable":
    "OpenBot ne peut pas recevoir les événements Slack sur cet ordinateur. Connectez-vous, donnez un nom à cet ordinateur et réessayez.",
  "error.messaging.discordNotConnected": "Ce serveur Discord n’est pas connecté.",
  "error.messaging.discordUnsupported": "Cet ordinateur ne peut pas se connecter à Discord.",
  "error.messaging.discordRelayUnavailable":
    "OpenBot ne peut pas recevoir les événements Discord sur cet ordinateur. Connectez-vous, donnez un nom à cet ordinateur et réessayez.",
  "error.messaging.discordRolesUnsupported":
    "OpenBot ne peut pas encore lister les rôles Discord. Réessayez plus tard.",
  "error.messaging.telegramNotConnected": "Cette discussion Telegram n’est pas connectée.",
  "error.messaging.telegramUnsupported": "Cet ordinateur ne peut pas se connecter à Telegram.",
  "error.messaging.telegramRelayUnavailable":
    "OpenBot ne peut pas joindre Telegram sur cet ordinateur. Connectez-vous, donnez un nom à cet ordinateur et réessayez.",
  "error.messaging.telegramServiceUnavailable":
    "OpenBot ne peut pas connecter Telegram pour le moment. Réessayez plus tard.",
  "error.messaging.whatsappNotConnected": "Ce numéro WhatsApp n’est pas connecté.",
  "error.messaging.whatsappUnsupported": "Cet ordinateur ne peut pas se connecter à WhatsApp.",
  "error.messaging.whatsappTooManySenders": "Un numéro WhatsApp peut autoriser jusqu’à 200 contacts et groupes.",
  "error.messaging.whatsappRequestEnded":
    "Cette demande est terminée. Demandez à la personne d’écrire à nouveau pour obtenir un nouveau code.",
  "error.messaging.memoryLimit":
    "Un espace de travail connecté peut avoir jusqu’à {limit} souvenirs. Supprimez-en un d’abord.",
} as const satisfies PartialTranslation<typeof source>;
