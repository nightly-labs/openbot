import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "Stop alle agents",
  "menu.checkForUpdates": "Controleer op updates…",
  "menu.preferences": "Instellingen…",
  "menu.actualSize": "Werkelijke grootte",
  "menu.zoomIn": "Zoom in",
  "menu.zoomOut": "Zoom uit",
  "menu.copyLink": "Kopieer link",
  "menu.copyImage": "Kopieer afbeelding",
  "menu.quit": "Stop OpenBot",
  "menu.quitConfirmTitle": "OpenBot stoppen?",
  "menu.quitConfirmBody": "Agents en routines stoppen tot je OpenBot weer opent.",
  "menu.quitConfirm": "Stop",
  "menu.quitHint": "Houd ⌘Q ingedrukt of druk twee keer om te stoppen",
  "menu.closeWorkingTitle": { one: "{count} agent werkt nog", other: "{count} agents werken nog" },
  "menu.closeWorkingBody":
    "Als je OpenBot stopt, stoppen de agents. Laat OpenBot draaien, zodat ze klaar worden. Open OpenBot om het venster weer te tonen.",
  "menu.closeKeepRunning": "Laat draaien",
  "menu.trayOpen": "Open OpenBot",
  "menu.trayQuit": "Stop OpenBot",
  "menu.trayTooltip": "OpenBot",
  "menu.hideDynamicIsland": "Dynamic Island verbergen",
  "menu.undo": "Herstel",
  "menu.redo": "Opnieuw",
  "menu.cut": "Knip",
  "menu.copy": "Kopieer",
  "menu.paste": "Plak",
  "menu.pasteAndMatchStyle": "Plak en pas stijl aan",
  "menu.delete": "Verwijder",
  "menu.selectAll": "Selecteer alles",
} as const satisfies PartialTranslation<typeof source>;
