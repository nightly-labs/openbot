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
} as const satisfies MessageCatalog;

export type AppMessages = typeof en;
