import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "Остановить всех агентов",
  "menu.checkForUpdates": "Проверить обновления…",
  "menu.preferences": "Настройки…",
  "menu.actualSize": "Фактический размер",
  "menu.zoomIn": "Увеличить",
  "menu.zoomOut": "Уменьшить",
  "menu.copyLink": "Скопировать ссылку",
  "menu.copyImage": "Скопировать изображение",
  "menu.quit": "Выйти из OpenBot",
  "menu.quitConfirmTitle": "Выйти из OpenBot?",
  "menu.quitConfirmBody": "Агенты и автозадачи остановятся, пока вы снова не откроете OpenBot.",
  "menu.quitConfirm": "Выйти",
  "menu.quitHint": "Удерживайте ⌘Q или нажмите дважды, чтобы выйти",
  "menu.closeWorkingTitle": {
    one: "{count} агент ещё работает",
    few: "{count} агента ещё работают",
    many: "{count} агентов ещё работают",
    other: "{count} агента ещё работают",
  },
  "menu.closeWorkingBody":
    "Если выйти из OpenBot, агенты остановятся. Оставьте OpenBot работать, чтобы они закончили. Чтобы снова показать окно, откройте OpenBot.",
  "menu.closeKeepRunning": "Не выходить",
  "menu.trayOpen": "Открыть OpenBot",
  "menu.trayQuit": "Выйти из OpenBot",
  "menu.trayTooltip": "OpenBot",
  "menu.hideDynamicIsland": "Скрыть Dynamic Island",
  "menu.undo": "Отменить",
  "menu.redo": "Повторить",
  "menu.cut": "Вырезать",
  "menu.copy": "Копировать",
  "menu.paste": "Вставить",
  "menu.pasteAndMatchStyle": "Вставить в том же стиле",
  "menu.delete": "Удалить",
  "menu.selectAll": "Выделить все",
} as const satisfies PartialTranslation<typeof source>;
