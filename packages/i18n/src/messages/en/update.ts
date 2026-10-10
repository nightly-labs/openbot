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

  "update.screen.ready": "Update ready",
  "update.screen.readyBody":
    "Restart to finish the update. Restart now stops active work. Choose Install when idle to wait for active work to finish.",
  "update.screen.restartingBody":
    "OpenBot is preparing to close and install the update. This can take several minutes. Closing this screen does not cancel the restart.",
  "update.screen.failed": "The update did not install",
  "update.screen.failedBody":
    "OpenBot could not finish the restart. Services may have stopped. Quit OpenBot, then open it again before you continue. Check for updates to try again.",
  "update.screen.interrupted": "The update was interrupted",
  "update.screen.interruptedBody":
    "OpenBot did not start on the expected version. You can continue to use this version. Check for updates to try again.",
  "update.screen.successBody": "OpenBot {version} is installed.",
  "update.screen.currentVersion": "Current: {version}",
  "update.screen.targetVersion": "Update: {version}",
  "update.screen.later": "Later",
  "update.screen.actionFailed": "The restart could not start. Try again.",

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
  "update.provider.showDetails": "Show details",
  "update.provider.hideDetails": "Hide details",

  // An update that an admin of this server asked for. {name} is the admin.
  "update.scheduled.title": "{name} scheduled an OpenBot update",
  // The same notice when "Install updates automatically" scheduled the restart.
  "update.scheduled.automaticTitle": "OpenBot installs an update",
  "update.scheduled.whenIdle": "OpenBot restarts when the agents are idle.",
  "update.scheduled.now": "OpenBot restarts when the update is downloaded.",
  "update.scheduled.cancel": "Cancel update",
  "update.scheduled.cancelFailed": "The update could not be cancelled.",

  // A restart that the user of this computer asked for. It waits until no work runs.
  "update.idleRestart.relaunchTitle": "OpenBot restarts when the agents are idle",
  "update.idleRestart.updateTitle": "OpenBot installs the update when the agents are idle",
  "update.idleRestart.description": "New routine runs wait until the restart.",
  "update.idleRestart.waitingFor": "Waiting for {reasons}.",
  "update.idleRestart.cancel": "Cancel restart",
  "update.idleRestart.cancelFailed": "The restart could not be cancelled.",
  "update.idleRestart.requestFailed": "The restart could not be scheduled.",
  "update.idleRestart.failedTitle": "OpenBot did not restart",

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
  "update.whatsNew.empty.body": "This version has no notes to show here. The full changelog shows all changes.",
  "update.whatsNew.changelog": "Full changelog",
  "update.whatsNew.done": "Got it",
});
