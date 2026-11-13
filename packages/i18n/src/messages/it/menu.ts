import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "Ferma tutti gli agenti",
  "menu.checkForUpdates": "Verifica aggiornamenti…",
  "menu.preferences": "Impostazioni…",
  "menu.actualSize": "Dimensioni effettive",
  "menu.zoomIn": "Ingrandisci",
  "menu.zoomOut": "Riduci",
  "menu.copyLink": "Copia link",
  "menu.copyImage": "Copia immagine",
  "menu.quit": "Esci da OpenBot",
  "menu.quitConfirmTitle": "Uscire da OpenBot?",
  "menu.quitConfirmBody": "Agenti e routine si fermano finché non riapri OpenBot.",
  "menu.quitConfirm": "Esci",
  "menu.quitHint": "Tieni premuto ⌘Q o premilo due volte per uscire",
  "menu.closeWorkingTitle": {
    one: "{count} agente sta ancora lavorando",
    other: "{count} agenti stanno ancora lavorando",
  },
  "menu.closeWorkingBody":
    "Se esci da OpenBot, gli agenti si fermano. Lascialo in esecuzione per farli finire. Per mostrare di nuovo la finestra, apri OpenBot.",
  "menu.closeKeepRunning": "Continua",
  "menu.trayOpen": "Apri OpenBot",
  "menu.trayQuit": "Esci da OpenBot",
  "menu.trayTooltip": "OpenBot",
  "menu.hideDynamicIsland": "Nascondi Dynamic Island",
  "menu.undo": "Annulla",
  "menu.redo": "Ripeti",
  "menu.cut": "Taglia",
  "menu.copy": "Copia",
  "menu.paste": "Incolla",
  "menu.pasteAndMatchStyle": "Incolla e adatta stile",
  "menu.delete": "Elimina",
  "menu.selectAll": "Seleziona tutto",
} as const satisfies PartialTranslation<typeof source>;
