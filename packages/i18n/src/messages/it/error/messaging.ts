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
  "error.messaging.discordRolesUnsupported": "OpenBot non può ancora elencare i ruoli di Discord. Riprova più tardi.",
  "error.messaging.telegramNotConnected": "Questa chat Telegram non è collegata.",
  "error.messaging.telegramUnsupported": "Questo computer non può collegarsi a Telegram.",
  "error.messaging.telegramRelayUnavailable":
    "OpenBot non può raggiungere Telegram su questo computer. Accedi, dai un nome a questo computer e riprova.",
  "error.messaging.telegramServiceUnavailable":
    "OpenBot non può collegare Telegram in questo momento. Riprova più tardi.",
  "error.messaging.whatsappNotConnected": "Questo numero WhatsApp non è collegato.",
  "error.messaging.whatsappUnsupported": "Questo computer non può collegarsi a WhatsApp.",
  "error.messaging.whatsappTooManySenders": "Un numero WhatsApp può autorizzare al massimo 200 contatti e gruppi.",
  "error.messaging.whatsappRequestEnded":
    "Questa richiesta è terminata. Chiedi alla persona di scrivere di nuovo per ricevere un nuovo codice.",
  "error.messaging.memoryLimit": "Un workspace collegato può avere al massimo {limit} memorie. Eliminane prima una.",
} as const satisfies PartialTranslation<typeof source>;
