import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  // The plugin page in the marketplace.
  "plugin.link.website": "網站",
  "plugin.link.privacyPolicy": "隱私政策",
  "plugin.link.terms": "服務條款",
  "plugin.copyLink": "複製連結",
  "plugin.askPrompt": "向 {name} 提問：{prompt}",
  "plugin.section.skills": "技能",
  "plugin.section.information": "資訊",
  "plugin.info.developer": "開發者",
  "plugin.info.category": "分類",
  "plugin.info.version": "版本",

  // The uninstall confirmation. {number} is a count that has no plural form here.
  "plugin.uninstallDialog.title": "斷開 {name}？",
  "plugin.uninstallDialog.description": "這會移除 {name} 在這臺電腦上安裝的內容，該主機和該助理的其他內容不受影響。",
  "plugin.uninstallDialog.confirm": "斷開連線",
  "plugin.uninstallDialog.appsLabel": "要移除的應用，{number}",
  "plugin.uninstallDialog.appsTitle": "從此主機移除的應用",
  "plugin.uninstallDialog.appsNote": "它們的工具將不可用，OpenBot 為它們儲存的登入資訊也會被遺忘。",
  "plugin.uninstallDialog.skillsLabel": "要移除的技能，{number}",
  "plugin.uninstallDialog.skillsTitle": "從 {agentName} 移除的技能",
} as const satisfies PartialTranslation<typeof source>;
