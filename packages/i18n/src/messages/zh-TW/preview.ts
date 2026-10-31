import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "檔案預覽",
  "preview.panel.resize": "調整檔案預覽寬度",
  "preview.panel.copy": "複製檔案內容",
  "preview.panel.openExternally": "用外部程式開啟",
  "preview.panel.download": "下載檔案",
  "preview.panel.reveal": "在檔案管理器中顯示",
  "preview.panel.close": "關閉檔案預覽",
  "preview.panel.back": "返回",
  "preview.panel.rawMarkdown": "顯示 Markdown 原始碼",
  "preview.panel.rawHtml": "顯示 HTML 原始碼",
  "preview.panel.wrapLines": "自動換行",
  "preview.folder.empty": "該資料夾為空。",
  "preview.folder.truncated": "僅顯示前 {limit} 項。",
  "preview.truncated": "預覽已超過 {limit} 個字元，內容已截斷。",
  "preview.unavailable": "預覽不可用。",
  "preview.unsupported.title": "預覽不可用",
  "preview.unsupported.description": "該檔案型別可以用預設應用開啟。",
  "preview.unsupported.openExternally": "用外部程式開啟",
  "preview.spreadsheet.readFailed": "無法讀取該表格。",
  "preview.spreadsheet.truncated": "預覽僅限前 {rows} 行、{columns} 列。",
} as const satisfies PartialTranslation<typeof source>;
