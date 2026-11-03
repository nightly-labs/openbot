import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  "plugin.link.website": "Сайт",
  "plugin.link.privacyPolicy": "Політика конфіденційності",
  "plugin.link.terms": "Умови використання",
  "plugin.copyLink": "Копіювати посилання",
  "plugin.askPrompt": "Запитати {name}: {prompt}",
  "plugin.section.skills": "Навички",
  "plugin.section.information": "Інформація",
  "plugin.info.developer": "Розробник",
  "plugin.info.category": "Категорія",
  "plugin.info.version": "Версія",

  "plugin.uninstallDialog.title": "Від’єднати {name}?",
  "plugin.uninstallDialog.description":
    "Буде видалено те, що встановлено плагіном {name} на цьому комп’ютері. Решта на цьому хості й у цього агента не зміниться.",
  "plugin.uninstallDialog.confirm": "Від’єднати",
  "plugin.uninstallDialog.appsLabel": "Застосунки для видалення: {number}",
  "plugin.uninstallDialog.appsTitle": "Застосунки, які буде видалено з цього хоста",
  "plugin.uninstallDialog.appsNote":
    "Їхні інструменти стануть недоступні, а дані входу, збережені для них в OpenBot, буде забуто.",
  "plugin.uninstallDialog.skillsLabel": "Навички для видалення: {number}",
  "plugin.uninstallDialog.skillsTitle": "Навички, які буде видалено в агента {agentName}",
} as const satisfies PartialTranslation<typeof source>;
