import type { MessageCatalog } from "../message";

/**
 * The English source catalog. It is the key list every translation must satisfy and the text a
 * translation falls back to, so a string is written here first and translated second.
 *
 * Keys are `area.thing`, and the area is the surface a reader would go looking in. Nothing here is
 * a protocol value: provider identifiers, analytics event names, log lines and agent prompts stay
 * in English in the code that owns them.
 */
export const en = {
  // The native application menu. Electron localizes its own `role:` entries from the operating
  // system, so only the two custom items are here.
  "menu.stopAllAgents": "Stop all agents",
  "menu.checkForUpdates": "Check for Updates…",

  // Desktop notifications, raised by the main process while the window may be closed.
  "notification.needsInput": "Needs your input.",
  "notification.needsApproval": "Needs your approval.",
  "notification.finished": "Finished working.",

  // Native file pickers.
  "dialog.chooseSiteDirectory": "Choose a static site directory",
  "dialog.chooseSkill": "Choose a skill folder or ZIP",
  "dialog.filter.skillPackages": "Skill packages",
  "dialog.filter.images": "Images",
  "dialog.filter.supportedFiles": "Supported files",
  "dialog.filter.attachment": "Attachment",
  "dialog.filter.zipArchive": "ZIP archive",
  "dialog.filter.jsonDocument": "JSON document",

  // The one native error box: the app could not start, so no renderer exists to show it.
  "startup.failedTitle": "OpenBot couldn’t start",
  "startup.failedBody":
    "{message}\n\nYour local data was not reset or overwritten. See the troubleshooting guide for recovery steps.",

  // Updater state the user reads.
  "update.unsupported": "Updates are available in installed desktop builds.",
  "update.notReady": "An update is not ready to install.",
  "update.restartFailed": "OpenBot could not restart to install the update.",
  "update.downloadStalled": "The update download stopped responding. Try again.",
  "update.installFailed": "Could not install the update. Quit and reopen OpenBot, then try again.",
  "update.downloadFailed": "Could not download the update. Try again.",
  "update.checkFailed": "Could not check for updates. Try again.",

  // The language setting itself.
  "settings.language.title": "Language",
  "settings.language.description": "OpenBot shows menus, buttons and messages in this language.",
  "settings.language.system": "System default",
  // The Settings window, General tab.
  "settings.providers.title": "AI providers",
  "settings.appBehavior.title": "App behavior",
  "settings.launchAtLogin.title": "Launch OpenBot at login",
  "settings.launchAtLogin.description": "Open the app when you sign in to this computer.",
  "settings.keepRunning.title": "Keep OpenBot running in the background",
  "settings.keepRunning.description": "Keep active tasks running after you close the window.",
  "settings.workspace.title": "Workspace",
  "settings.restoreWorkspace.title": "Restore the last workspace on launch",
  "settings.restoreWorkspace.description": "Open the workspace and tasks from your previous session.",
  "settings.externalLinks.title": "Open external links in",
  "settings.externalLinks.description": "Choose where links from conversations open.",
  // The two link targets. The saved value stays in English; only the label is translated.
  "settings.externalLinks.defaultBrowser": "Default browser",
  "settings.externalLinks.openbot": "OpenBot",
  "settings.notifications.title": "Notifications",
  "settings.desktopNotifications.title": "Desktop notifications",
  "settings.desktopNotifications.description": "Show a notification when an agent needs attention.",
  "settings.taskSound.title": "Play a sound when a task finishes",
  "settings.taskSound.description": "Use a short sound for completed tasks.",
  "settings.notch.title": "MacBook notch",
  "settings.notch.show.title": "Show status in the MacBook notch",
  "settings.notch.show.description": "Show agent activity and items that need attention at the top of each display.",
  "settings.notch.idle.title": "Show idle island",
  "settings.notch.idle.description": "Show the OpenBot logo and greeting when no status is active.",
  "settings.notch.displays.title": "Show on additional displays",
  "settings.notch.displays.description": "Show Dynamic Island on connected external displays.",
  "settings.notch.haptics.title": "Haptic feedback",
  "settings.notch.haptics.description": "Use the Force Touch trackpad to confirm Dynamic Island interactions.",
  "settings.privacy.title": "Privacy",
  "settings.analytics.title": "Share product analytics",
  "settings.analytics.description":
    "Send usage and reliability metadata with your account ID and email to OpenBot’s self-hosted analytics.",
  // The Settings window shell: its tab list, headers and save bar.
  "settings.tab.general.title": "General",
  "settings.tab.general.description": "Control how OpenBot behaves on this computer.",
  "settings.tab.computerUse.title": "Computer Use",
  "settings.tab.computerUse.description": "Allow OpenBot to see and interact with apps on this Mac.",
  "settings.tab.profile.title": "Profile",
  "settings.tab.profile.description": "Manage how you appear in OpenBot.",
  "settings.tab.mobileConnect.title": "Mobile Connect",
  "settings.tab.mobileConnect.description": "Sign in securely on your phone.",
  "settings.tab.updates.title": "Updates",
  "settings.tab.updates.description": "Keep OpenBot current on this computer.",
  "settings.tab.hostedSites.title": "Hosted sites",
  "settings.tab.hostedSites.description": "View and manage static sites published by your agents.",
  "settings.sections.label": "Settings sections",
  "settings.save.region": "Unsaved changes",
  "settings.save.notSaved": "Changes not saved",
  "settings.save.reset": "Reset",
  "settings.save.saving": "Saving…",
  "settings.save.save": "Save",
  // The provider list, shown in Settings and during onboarding.
  "provider.availableHere": "Available on this computer",
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

  // The buttons on a provider row, and the name a screen reader reads for each. The name repeats
  // the provider, because a list of rows all saying "Connect" tells a screen reader user nothing.
  "provider.action.download": "Download",
  "provider.action.cancel": "Cancel",
  "provider.action.connect": "Connect",
  "provider.action.reconnect": "Reconnect",
  "provider.action.restart": "Restart",
  "provider.action.retry": "Retry",
  "provider.action.update": "Update",
  "provider.action.install": "Install",
  "provider.action.signIn": "Sign in",
  "provider.action.add": "Add",
  "provider.aria.download": "Download {name}",
  "provider.aria.cancel": "Cancel {name}",
  "provider.aria.connect": "Connect {name}",
  "provider.aria.reconnect": "Reconnect {name}",
  "provider.aria.restart": "Restart {name}",
  "provider.aria.retry": "Retry {name}",
  "provider.aria.update": "Update {name} to {version}",
  "provider.aria.install": "Install {name}",
  "provider.aria.signIn": "Sign in to {name}",
} as const satisfies MessageCatalog;

export type AppMessages = typeof en;
