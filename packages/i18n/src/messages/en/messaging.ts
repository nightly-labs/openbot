import { defineMessages } from "../../message";

export const messages = defineMessages("messaging", {
  // The state of a Slack workspace connection, and what the user can do about it.
  "messaging.state.connecting": "Connecting",
  "messaging.state.connected": "Connected",
  "messaging.state.reconnecting": "Reconnecting",
  "messaging.state.paused": "Paused",
  "messaging.state.invalid_token": "Token not accepted",
  "messaging.state.missing_scope": "Missing permissions",
  "messaging.state.rate_limited": "Waiting for Slack",
  "messaging.state.secret_storage_unavailable": "Tokens unreadable",
  "messaging.state.error": "Error",
  "messaging.state.relay_unavailable": "Cannot receive events",
  "messaging.help.invalid_token":
    "Slack no longer accepts OpenBot in this workspace. It may have been uninstalled. Connect the workspace again.",
  "messaging.help.secret_storage_unavailable":
    "OpenBot cannot read the saved tokens on this computer. Disconnect the workspace, then connect it again.",
  "messaging.help.relay_unavailable":
    "OpenBot cannot receive Slack events on this computer. Sign in, give this computer a name in Server settings, and keep OpenBot open.",
});
