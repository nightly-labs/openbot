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
  "menu.trayOpen": "Apri OpenBot",
  "menu.trayQuit": "Esci da OpenBot",
  "menu.trayTooltip": "OpenBot",
  "menu.undo": "Annulla",
  "menu.redo": "Ripeti",
  "menu.cut": "Taglia",
  "menu.copy": "Copia",
  "menu.paste": "Incolla",
  "menu.pasteAndMatchStyle": "Incolla e adatta stile",
  "menu.delete": "Elimina",
  "menu.selectAll": "Seleziona tutto",
} as const satisfies PartialTranslation<typeof source>;
