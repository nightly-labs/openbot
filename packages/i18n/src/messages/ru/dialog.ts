import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "Выберите папку статического сайта",
  "dialog.chooseAgentFolder": "Выберите папку для агента {agent}",
  "dialog.chooseAgentExclusion": "Выберите папку, которую {agent} не должен изменять",
  "dialog.chooseSkill": "Выберите папку навыка или ZIP",
  "dialog.filter.skillPackages": "Пакеты навыков",
  "dialog.filter.images": "Изображения",
  "dialog.filter.supportedFiles": "Поддерживаемые файлы",
  "dialog.filter.attachment": "Вложение",
  "dialog.filter.zipArchive": "Архив ZIP",
  "dialog.filter.jsonDocument": "Документ JSON",
  "dialog.chooseAgentExport": "Выберите экспорт агента",
  "dialog.filter.agentExports": "Экспорты агентов",
  "dialog.saveExportSkill": "Сохранить навык экспорта",
  "dialog.saveTransfer": "Сохранение файла переноса",
  "dialog.chooseTransfer": "Выбор файла переноса",
  "dialog.filter.transfer": "Файлы переноса OpenBot",
  "dialog.chooseExternalLinkApp": "Выберите браузер",
  "dialog.filter.applications": "Приложения",
} as const satisfies PartialTranslation<typeof source>;
