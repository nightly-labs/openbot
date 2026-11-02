import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Dieser Slack-Arbeitsbereich ist nicht verbunden.",
  "error.messaging.unsupported": "Dieser Computer kann keine Verbindung zu Slack herstellen.",
  "error.messaging.relayUnavailable":
    "OpenBot kann auf diesem Computer keine Slack-Ereignisse empfangen. Melde dich an, gib diesem Computer einen Namen und versuche es erneut.",
  "error.messaging.discordNotConnected": "Dieser Discord-Server ist nicht verbunden.",
  "error.messaging.discordUnsupported": "Dieser Computer kann keine Verbindung zu Discord herstellen.",
  "error.messaging.discordRelayUnavailable":
    "OpenBot kann auf diesem Computer keine Discord-Ereignisse empfangen. Melde dich an, gib diesem Computer einen Namen und versuche es erneut.",
  "error.messaging.discordRolesUnsupported":
    "OpenBot kann die Discord-Rollen noch nicht auflisten. Versuche es später noch einmal.",
  "error.messaging.telegramNotConnected": "Dieser Telegram-Chat ist nicht verbunden.",
  "error.messaging.telegramUnsupported": "Dieser Computer kann keine Verbindung zu Telegram herstellen.",
  "error.messaging.telegramRelayUnavailable":
    "OpenBot kann Telegram auf diesem Computer nicht erreichen. Melde dich an, gib diesem Computer einen Namen und versuche es erneut.",
  "error.messaging.telegramServiceUnavailable":
    "OpenBot kann Telegram gerade nicht verbinden. Versuche es später erneut.",
  "error.messaging.memoryLimit":
    "Ein verbundener Arbeitsbereich kann bis zu {limit} Erinnerungen haben. Lösche zuerst eine.",
} as const satisfies PartialTranslation<typeof source>;
