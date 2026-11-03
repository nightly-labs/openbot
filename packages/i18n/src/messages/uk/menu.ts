import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "Зупинити всіх агентів",
  "menu.checkForUpdates": "Перевірити оновлення…",
  "menu.preferences": "Налаштування…",
  "menu.actualSize": "Фактичний розмір",
  "menu.zoomIn": "Збільшити",
  "menu.zoomOut": "Зменшити",
  "menu.copyLink": "Скопіювати посилання",
  "menu.trayOpen": "Відкрити OpenBot",
  "menu.trayQuit": "Вийти з OpenBot",
  "menu.trayTooltip": "OpenBot",
} as const satisfies PartialTranslation<typeof source>;
