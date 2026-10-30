import { defineMessages } from "../../../message";

export const messages = defineMessages("error.messaging", {
  // Errors of a Slack workspace connection, which the host sends.
  "error.messaging.notConnected": "This Slack workspace is not connected.",
  "error.messaging.unsupported": "This computer cannot connect to Slack.",
  "error.messaging.relayUnavailable":
    "OpenBot cannot receive Slack events on this computer. Sign in, give this computer a name, and try again.",
  // Errors of a Discord server connection, which the host sends.
  "error.messaging.discordNotConnected": "This Discord server is not connected.",
  "error.messaging.discordUnsupported": "This computer cannot connect to Discord.",
  "error.messaging.discordRelayUnavailable":
    "OpenBot cannot receive Discord events on this computer. Sign in, give this computer a name, and try again.",
  "error.messaging.discordRolesUnsupported": "OpenBot cannot list Discord roles yet. Try again later.",
  // Errors of a Telegram chat connection, which the host sends.
  "error.messaging.telegramNotConnected": "This Telegram chat is not connected.",
  "error.messaging.telegramUnsupported": "This computer cannot connect to Telegram.",
  "error.messaging.telegramRelayUnavailable":
    "OpenBot cannot reach Telegram on this computer. Sign in, give this computer a name, and try again.",
  "error.messaging.telegramServiceUnavailable": "OpenBot cannot connect Telegram now. Try again later.",
  // Errors of a linked WhatsApp number, which the host sends.
  "error.messaging.whatsappNotConnected": "This WhatsApp number is not connected.",
  "error.messaging.whatsappUnsupported": "This computer cannot connect to WhatsApp.",
  "error.messaging.whatsappTooManySenders": "A WhatsApp number can allow up to 200 contacts and groups.",
  "error.messaging.whatsappRequestEnded": "This request ended. Ask the person to write again for a new code.",
  // The agent gets this when a connected workspace has too many saved facts.
  "error.messaging.memoryLimit": "A connected workspace can have up to {limit} memories. Delete one first.",
});
