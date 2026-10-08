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
} as const satisfies PartialTranslation<typeof source>;
