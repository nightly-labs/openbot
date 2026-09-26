import { defineMessages } from "../../../message";

export const messages = defineMessages("error.update", {
  // Updater state the user reads.
  "error.update.unsupported": "Updates are available in installed desktop builds.",
  "error.update.notReady": "An update is not ready to install.",
  "error.update.restartFailed": "OpenBot could not restart to install the update.",
  "error.update.downloadStalled": "The update download stopped responding. Try again.",
  "error.update.installFailed": "Could not install the update. Quit and reopen OpenBot, then try again.",
  "error.update.downloadFailed": "Could not download the update. Try again.",
  "error.update.checkFailed": "Could not check for updates. Try again.",
  "error.update.checkStalled": "The update check stopped responding. Try again.",
  "error.update.checkOffline": "Could not reach the update service. Check your internet connection, then try again.",
  "error.update.checkUnavailable":
    "The update service did not answer. OpenBot tries again on its own in a few minutes.",
  "error.update.checkNoRelease":
    "No published update was found for this platform. OpenBot tries again on its own in a few minutes.",
});
