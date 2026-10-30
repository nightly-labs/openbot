import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "文件预览",
  "preview.panel.resize": "调整文件预览宽度",
  "preview.panel.copy": "复制文件内容",
  "preview.panel.openExternally": "用外部程序打开",
  "preview.panel.download": "下载文件",
  "preview.panel.reveal": "在文件管理器中显示",
  "preview.panel.close": "关闭文件预览",
  "preview.panel.back": "返回",
  "preview.panel.rawMarkdown": "显示 Markdown 源码",
  "preview.panel.rawHtml": "显示 HTML 源码",
  "preview.panel.wrapLines": "自动换行",
  "preview.folder.empty": "该文件夹为空。",
  "preview.folder.truncated": "仅显示前 {limit} 项。",
  "preview.truncated": "预览已超过 {limit} 个字符，内容已截断。",
  "preview.unavailable": "预览不可用。",
  "preview.unsupported.title": "预览不可用",
  "preview.unsupported.description": "该文件类型可以用默认应用打开。",
  "preview.unsupported.openExternally": "用外部程序打开",
  "preview.spreadsheet.readFailed": "无法读取该表格。",
  "preview.spreadsheet.truncated": "预览仅限前 {rows} 行、{columns} 列。",
} as const satisfies PartialTranslation<typeof source>;
