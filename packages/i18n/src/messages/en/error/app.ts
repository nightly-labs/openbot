import { defineMessages } from "../../../message";

export const messages = defineMessages("error.app", {
  // Errors from app, notification, and secret storage actions.
  "error.app.externalLinkProtocol": "Only HTTP(S) links can open in the external browser.",
  "error.app.notificationsUnsupported": "This system does not support desktop notifications.",
  "error.app.notificationSettingsMissing": "This system has no notification settings page.",
  "error.app.notReady": "OpenBot is not ready.",
  "error.app.macSecureStorageUnavailable": "macOS secure storage is unavailable.",
  "error.app.secretStorageUnavailable": "System secret storage is unavailable.",
  "error.app.remoteIdentityUnavailable": "The remote host identity is unavailable.",
  "error.app.iceServersMissing": "Remote Signal has not supplied ICE servers yet.",
  "error.app.finishLocalTest": "Finish the local test before switching displays.",
});
