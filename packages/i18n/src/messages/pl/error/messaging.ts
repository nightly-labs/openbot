import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Ten obszar roboczy Slack nie jest połączony.",
  "error.messaging.unsupported": "Ten komputer nie może połączyć się ze Slackiem.",
  "error.messaging.relayUnavailable":
    "OpenBot nie może odbierać zdarzeń Slack na tym komputerze. Zaloguj się, nadaj temu komputerowi nazwę i spróbuj ponownie.",
  "error.messaging.discordNotConnected": "Ten serwer Discord nie jest połączony.",
  "error.messaging.discordUnsupported": "Ten komputer nie może połączyć się z Discordem.",
  "error.messaging.discordRelayUnavailable":
    "OpenBot nie może odbierać zdarzeń Discord na tym komputerze. Zaloguj się, nadaj temu komputerowi nazwę i spróbuj ponownie.",
  "error.messaging.telegramNotConnected": "Ten czat Telegram nie jest połączony.",
  "error.messaging.telegramUnsupported": "Ten komputer nie może połączyć się z Telegramem.",
  "error.messaging.telegramRelayUnavailable":
    "OpenBot nie może połączyć się z Telegramem na tym komputerze. Zaloguj się, nadaj temu komputerowi nazwę i spróbuj ponownie.",
} as const satisfies PartialTranslation<typeof source>;
