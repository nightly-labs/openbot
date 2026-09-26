import { defineMessages } from "../../message";

export const messages = defineMessages("provider", {
  // The provider list, shown in Settings and during onboarding.
  "provider.availableHere": "Available on this computer",
  "provider.availableOnHost": "Runs on {name}",
  "provider.custom.name": "Custom provider",
  "provider.custom.description": "Your own model endpoint",
  "provider.custom.addLabel": "Add custom provider",
  "provider.custom.installLabel": "Install custom provider",
  "provider.endpointCount": { one: "1 endpoint", other: "{count} endpoints" },
  "provider.manageEndpoints": { one: "Manage 1 endpoint", other: "Manage {count} endpoints" },
  "provider.refresh": "Refresh",
  "provider.refreshLabel": "Refresh providers",
  "provider.refreshingLabel": "Checking providers",
  "provider.refreshing": "Checking…",

  // What a provider row reports about itself. A percentage while downloading is a number, not a
  // message, so it has no key.
  "provider.status.connecting": "Connecting",
  "provider.status.updateAvailable": "Update available",
  "provider.status.settingUp": "Setting up",
  "provider.status.downloadFailed": "Download failed",
  "provider.status.connected": "Connected",
  "provider.status.notDownloaded": "Not downloaded",
  "provider.status.ready": "Ready",
  "provider.status.notConnected": "Not connected",
  "provider.status.notInstalled": "Not installed",
  "provider.status.updateRequired": "Update required",
  "provider.status.unavailable": "Unavailable",
  "provider.status.checking": "Checking",

  // Which account tier the OpenCode row runs on. It shows only while it adds to the runtime
  // badge: a saved key leaves the runtime "Connected" to speak for the row.
  "provider.key.free": "Free",

  // The buttons on a provider row, and the name a screen reader reads for each. The name repeats
  // the provider, because a list of rows all saying "Connect" tells a screen reader user nothing.
  "provider.action.download": "Download",
  "provider.action.cancel": "Cancel",
  "provider.action.connect": "Connect",
  "provider.action.reconnect": "Reconnect",
  "provider.action.restart": "Restart",
  "provider.action.retry": "Retry",
  "provider.action.updateTo": "Update to {version}",
  "provider.action.checkForUpdates": "Check for updates",
  "provider.action.install": "Install",
  "provider.action.signIn": "Sign in",
  "provider.action.signInWithCode": "Log in with code",
  "provider.action.add": "Add",
  "provider.aria.download": "Download {name}",
  "provider.aria.cancel": "Cancel {name}",
  "provider.aria.connect": "Connect {name}",
  "provider.aria.reconnect": "Reconnect {name}",
  "provider.aria.restart": "Restart {name}",
  "provider.aria.retry": "Retry {name}",
  "provider.aria.install": "Install {name}",
  "provider.aria.signIn": "Sign in to {name}",
  "provider.aria.moreActions": "More actions for {name}",
  "provider.aria.signInWithCode": "Log in to {name} with a code on another device",
});
