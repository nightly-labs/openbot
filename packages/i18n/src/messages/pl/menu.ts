import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "Zatrzymaj wszystkich agentów",
  "menu.checkForUpdates": "Sprawdź aktualizacje…",
  "menu.preferences": "Ustawienia…",
  "menu.actualSize": "Rzeczywisty rozmiar",
  "menu.zoomIn": "Powiększ",
  "menu.zoomOut": "Pomniejsz",
  "menu.copyLink": "Kopiuj link",
  "menu.trayOpen": "Otwórz OpenBot",
  "menu.trayQuit": "Zamknij OpenBot",
  "menu.trayTooltip": "OpenBot",
  "menu.undo": "Cofnij",
  "menu.redo": "Przywróć",
  "menu.cut": "Wytnij",
  "menu.copy": "Kopiuj",
  "menu.paste": "Wklej",
  "menu.pasteAndMatchStyle": "Wklej i dopasuj styl",
  "menu.delete": "Usuń",
  "menu.selectAll": "Zaznacz wszystko",
} as const satisfies PartialTranslation<typeof source>;
