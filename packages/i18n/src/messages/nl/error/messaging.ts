import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Deze Slack-werkruimte is niet verbonden.",
  "error.messaging.unsupported": "Deze computer kan geen verbinding maken met Slack.",
  "error.messaging.relayUnavailable":
    "OpenBot kan op deze computer geen Slack-events ontvangen. Log in, geef deze computer een naam en probeer het opnieuw.",
  "error.messaging.discordNotConnected": "Deze Discord-server is niet verbonden.",
  "error.messaging.discordUnsupported": "Deze computer kan geen verbinding maken met Discord.",
  "error.messaging.discordRelayUnavailable":
    "OpenBot kan op deze computer geen Discord-events ontvangen. Log in, geef deze computer een naam en probeer het opnieuw.",
  "error.messaging.discordRolesUnsupported": "OpenBot kan nog geen Discord-rollen tonen. Probeer het later opnieuw.",
  "error.messaging.telegramNotConnected": "Deze Telegram-chat is niet verbonden.",
  "error.messaging.telegramUnsupported": "Deze computer kan geen verbinding maken met Telegram.",
  "error.messaging.telegramRelayUnavailable":
    "OpenBot kan Telegram niet bereiken op deze computer. Log in, geef deze computer een naam en probeer het opnieuw.",
  "error.messaging.telegramServiceUnavailable": "OpenBot kan Telegram nu niet verbinden. Probeer het later opnieuw.",
  "error.messaging.whatsappNotConnected": "Dit WhatsApp-nummer is niet verbonden.",
  "error.messaging.whatsappUnsupported": "Deze computer kan geen verbinding maken met WhatsApp.",
  "error.messaging.whatsappTooManySenders": "Een WhatsApp-nummer kan maximaal 200 contacten en groepen toestaan.",
  "error.messaging.whatsappRequestEnded":
    "Dit verzoek is beëindigd. Vraag de persoon opnieuw te schrijven voor een nieuwe code.",
  "error.messaging.memoryLimit":
    "Een verbonden werkruimte kan maximaal {limit} herinneringen hebben. Verwijder er eerst een.",
} as const satisfies PartialTranslation<typeof source>;
