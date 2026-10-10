import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Questo workspace Slack non è collegato.",
  "error.messaging.unsupported": "Questo computer non può collegarsi a Slack.",
  "error.messaging.relayUnavailable":
    "OpenBot non può ricevere gli eventi di Slack su questo computer. Accedi, dai un nome a questo computer e riprova.",
  "error.messaging.discordNotConnected": "Questo server Discord non è collegato.",
  "error.messaging.discordUnsupported": "Questo computer non può collegarsi a Discord.",
  "error.messaging.discordRelayUnavailable":
    "OpenBot non può ricevere gli eventi di Discord su questo computer. Accedi, dai un nome a questo computer e riprova.",
  "error.messaging.telegramNotConnected": "Questa chat Telegram non è collegata.",
  "error.messaging.telegramUnsupported": "Questo computer non può collegarsi a Telegram.",
  "error.messaging.telegramRelayUnavailable":
    "OpenBot non può raggiungere Telegram su questo computer. Accedi, dai un nome a questo computer e riprova.",
} as const satisfies PartialTranslation<typeof source>;
