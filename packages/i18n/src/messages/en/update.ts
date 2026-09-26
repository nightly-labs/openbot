import { defineMessages } from "../../message";

export const messages = defineMessages("update", {
  // The app update button in Settings, one label for each updater phase.
  "update.action.check": "Check for updates",
  "update.action.checking": "Checking for updates…",
  "update.action.download": "Download update",
  "update.action.downloading": "Downloading update…",
  "update.action.restart": "Restart to update",
  "update.action.restarting": "Restarting…",
  "update.action.retryDownload": "Retry download",
  "update.managedByHost": "Managed by host",
  "update.upToDate": "Up to date",

  // The provider CLI update notification.
  "update.provider.update": "Update",
  "update.provider.upToDate": "{name} is up to date",
  "update.provider.checking": "Checking for {name} updates",
  "update.provider.available": "{name} update available",
  "update.provider.updating": "Updating {name}",
  "update.provider.failed": "{name} update failed",
  "update.provider.settingUp": "Setting up",
  "update.provider.interrupted": "The update was interrupted. Try again.",
  "update.provider.unknownVersion": "unknown version",
  "update.provider.remoteHost": "Provider CLI updates run on the computer that hosts them.",
  "update.provider.unavailable": "Provider updates are unavailable.",
  "update.provider.downloadsUnavailable": "Provider downloads are unavailable.",
  "update.provider.startFailed": "The update could not start. Try again.",
});
