import { defineMessages } from "../../message";

export const messages = defineMessages("messaging", {
  // What the user can do about a Slack workspace connection that stopped.
  "messaging.help.invalid_token":
    "Slack no longer accepts OpenBot in this workspace. It may have been uninstalled. Connect the workspace again.",
  "messaging.help.secret_storage_unavailable":
    "OpenBot cannot read the saved tokens on this computer. Disconnect the workspace, then connect it again.",
  "messaging.help.relay_unavailable":
    "OpenBot cannot receive Slack events on this computer. Sign in, give this computer a name in Server settings, and keep OpenBot open.",
  // The same help for a Discord server connection.
  "messaging.discordHelp.invalid_token":
    "Discord no longer accepts OpenBot in this Discord server. It may have been removed. Connect the Discord server again.",
  "messaging.discordHelp.secret_storage_unavailable":
    "OpenBot cannot read the saved tokens on this computer. Disconnect the Discord server, then connect it again.",
  "messaging.discordHelp.relay_unavailable":
    "OpenBot cannot receive Discord events on this computer. Sign in, give this computer a name in Server settings, and keep OpenBot open.",
});
