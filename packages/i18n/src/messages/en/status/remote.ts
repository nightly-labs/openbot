import { defineMessages } from "../../../message";

export const messages = defineMessages("status.remote", {
  // Status lines of remote desktop setup and remote connection recovery.
  "status.remote.setupMacOnly": "Permission setup is available on macOS.",
  "status.remote.setupInstallHost": "Install the remote desktop host component, then check again.",
  "status.remote.setupUpdateRuntime": "Update the remote desktop runtime to check macOS permissions.",
  "status.remote.setupCheckFailed":
    "Sunshine could not complete the permission check. Check the host session, then try again.",
  "status.remote.setupServiceFailed":
    "The remote desktop service could not start. Check that this macOS user has an active GUI session.",
  "status.remote.connectingSunshine": "Connecting through Sunshine…",
  "status.remote.switchingMonitor": "Switching the shared monitor…",
  "status.remote.controlConnected": "Remote control connected.",
  "status.remote.controlFailed": "Remote control failed.",
  "status.remote.stagePreferences": "Loading local chat preferences: {reason}",
  "status.remote.stageConnection": "Connecting to the desktop: {reason}",
  "status.remote.stageCompatibility": "Checking desktop compatibility: {reason}",
  "status.remote.stageAgents": "Loading agents: {reason}",
  "status.remote.stageReads": "Loading read status: {reason}",
  "status.remote.stageConversations": "Loading conversations: {reason}",
  "status.remote.suspendedDetail": "Update OpenBot Mobile or the desktop app before connecting.\n{detail}",
  "status.remote.cooldownDetail":
    "Connection failed after {limit} attempts. Retrying in {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown": "Connection failed after {limit} attempts. Retrying in {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    one: "Connection lost. Retrying in {count}s.\n{detail}",
    other: "Connection lost. Retrying in {count}s.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "Connection lost. Retrying in {count}s.",
    other: "Connection lost. Retrying in {count}s.",
  },
  "status.remote.attemptFailedDetail": {
    one: "Connection attempt failed. Retrying in {count}s.\n{detail}",
    other: "Connection attempt failed. Retrying in {count}s.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "Connection attempt failed. Retrying in {count}s.",
    other: "Connection attempt failed. Retrying in {count}s.",
  },
  "status.remote.reconnectingDetail": {
    one: "Reconnecting {attempt}/{count}\n{detail}",
    other: "Reconnecting {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": { one: "Reconnecting {attempt}/{count}", other: "Reconnecting {attempt}/{count}" },
});
