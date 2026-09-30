import { defineMessages } from "../../message";

export const messages = defineMessages("messaging", {
  // The state of one agent's Slack connection, and what the user can do about it.
  "messaging.state.connecting": "Connecting",
  "messaging.state.connected": "Connected",
  "messaging.state.reconnecting": "Reconnecting",
  "messaging.state.paused": "Paused",
  "messaging.state.invalid_token": "Token not accepted",
  "messaging.state.missing_scope": "Missing permissions",
  "messaging.state.rate_limited": "Waiting for Slack",
  "messaging.state.secret_storage_unavailable": "Tokens unreadable",
  "messaging.state.error": "Error",
  "messaging.state.awaiting_install": "Waiting for install",
  "messaging.state.relay_unavailable": "Cannot receive events",
  "messaging.help.invalid_token":
    "Slack no longer accepts the app of this agent. It may have been uninstalled. Remove the agent, then add it to Slack again.",
  "messaging.help.secret_storage_unavailable":
    "OpenBot cannot read the saved tokens on this computer. Remove the agent, then add it again.",
  "messaging.help.relay_unavailable":
    "OpenBot cannot receive Slack events on this computer. Sign in, give this computer a name in Server settings, and keep OpenBot open.",
  "messaging.help.awaiting_install":
    "Install the app in Slack to finish. If a workspace admin must approve new apps, the install waits for them.",
});
