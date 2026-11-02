import { defineMessages } from "../../message";

export const messages = defineMessages("menu", {
  // The native application menu. Electron localizes its own `role:` entries from the operating
  // system, so only the custom items are here. A role's label does not follow the app language, so
  // the chat's right-click edit menu takes its labels from here.
  "menu.stopAllAgents": "Stop all agents",
  "menu.checkForUpdates": "Check for Updates…",
  "menu.preferences": "Settings…",
  "menu.actualSize": "Actual Size",
  "menu.zoomIn": "Zoom In",
  "menu.zoomOut": "Zoom Out",
  "menu.copyLink": "Copy Link",
  "menu.trayOpen": "Open OpenBot",
  "menu.trayQuit": "Quit OpenBot",
  "menu.trayTooltip": "OpenBot",
  "menu.undo": "Undo",
  "menu.redo": "Redo",
  "menu.cut": "Cut",
  "menu.copy": "Copy",
  "menu.paste": "Paste",
  "menu.pasteAndMatchStyle": "Paste and Match Style",
  "menu.delete": "Delete",
  "menu.selectAll": "Select All",
});
