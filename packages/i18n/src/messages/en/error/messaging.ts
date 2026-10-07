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
});
