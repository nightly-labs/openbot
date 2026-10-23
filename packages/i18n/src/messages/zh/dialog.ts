import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  // Native file pickers.
  "dialog.chooseSiteDirectory": "选择静态站点目录",
  "dialog.chooseSkill": "选择技能文件夹或 ZIP",
  "dialog.filter.skillPackages": "技能包",
  "dialog.filter.images": "图片",
  "dialog.filter.supportedFiles": "支持的文件",
  "dialog.filter.attachment": "附件",
  "dialog.filter.zipArchive": "ZIP 压缩包",
  "dialog.filter.jsonDocument": "JSON 文档",
  "dialog.chooseAgentExport": "选择助手导出文件",
  "dialog.filter.agentExports": "助手导出文件",
  "dialog.saveExportSkill": "保存导出的技能",
  "dialog.saveTransfer": "保存传输文件",
  "dialog.chooseTransfer": "选择传输文件",
  "dialog.filter.transfer": "OpenBot 传输文件",
} as const satisfies PartialTranslation<typeof source>;
