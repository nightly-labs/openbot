import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  // Native file pickers.
  "dialog.chooseSiteDirectory": "選擇靜態站點目錄",
  "dialog.chooseAgentFolder": "為 {agent} 選擇資料夾",
  "dialog.chooseAgentExclusion": "選擇 {agent} 不得更改的資料夾",
  "dialog.chooseSkill": "選擇技能資料夾或 ZIP",
  "dialog.filter.skillPackages": "技能包",
  "dialog.filter.images": "圖片",
  "dialog.filter.supportedFiles": "支援的檔案",
  "dialog.filter.attachment": "附件",
  "dialog.filter.zipArchive": "ZIP 壓縮包",
  "dialog.filter.jsonDocument": "JSON 文件",
  "dialog.chooseAgentExport": "選擇助理匯出檔案",
  "dialog.chooseHermesFolder": "選擇 Hermes 資料夾",
  "dialog.filter.agentExports": "助理匯出檔案",
  "dialog.chooseVaultCsv": "選擇密碼匯出檔案",
  "dialog.filter.csv": "CSV 檔案",
  "dialog.saveExportSkill": "儲存匯出的技能",
  "dialog.saveTransfer": "儲存傳輸檔案",
  "dialog.chooseTransfer": "選擇傳輸檔案",
  "dialog.filter.transfer": "OpenBot 傳輸檔案",
  "dialog.chooseExternalLinkApp": "選擇瀏覽器",
  "dialog.filter.applications": "應用程式",
} as const satisfies PartialTranslation<typeof source>;
