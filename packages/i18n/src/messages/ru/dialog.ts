import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "Выберите папку статического сайта",
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
} as const satisfies PartialTranslation<typeof source>;
