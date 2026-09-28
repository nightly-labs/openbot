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

  // The "What's new" dialog after an app update.
  "update.whatsNew.title": "What’s new in OpenBot",
  "update.whatsNew.description": "The new features and changes in this version of OpenBot.",
  "update.whatsNew.version": "Version {version}",
  "update.whatsNew.updatedFrom": "Updated from {from} to {to}",
  "update.whatsNew.group.added": "New",
  "update.whatsNew.group.changed": "Improved",
  "update.whatsNew.group.fixed": "Fixed",
  "update.whatsNew.notices": "Do this after the update",
  "update.whatsNew.showFixes": { one: "Show {count} fix", other: "Show {count} fixes" },
  "update.whatsNew.hideFixes": "Hide fixes",
  "update.whatsNew.loading": "Loading the release notes…",
  "update.whatsNew.failed.title": "The release notes did not load",
  "update.whatsNew.failed.body":
    "Make sure that you are online and try again. The full changelog also shows all changes.",
  "update.whatsNew.empty.title": "No new features in this version",
  "update.whatsNew.empty.body": "This version has small fixes. The full changelog shows all changes.",
  "update.whatsNew.changelog": "Full changelog",
  "update.whatsNew.done": "Got it",
});
