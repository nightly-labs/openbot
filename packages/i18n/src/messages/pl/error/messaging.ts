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
  "error.messaging.discordRolesUnsupported": "OpenBot nie może jeszcze pokazać ról Discorda. Spróbuj ponownie później.",
  "error.messaging.telegramNotConnected": "Ten czat Telegram nie jest połączony.",
  "error.messaging.telegramUnsupported": "Ten komputer nie może połączyć się z Telegramem.",
  "error.messaging.telegramRelayUnavailable":
    "OpenBot nie może połączyć się z Telegramem na tym komputerze. Zaloguj się, nadaj temu komputerowi nazwę i spróbuj ponownie.",
  "error.messaging.telegramServiceUnavailable": "OpenBot nie może teraz połączyć Telegrama. Spróbuj ponownie później.",
  "error.messaging.whatsappNotConnected": "Ten numer WhatsApp nie jest połączony.",
  "error.messaging.whatsappUnsupported": "Ten komputer nie może połączyć się z WhatsApp.",
  "error.messaging.whatsappTooManySenders": "Numer WhatsApp może dopuścić maksymalnie 200 kontaktów i grup.",
  "error.messaging.whatsappRequestEnded": "Ta prośba wygasła. Poproś tę osobę, aby napisała ponownie po nowy kod.",
  "error.messaging.memoryLimit":
    "Połączony obszar roboczy może mieć maksymalnie {limit} wspomnień. Najpierw usuń jedno.",
} as const satisfies PartialTranslation<typeof source>;
