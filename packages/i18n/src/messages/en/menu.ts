import { defineMessages } from "../../message";

export const messages = defineMessages("menu", {
  // The native application menu. Electron localizes its own `role:` entries from the operating
  // system, so only the custom items are here.
  "menu.stopAllAgents": "Stop all agents",
  "menu.checkForUpdates": "Check for Updates…",
  "menu.preferences": "Settings…",
});
