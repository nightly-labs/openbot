import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  // Errors of a Slack workspace connection, which the host sends.
  "error.messaging.notConnected": "Bu Slack çalışma alanı bağlı değil.",
  "error.messaging.unsupported": "Bu bilgisayar Slack'e bağlanamıyor.",
  "error.messaging.relayUnavailable":
    "OpenBot bu bilgisayarda Slack etkinliklerini alamıyor. Oturum açın, bu bilgisayara bir ad verin ve tekrar deneyin.",
  // Bir Discord sunucusu bağlantısının ana makinenin gönderdiği hataları.
  "error.messaging.discordNotConnected": "Bu Discord sunucusu bağlı değil.",
  "error.messaging.discordUnsupported": "Bu bilgisayar Discord'a bağlanamıyor.",
  "error.messaging.discordRelayUnavailable":
    "OpenBot bu bilgisayarda Discord etkinliklerini alamıyor. Oturum açın, bu bilgisayara bir ad verin ve tekrar deneyin.",
  "error.messaging.telegramNotConnected": "Bu Telegram sohbeti bağlı değil.",
  "error.messaging.telegramUnsupported": "Bu bilgisayar Telegram'a bağlanamıyor.",
  "error.messaging.telegramRelayUnavailable":
    "OpenBot bu bilgisayarda Telegram'a ulaşamıyor. Oturum açın, bu bilgisayara bir ad verin ve tekrar deneyin.",
} as const satisfies PartialTranslation<typeof source>;
