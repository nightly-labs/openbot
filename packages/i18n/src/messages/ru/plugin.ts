import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  "plugin.link.website": "Сайт",
  "plugin.link.privacyPolicy": "Политика конфиденциальности",
  "plugin.link.terms": "Условия использования",
  "plugin.copyLink": "Копировать ссылку",
  "plugin.askPrompt": "Спросить {name}: {prompt}",
  "plugin.section.apps": "Приложения",
  "plugin.section.skills": "Навыки",
  "plugin.section.information": "Информация",
  "plugin.info.developer": "Разработчик",
  "plugin.info.category": "Категория",
  "plugin.info.version": "Версия",

  "plugin.uninstallDialog.title": "Отключить {name}?",
  "plugin.uninstallDialog.description":
    "Будет удалено то, что {name} установил на этом компьютере. Остальное на этом хосте и у этого агента не изменится.",
  "plugin.uninstallDialog.confirm": "Отключить",
  "plugin.uninstallDialog.appsLabel": "Приложения для удаления: {number}",
  "plugin.uninstallDialog.appsTitle": "Приложения, которые будут удалены с этого хоста",
  "plugin.uninstallDialog.appsNote":
    "Их инструменты перестанут быть доступны, а сохранённые OpenBot данные входа для них будут забыты.",
  "plugin.uninstallDialog.skillsLabel": "Навыки для удаления: {number}",
  "plugin.uninstallDialog.skillsTitle": "Навыки, которые будут удалены у агента {agentName}",
} as const satisfies PartialTranslation<typeof source>;
