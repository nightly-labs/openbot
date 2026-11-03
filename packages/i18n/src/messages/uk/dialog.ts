import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "Виберіть папку статичного сайту",
  "dialog.chooseSkill": "Виберіть папку навички або ZIP",
  "dialog.filter.skillPackages": "Пакети навичок",
  "dialog.filter.images": "Зображення",
  "dialog.filter.supportedFiles": "Підтримувані файли",
  "dialog.filter.attachment": "Вкладення",
  "dialog.filter.zipArchive": "Архів ZIP",
  "dialog.filter.jsonDocument": "Документ JSON",
  "dialog.chooseAgentExport": "Виберіть експорт агента",
  "dialog.filter.agentExports": "Експорти агентів",
  "dialog.saveExportSkill": "Зберегти навичку експорту",
  "dialog.saveTransfer": "Зберегти файл перенесення",
  "dialog.chooseTransfer": "Виберіть файл перенесення",
  "dialog.filter.transfer": "Файли перенесення OpenBot",
  "dialog.chooseExternalLinkApp": "Виберіть браузер",
  "dialog.filter.applications": "Програми",
} as const satisfies PartialTranslation<typeof source>;
